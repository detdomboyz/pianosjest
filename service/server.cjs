'use strict';
// A separate account API. Never imports the single-user Windows server.cjs.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openRepository } = require('./repository.cjs');
const {PostgresDatabase}=require('./database.cjs');
const S = require('./security.cjs');
const V = require('./validation.cjs');
const {createGame}=require('./game.cjs');
const API = '/api/service/v1';
const ID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const CONTRACT_FILES = Object.freeze(['catalog-transfer.js', 'catalog-personalization.js', 'music-document.js', 'piano-catalog-adapter.js', 'practice-assessment.js']);
const IMPLEMENTATION_FILES = Object.freeze(require('./implementation-files.json').sort());
function secretAt(directory) {
    const name = path.join(directory, 'session-secret');
    if (!fs.existsSync(name)) {
        try {
            fs.writeFileSync(name, crypto.randomBytes(32).toString('hex') + '\n', { flag: 'wx', mode: 0o600 });
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
    S.check(!fs.lstatSync(name).isSymbolicLink() && fs.statSync(name).isFile(), 500, 'SECRET', 'Некорректный файл секрета.');
    const secret = fs.readFileSync(name, 'utf8').trim();
    S.check(/^[a-f0-9]{64}$/.test(secret), 500, 'SECRET', 'Некорректный секрет сессий.');
    return secret;
}
function config(input) {
    const origin = new URL(input.origin || 'http://127.0.0.1:63370');
    const development = input.development === true;
    S.check(origin.origin === (input.origin || origin.origin) && (origin.protocol === 'https:' || (development && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))), 500, 'ORIGIN_CONFIG', 'Укажи канонический HTTPS-адрес сервиса.');
    const dataDir = path.resolve(input.dataDir);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const actual = fs.realpathSync(dataDir);
    S.check((process.platform === 'win32' ? actual.toLowerCase() === dataDir.toLowerCase() : actual === dataDir) && !fs.lstatSync(dataDir).isSymbolicLink(), 500, 'DATA_DIRECTORY', 'Каталог данных не должен быть ссылкой.');
    return { ...input, origin, development, dataDir };
}
async function createService(input) {
    const options = config(input);
    const store = await openRepository({ filename: path.join(options.dataDir, 'accounts.sqlite'), database: input.database });
    let secret;try{secret=secretAt(options.dataDir);}catch(error){await store.close();throw error;}
    const contracts = Object.fromEntries(CONTRACT_FILES.map(name => [name, S.sha(fs.readFileSync(path.join(__dirname, '..', name)))]));
    const implementation = Object.fromEntries(IMPLEMENTATION_FILES.map(name => { const bytes = fs.readFileSync(path.join(__dirname, '..', name)); return [name, { bytes: bytes.length, sha256: S.sha(bytes) }]; }));
    const implementationSha256 = S.sha(JSON.stringify(implementation));
    const now = options.now || Date.now;
    const game=createGame(store,input.courseRegistry);
    const cookieName = options.development ? 'melodiajest-dev-session' : '__Host-melodiajest-session';
    const dummyHash = await S.hashPassword(crypto.randomBytes(24).toString('base64url'));
    let authJobs = 0, bodyJobs = 0;
    function send(res, status, data, extra = {}) {
        const raw = Buffer.from(JSON.stringify(data) + '\n');
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length,
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...extra });
        res.end(raw);
    }
    function cookie(raw, expires = false) {
        return `${cookieName}=${raw || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : 7 * 86400}${options.development ? '' : '; Secure'}`;
    }
    async function rate(req, group, limit, seconds, account = '') {
        const address = options.trustProxy ? String(req.headers['x-real-ip'] || req.socket.remoteAddress) : req.socket.remoteAddress;
        const bucket = crypto.createHmac('sha256', secret).update(group + '\0' + (account || address)).digest('hex');
        (await store.rate(bucket, limit, seconds * 1000, now()));
    }
    async function expensive(fn) {
        S.check(authJobs < 2, 503, 'AUTH_BUSY', 'Вход временно занят. Повтори через несколько секунд.');
        authJobs++;
        try {
            return await fn();
        }
        finally {
            authJobs--;
        }
    }
    async function authenticate(req, { required = false, mutation = false } = {}) {
        const raw = S.cookieValue(req.headers.cookie, cookieName);
        const session = (await store.session(raw, now()));
        if (required) {
            S.check(session?.user_id, 401, 'SIGN_IN_REQUIRED', 'Войди, чтобы сохранить личные изменения.');
            S.check(req.headers['x-melodiajest-account'] === session.user_id, 409, 'ACCOUNT_CHANGED', 'Аккаунт в другой вкладке изменился. Сохрани свою копию и войди заново.');
        }
        if (mutation) {
            S.check(req.headers.origin === options.origin.origin, 403, 'ORIGIN', 'Запрос должен исходить с сайта MelodiaJest.');
            S.check(!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin' || req.headers['sec-fetch-site'] === 'none', 403, 'ORIGIN', 'Межсайтовый запрос отклонён.');
            S.check(session && S.constantEqual(req.headers['x-melodiajest-csrf'], S.csrf(secret, raw)), 403, 'CSRF', 'Обнови страницу перед сохранением.');
        }
        return { raw, session, user: session?.user_id ? (await store.getUser(session.user_id)) : null };
    }
    function sessionResult(user, raw) {
        return { serviceVersion: 1, user, csrfToken: S.csrf(secret, raw), registration: { kind: 'username-password', recovery: 'one-time-code' }, sso: { enabled: false, linking: 'explicit-authenticated-link' }, personalProgress: 'database-and-versioned-browser-history' };
    }
    async function rotate(req, res, user, oldRaw, extra = {}, expectedPasswordHash) {
        const raw = S.token();
        (await store.atomic(async () => {
            if(expectedPasswordHash)S.check((await store.credentials(user.username))?.password_hash===expectedPasswordHash,409,'CREDENTIAL_CHANGED','Доступ уже изменился. Войди заново.');
            (await store.revokeSession(oldRaw)); (await store.newSession(raw, user.id, now()));
        },user.id));
        send(res, 200, { ...sessionResult(user, raw), ...extra }, { 'Set-Cookie': cookie(raw) });
    }
    async function body(req, maxBytes = 8192) {
        S.check(bodyJobs < 2, 503, 'BODY_BUSY', 'Сервис занят сохранением. Повтори через несколько секунд.');
        bodyJobs++;
        try {
            S.check((req.headers['content-type'] || '').split(';')[0].trim() === 'application/json', 415, 'CONTENT_TYPE', 'Ожидается JSON.');
            const length = req.headers['content-length'];
            S.check(length === undefined || (/^\d+$/.test(length) && Number(length) <= maxBytes), 413, 'BODY_SIZE', 'Слишком большой запрос.');
            const parts = [];
            let size = 0;
            for await (const part of req) {
                size += part.length;
                S.check(size <= maxBytes, 413, 'BODY_SIZE', 'Слишком большой запрос.');
                parts.push(part);
            }
            return V.boundedJson(Buffer.concat(parts).toString('utf8'), maxBytes);
        }
        finally {
            bodyJobs--;
        }
    }
    const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }, (req, res) => {
        void route(req, res).catch(error => {
            if (res.headersSent || res.destroyed)
                return res.destroy();
            const known = error instanceof S.ServiceError;
            // Never log a request body, password, recovery code, cookie or private music.
            if (!known && options.onError)
                options.onError({ code: 'INTERNAL_ERROR', name: error.name });
            send(res, known ? error.status : 503, { error: { code: known ? error.code : 'TEMPORARILY_UNAVAILABLE', message: known ? error.message : 'Сервис временно недоступен. Сохрани свой вариант и повтори позже.' } }, { 'Connection': 'close', ...(known && error.status === 429 ? { 'Retry-After': '900' } : {}) });
        });
    });
    server.maxConnections = 80;
    server.maxRequestsPerSocket = 100;
    async function route(req, res) {
        S.check(req.headers.host === options.origin.host, 421, 'HOST', 'Недопустимый адрес сервиса.');
        S.check(['GET', 'POST', 'PUT'].includes(req.method), 405, 'METHOD', 'Метод не поддерживается.');
        const url = new URL(req.url, options.origin);
        S.check(url.pathname.startsWith(API + '/') && !/%|\\|\.\./.test(url.pathname), 404, 'NOT_FOUND', 'Путь не найден.');
        const route = url.pathname.slice(API.length);
        if (req.method === 'GET' && route === '/health') {
            const databaseHealth = await (await store.health());
            return send(res, 200, { ...databaseHealth, status: 'ok', serviceVersion: 1, schemaVersion: 1, contracts, implementationSha256, registrationEnabled: options.registrationEnabled !== false, maintenanceReadOnly:options.maintenanceReadOnly===true,courseSha256:game.course.contentSha256 });
        }
        if(req.method!=='GET'){S.check(options.maintenanceReadOnly!==true,503,'MAINTENANCE_READ_ONLY','Обновление сервиса: чтение доступно, сохранение скоро возобновится. Твой черновик остаётся у тебя.');const available=options.diskFreeBytes?options.diskFreeBytes():(()=>{const space=fs.statfsSync(options.dataDir);return space.bavail*space.bsize;})();S.check(available>=512*1024*1024,503,'DISK_RESERVE','Сохранение временно приостановлено: сервису нужно место для безопасной копии. Текущие данные сохранены.');}
        if (req.method === 'GET' && route === '/session') {
            const old = (await authenticate(req));
            if (old.session)
                return send(res, 200, sessionResult(old.user, old.raw));
            (await rate(req, 'session', 120, 3600));
            const raw = S.token();
            (await store.newSession(raw, null, now()));
            return send(res, 200, sessionResult(null, raw), { 'Set-Cookie': cookie(raw) });
        }
        if(req.method==='GET'&&route==='/course')return send(res,200,await game.publicCourse());
        if(req.method==='GET'&&route==='/comments'){
            const auth=await authenticate(req),cursor=url.searchParams.get('cursor')||'';S.check(cursor.length<=512,400,'PAGE','Некорректная страница.');
            return send(res,200,await game.comments(url.searchParams.get('scope')||'global',url.searchParams.get('lessonId')||'',cursor,auth.user?.id));
        }
        if (req.method === 'GET' && route === '/publications') {
            const offset = Number(url.searchParams.get('offset') || 0);
            S.check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 100000, 400, 'PAGE', 'Некорректная страница.');
            return send(res, 200, { items: (await store.publicList(offset)), nextOffset: offset + 20 });
        }
        let match;
        if (req.method === 'GET' && (match = route.match(new RegExp('^/publications/(' + ID + ')$'))))
            return send(res, 200, (await store.publicMelody(match[1])));
        if (req.method === 'POST' && ['/auth/register', '/auth/login', '/auth/recover'].includes(route)) {
            const auth = (await authenticate(req, { mutation: true }));
            (await rate(req, 'auth-ip', 30, 900));
            const input = await body(req);
            const name = S.username(input.username);
            (await rate(req, 'auth-account', 12, 900, name));
            if (route === '/auth/register') {
                S.check(options.registrationEnabled !== false, 503, 'REGISTRATION_NOT_OPEN', 'Регистрация ещё готовится. Повтори позже.');
                S.exactFields(input, ['username', 'password', 'displayName']);
                (await rate(req, 'register', 5, 86400));
                const pass = S.password(input.password), display = S.displayName(input.displayName);
                const hash = await expensive(() => S.hashPassword(pass));
                const recoveryCode = S.token();
                const user = (await store.register(name, display, hash, S.sha(recoveryCode), now()));
                return (await rotate(req, res, user, auth.raw, { recoveryCode }));
            }
            if (route === '/auth/login') {
                S.exactFields(input, ['username', 'password']);
                const record = (await store.credentials(name));
                const valid = await expensive(() => S.verifyPassword(input.password, record?.password_hash || dummyHash));
                S.check(valid && record, 401, 'LOGIN_FAILED', 'Не удалось войти. Проверь логин и пароль.');
                return (await rotate(req, res, (await store.getUser(record.user_id)), auth.raw, {},record.password_hash));
            }
            S.exactFields(input, ['username', 'recoveryCode', 'password']);
            const record = (await store.credentials(name));
            const valid = typeof input.recoveryCode === 'string' && /^[A-Za-z0-9_-]{43}$/.test(input.recoveryCode) && S.constantEqual(S.sha(input.recoveryCode), record?.recovery_hash || S.sha('missing-recovery'));
            S.check(valid && record, 401, 'RECOVERY_FAILED', 'Логин или резервный код не подошёл.');
            const hash = await expensive(() => S.hashPassword(S.password(input.password)));
            // Check once again after the asynchronous hash: parallel resets may consume the code.
            const fresh = (await store.credentials(name));
            S.check(fresh && S.constantEqual(S.sha(input.recoveryCode), fresh.recovery_hash), 401, 'RECOVERY_FAILED', 'Резервный код уже использован.');
            const recoveryCode = S.token();
            (await store.resetPassword(record.user_id, hash, S.sha(recoveryCode), now(),{passwordHash:record.password_hash,recoveryHash:record.recovery_hash}));
            return (await rotate(req, res, (await store.getUser(record.user_id)), auth.raw, { recoveryCode },hash));
        }
        const mutation = req.method !== 'GET';
        const auth = (await authenticate(req, { required: true, mutation }));
        if(route==='/learning/state'&&req.method==='GET')return send(res,200,await game.state(auth.user.id));
        if(route==='/learning/history'&&req.method==='GET')return send(res,200,await game.history(auth.user.id));
        if(route==='/learning/preferences'){
            if(req.method==='GET')return send(res,200,await game.preferences(auth.user.id));
            S.check(req.method==='PUT',405,'METHOD','Используй сохранение с версией.');await rate(req,'learning-preferences',60,60,auth.user.id);
            return send(res,200,await game.savePreferences(auth.user.id,await body(req),now()));
        }
        if(route==='/learning/attempts'&&req.method==='POST'){
            await rate(req,'learning-attempt',120,3600,auth.user.id);
            return send(res,201,await game.start(auth.user.id,await body(req),now()));
        }
        if((match=route.match(new RegExp('^/learning/attempts/('+ID+')$')))){
            if(req.method==='GET')return send(res,200,await game.attempt(auth.user.id,match[1],now()));
            S.check(req.method==='POST',405,'METHOD','Метод не поддерживается.');await rate(req,'learning-submit',180,3600,auth.user.id);
            return send(res,200,await game.submit(auth.user.id,match[1],await body(req,65536),now()));
        }
        if(req.method==='POST'&&(match=route.match(new RegExp('^/learning/attempts/('+ID+')/cancel$'))))return send(res,200,await game.cancel(auth.user.id,match[1],await body(req),now()));
        if((match=route.match(/^\/lessons\/([a-zA-Z0-9_-]{1,160})\/rating$/))){
            if(req.method==='GET')return send(res,200,await game.rating(auth.user.id,match[1]));
            S.check(req.method==='PUT',405,'METHOD','Метод не поддерживается.');await rate(req,'lesson-rating',100,3600,auth.user.id);
            return send(res,200,await game.saveRating(auth.user.id,match[1],await body(req),now()));
        }
        if(route==='/comments'&&req.method==='POST'){
            await rate(req,'comment-create',30,3600,auth.user.id);return send(res,201,await game.createComment(auth.user.id,await body(req,20000),now()));
        }
        if(req.method==='PUT'&&(match=route.match(new RegExp('^/comments/('+ID+')$')))){
            await rate(req,'comment-update',100,3600,auth.user.id);return send(res,200,await game.updateComment(auth.user.id,match[1],await body(req,20000),now()));
        }
        if (req.method === 'POST' && route === '/auth/logout') {
            (await store.revokeSession(auth.raw));
            return send(res, 200, { signedOut: true }, { 'Set-Cookie': cookie('', true) });
        }
        if (req.method === 'POST' && route === '/auth/password') {
            (await rate(req, 'password', 6, 900, auth.user.id));
            const input = await body(req);
            S.exactFields(input, ['currentPassword', 'password']);
            const record = (await store.credentials(auth.user.username));
            const hash = await expensive(async () => {
                S.check(await S.verifyPassword(input.currentPassword, record.password_hash), 401, 'LOGIN_FAILED', 'Текущий пароль не подошёл.');
                return S.hashPassword(S.password(input.password));
            });
            S.check((await store.credentials(auth.user.username)).password_hash === record.password_hash, 409, 'CREDENTIAL_CHANGED', 'Пароль уже изменился. Войди заново.');
            const recoveryCode = S.token();
            (await store.resetPassword(auth.user.id, hash, S.sha(recoveryCode), now(),{passwordHash:record.password_hash}));
            return (await rotate(req, res, auth.user, auth.raw, { recoveryCode },hash));
        }
        if ((match = route.match(/^\/(catalog|preferences)$/))) {
            const kind = match[1];
            if (req.method === 'GET')
                return send(res, 200, (await store.getObject(auth.user.id, kind)));
            S.check(req.method === 'PUT', 405, 'METHOD', 'Используй сохранение с версией.');
            (await rate(req, 'object-write', 120, 60, auth.user.id));
            const input = await body(req, kind === 'catalog' ? V.MAX_CATALOG + 65536 : 65536);
            S.exactFields(input, ['expectedRevision', 'raw']);
            return send(res, 200, (await store.putObject(auth.user.id, kind, V.revision(input.expectedRevision), V.objectRaw(kind, input.raw), now())));
        }
        if (route === '/library') {
            if (req.method === 'GET')
                return send(res, 200, { items: (await store.listMelodies(auth.user.id)) });
            S.check(req.method === 'POST', 405, 'METHOD', 'Метод не поддерживается.');
            (await rate(req, 'melody-create', 30, 3600, auth.user.id));
            const input = await body(req, 1024 * 1024);
            S.exactFields(input, ['data', 'operationId']);
            return send(res, 201, (await store.createMelody(auth.user.id, V.melodyData(input.data), now(), V.operationId(input.operationId))));
        }
        if ((match = route.match(new RegExp('^/library/(' + ID + ')$')))) {
            if (req.method === 'GET')
                return send(res, 200, (await store.melody(auth.user.id, match[1])));
            S.check(req.method === 'PUT', 405, 'METHOD', 'Метод не поддерживается.');
            (await rate(req, 'melody-update', 120, 3600, auth.user.id));
            const input = await body(req, 1024 * 1024);
            S.exactFields(input, ['expectedRevision', 'data']);
            return send(res, 200, (await store.updateMelody(auth.user.id, match[1], V.revision(input.expectedRevision), V.melodyData(input.data), now())));
        }
        if (req.method === 'POST' && (match = route.match(new RegExp('^/library/(' + ID + ')/(publish|unpublish)$')))) {
            (await rate(req, 'publish', 30, 86400, auth.user.id));
            const input = await body(req);
            if (match[2] === 'unpublish') {
                S.exactFields(input, ['expectedPublicationRevision']);
                return send(res, 200, (await store.unpublish(auth.user.id, match[1], V.revision(input.expectedPublicationRevision), now())));
            }
            S.exactFields(input, ['expectedRevision', 'expectedPublicationRevision', 'rightsConfirmed', 'rights']);
            S.check(input.rightsConfirmed === true, 400, 'RIGHTS', 'Подтверди право публиковать эту музыку и описание.');
            V.text(input.rights, 2000, 10);
            return send(res, 200, (await store.publish(auth.user.id, match[1], V.revision(input.expectedRevision), V.revision(input.expectedPublicationRevision), input.rights, now())));
        }
        if (route === '/feedback') {
            if (req.method === 'GET')
                return send(res, 200, { items: (await store.feedbackList(auth.user.id)) });
            S.check(req.method === 'POST', 405, 'METHOD', 'Метод не поддерживается.');
            (await rate(req, 'feedback', 10, 86400, auth.user.id));
            const input = V.feedback(await body(req, 65536));
            return send(res, 201, (await store.createFeedback(auth.user.id, input.title, input.body, input.target, now(), input.operationId)));
        }
        S.check(false, 404, 'NOT_FOUND', 'Путь не найден.');
    }
    return { server, store, game, options, close: async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); (await store.close()); } };
}
if (require.main === module) {
    const development = process.env.MELODIA_SERVICE_DEVELOPMENT === '1';
    if (!process.env.MELODIA_SERVICE_DATA_DIR || !process.env.MELODIA_SERVICE_ORIGIN)
        throw Error('Explicit data directory and canonical origin are required');
    const database=process.env.MELODIA_POSTGRES_CONFIG?new PostgresDatabase(require('./db-config.cjs').loadPostgresConfig(process.env.MELODIA_POSTGRES_CONFIG)):undefined;
    createService({ development, database, dataDir: process.env.MELODIA_SERVICE_DATA_DIR, origin: process.env.MELODIA_SERVICE_ORIGIN,
        maintenanceReadOnly:process.env.MELODIA_MAINTENANCE_READ_ONLY==='1',
        registrationEnabled: process.env.MELODIA_REGISTRATION_ENABLED === '1' || (development && process.env.MELODIA_REGISTRATION_ENABLED !== '0'),
        trustProxy: process.env.MELODIA_SERVICE_TRUST_PROXY === '1', onError: error => console.error(error.code, error.name) }).then(service => {
        const socket = process.env.MELODIA_SERVICE_SOCKET;
        service.server.once('error', async (error) => { console.error('Account API listener failed:', error.code || error.name); (await service.store.close()); process.exitCode = 1; });
        if (socket) {
            const resolved = path.resolve(socket), parent = path.dirname(resolved);
            S.check(resolved === socket && path.basename(socket) === 'api.sock' && fs.realpathSync(parent) === parent, 500, 'SOCKET_PATH', 'Некорректный путь сокета.');
            // An existing socket is never deleted automatically by an HTTP process.
            S.check(!fs.existsSync(socket), 500, 'SOCKET_BUSY', 'Сокет уже существует. Проверь прежний процесс.');
            service.server.listen(socket, () => { fs.chmodSync(socket, 0o666); console.log('MelodiaJest account API ready on private Unix socket'); });
        }
        else
            service.server.listen(Number(process.env.MELODIA_SERVICE_PORT || 8081), process.env.MELODIA_SERVICE_BIND || '127.0.0.1', () => console.log('MelodiaJest account API ready'));
        let closing = false;
        for (const signal of ['SIGTERM', 'SIGINT'])
            process.on(signal, () => { if (!closing) {
                closing = true;
                void service.close().then(() => process.exit(0));
            } });
    }).catch(error => { console.error('Account API startup failed:', error.code || error.name); process.exitCode = 1; });
}
module.exports = { createService, API, config };
