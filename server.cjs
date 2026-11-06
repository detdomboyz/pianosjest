const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, 'trainer-content.json');
const MIDI_KEYBOARD_SCRIPT = path.join(ROOT, 'midi-keyboard.ps1');
const START_PORT = 5173;
const MAX_TRIES = 25;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MIDI_BRIDGE_TOKEN = crypto.randomBytes(24).toString('hex');
const midiBridgeClients = new Set();
let midiBridgeState = { connected: false, windowOpen: false };
const midiBridgeWatchdog = setInterval(() => {
  if ((midiBridgeState.connected || midiBridgeState.windowOpen) && midiBridgeState.at && Date.now() - midiBridgeState.at > 6500) {
    midiBridgeState = { connected: false, windowOpen: false, at: Date.now() };
    broadcastMidiBridgeEvent('status', midiBridgeState);
  }
}, 2000);
midiBridgeWatchdog.unref();

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req, callback) {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      callback(new Error('Слишком большой файл данных.'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      callback(null, JSON.parse(text || '{}'));
    } catch (error) {
      callback(new Error('Некорректный JSON.'));
    }
  });
  req.on('error', callback);
}

function isCatalog(value) {
  return value && typeof value === 'object' && Array.isArray(value.themes) && Array.isArray(value.lessons);
}

function handleContentApi(req, res) {
  if (req.method === 'GET') {
    fs.readFile(CONTENT_FILE, 'utf8', (error, text) => {
      if (error && error.code === 'ENOENT') return sendJson(res, 200, { catalog: null });
      if (error) return sendJson(res, 500, { error: 'Не удалось прочитать данные редактора.' });
      try {
        const catalog = JSON.parse(text);
        return sendJson(res, 200, { catalog });
      } catch (parseError) {
        return sendJson(res, 500, { error: 'Файл trainer-content.json повреждён.' });
      }
    });
    return;
  }

  if (req.method === 'PUT') {
    readJsonBody(req, (error, catalog) => {
      if (error) return sendJson(res, 400, { error: error.message });
      if (!isCatalog(catalog)) return sendJson(res, 400, { error: 'Ожидались массивы themes и lessons.' });

      const temporaryFile = CONTENT_FILE + '.tmp';
      const json = JSON.stringify(catalog, null, 2) + '\n';
      fs.writeFile(temporaryFile, json, 'utf8', (writeError) => {
        if (writeError) return sendJson(res, 500, { error: 'Не удалось сохранить данные редактора.' });
        fs.rename(temporaryFile, CONTENT_FILE, (renameError) => {
          if (renameError) return sendJson(res, 500, { error: 'Не удалось завершить сохранение.' });
          return sendJson(res, 200, { ok: true });
        });
      });
    });
    return;
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end('Method Not Allowed');
}

function writeMidiBridgeEvent(res, eventName, value) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`);
}

function broadcastMidiBridgeEvent(eventName, value) {
  for (const client of Array.from(midiBridgeClients)) {
    try { writeMidiBridgeEvent(client, eventName, value); }
    catch (error) { midiBridgeClients.delete(client); }
  }
}

function handleMidiBridgeStream(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    return res.end('Method Not Allowed');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': Piano Blind Trainer MIDI bridge\n\n');
  midiBridgeClients.add(res);
  writeMidiBridgeEvent(res, 'ready', { ok: true });
  writeMidiBridgeEvent(res, 'status', midiBridgeState);
  req.once('close', () => midiBridgeClients.delete(res));
}

function handleMidiBridgePost(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    return res.end('Method Not Allowed');
  }
  if (String(req.headers['x-pbt-bridge-token'] || '') !== MIDI_BRIDGE_TOKEN) {
    return sendJson(res, 403, { ok: false, error: 'Недействительный ключ MIDI-моста.' });
  }
  readJsonBody(req, (error, event) => {
    if (error) return sendJson(res, 400, { ok: false, error: error.message });
    if (event && event.type === 'midi') {
      const note = Math.round(Number(event.note));
      const velocity = Math.max(0, Math.min(127, Math.round(Number(event.velocity) || 0)));
      if (!Number.isInteger(note) || note < 0 || note > 127 || typeof event.on !== 'boolean') {
        return sendJson(res, 400, { ok: false, error: 'Некорректное MIDI-событие.' });
      }
      broadcastMidiBridgeEvent('midi', { note, on: event.on, velocity, at: Date.now() });
      return sendJson(res, 200, { ok: true });
    }
    if (event && event.type === 'status') {
      midiBridgeState = { connected: Boolean(event.connected), windowOpen: Boolean(event.windowOpen), at: Date.now() };
      broadcastMidiBridgeEvent('status', midiBridgeState);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { ok: false, error: 'Неизвестное событие MIDI-моста.' });
  });
}

function readMidiKeyboardSource() {
  const container = fs.readFileSync(MIDI_KEYBOARD_SCRIPT, 'utf8').replace(/^\uFEFF/, '');
  const match = container.match(/\$source\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/);
  if (!match) throw new Error('В midi-keyboard.ps1 не найден исходный код Windows-программы. Распакуй архив заново.');
  return match[1].replace(/\r?\n/g, '\r\n') + '\r\n';
}

function findWindowsCSharpCompiler() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    process.env.PBT_CSC_PATH,
    path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function buildMidiKeyboardExecutable() {
  if (!fs.existsSync(MIDI_KEYBOARD_SCRIPT)) throw new Error('Файл midi-keyboard.ps1 не найден рядом с проектом.');
  const source = readMidiKeyboardSource();
  const sourceId = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
  const temporaryRoot = os.tmpdir();
  const sourceFile = path.join(temporaryRoot, `pbt-midi-keyboard-${sourceId}.cs`);
  const executable = path.join(temporaryRoot, `PianoBlindTrainerMidiKeyboard-${sourceId}.exe`);
  const readyMarker = executable + '.ready';
  try {
    if (fs.statSync(executable).size > 4096 && fs.readFileSync(readyMarker, 'utf8').trim() === sourceId) return executable;
  } catch (error) { }

  const compiler = findWindowsCSharpCompiler();
  if (!compiler) {
    throw new Error('Не найден штатный компилятор Windows csc.exe из .NET Framework 4. Установи или включи компонент «.NET Framework 4.x» в Windows и повтори запуск.');
  }
  fs.writeFileSync(sourceFile, '\uFEFF' + source, 'utf8');
  const compile = spawnSync(compiler, [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    `/out:${executable}`,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    sourceFile
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (compile.error) throw new Error('Windows не смогла запустить компилятор C#: ' + compile.error.message);
  const diagnostics = [compile.stdout, compile.stderr].map(value => String(value || '').replace(/^\uFEFF/, '').trim()).filter(Boolean).join(' ');
  if (compile.status !== 0 || !fs.existsSync(executable)) {
    throw new Error('Не удалось собрать Windows-программу.' + (diagnostics ? ' Сообщение компилятора: ' + diagnostics : ' Код компилятора: ' + compile.status + '.'));
  }
  fs.writeFileSync(readyMarker, sourceId + '\n', 'utf8');
  return executable;
}


function handleMidiKeyboardLaunch(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' });
    return res.end('Method Not Allowed');
  }
  if (process.platform !== 'win32') {
    return sendJson(res, 400, { ok: false, error: 'Этот режим сейчас поддерживается только в Windows.' });
  }
  const statusFile = path.join(os.tmpdir(), `pbt-midi-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.status`);
  const logFile = statusFile + '.log';
  const bridgeUrl = `http://127.0.0.1:${req.socket.localPort}/api/midi-bridge/event`;
  let child;
  try {
    const executable = buildMidiKeyboardExecutable();
    child = spawn(executable, ['--status', statusFile, '--log', logFile, '--bridge', bridgeUrl, '--bridge-token', MIDI_BRIDGE_TOKEN], {
      cwd: ROOT,
      detached: true,
      windowsHide: false,
      stdio: 'ignore'
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: 'Не удалось подготовить или запустить Windows-программу: ' + error.message });
  }

  let finished = false;
  let pollTimer = null;
  let timeoutTimer = null;

  const removeStatusFile = () => {
    fs.unlink(statusFile, () => {});
    fs.unlink(logFile, () => {});
  };
  const readLaunchLog = () => {
    try {
      return fs.readFileSync(logFile, 'utf8').replace(/^\uFEFF/, '').trim().slice(0, 1800);
    } catch (error) {
      return '';
    }
  };
  const finish = (statusCode, body) => {
    if (finished) return;
    finished = true;
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    child.removeAllListeners('error');
    child.removeAllListeners('exit');
    child.unref();
    removeStatusFile();
    if (!res.writableEnded) sendJson(res, statusCode, body);
  };
  const readLaunchStatus = () => {
    let status;
    try {
      status = fs.readFileSync(statusFile, 'utf8').replace(/^\uFEFF/, '').trim();
    } catch (error) {
      if (error.code !== 'ENOENT') finish(500, { ok: false, error: 'Не удалось прочитать подтверждение запуска Windows-программы: ' + error.message });
      return false;
    }
    if (!status) return false;
    if (status.startsWith('STARTING:')) return false;
    if (status.startsWith('READY:')) {
      finish(200, { ok: true, message: status.slice(6) || 'Окно MIDI-клавиатуры запущено на этом ПК.' });
      return true;
    }
    if (status.startsWith('ERROR:')) {
      const details = readLaunchLog();
      finish(500, { ok: false, error: 'Windows-программа не запустилась: ' + status.slice(6, 1606) + (details ? ' Подробность: ' + details : '') });
      return true;
    }
    finish(500, { ok: false, error: 'Windows-программа вернула непонятный статус запуска.' });
    return true;
  };

  child.once('error', (error) => {
    finish(500, { ok: false, error: 'Не удалось запустить Windows-программу: ' + error.message });
  });
  child.once('exit', (code) => {
    if (finished || readLaunchStatus()) return;
    setTimeout(() => {
      if (!finished && !readLaunchStatus()) {
        const details = readLaunchLog();
        finish(500, { ok: false, error: 'Windows EXE завершился до реального показа окна. Код: ' + code + '.' + (details ? ' Системная ошибка: ' + details : ' Запусти START-MIDI-KEYBOARD.cmd — теперь он использует тот же EXE и оставляет диагностику в консоли.') });
      }
    }, 250);
  });
  pollTimer = setInterval(readLaunchStatus, 100);
  timeoutTimer = setTimeout(() => {
    if (!readLaunchStatus()) {
      const details = readLaunchLog();
      finish(500, { ok: false, error: 'Окно MIDI-клавиатуры не подтвердило реальный показ за 20 секунд.' + (details ? ' Системная ошибка: ' + details : ' Запусти START-MIDI-KEYBOARD.cmd рядом с проектом для прямой диагностики EXE.') });
    }
  }, 20000);
}

function runMidiKeyboardFromConsole() {
  if (process.platform !== 'win32') {
    console.error('Режим «Пианино → клавиатура ПК» поддерживается только в Windows.');
    process.exitCode = 1;
    return;
  }
  let executable;
  try {
    console.log('Проверяю и при необходимости собираю Windows EXE...');
    executable = buildMidiKeyboardExecutable();
  } catch (error) {
    console.error('Ошибка подготовки Windows EXE:');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
    return;
  }
  console.log('Запускаю окно «Пианино → клавиатура ПК» напрямую:');
  console.log(executable);
  const child = spawn(executable, [], { cwd: ROOT, windowsHide: false, stdio: 'inherit' });
  child.once('error', error => {
    console.error('Windows не смогла открыть EXE: ' + error.message);
    process.exitCode = 1;
  });
  child.once('exit', code => {
    if (code) console.error('Windows EXE завершился с кодом ' + code + '.');
    else console.log('Окно закрыто нормально.');
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    console.log('Open this URL manually:', url);
  }
}

function makeServer() {
  return http.createServer((req, res) => {
    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    if (cleanUrl === '/api/content') return handleContentApi(req, res);
    if (cleanUrl === '/api/midi-keyboard/launch') return handleMidiKeyboardLaunch(req, res);
    if (cleanUrl === '/api/midi-bridge/events') return handleMidiBridgeStream(req, res);
    if (cleanUrl === '/api/midi-bridge/event') return handleMidiBridgePost(req, res);

    const requestedPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, requestedPath);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
}

function listen(port, triesLeft) {
  const server = makeServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) return listen(port + 1, triesLeft - 1);
    console.error('Server error:', err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log('Piano Blind Trainer v23.4.1 is running:');
    console.log(url);
    console.log('Themes and lessons are saved to trainer-content.json.');
    console.log('Close this window to stop the local server.');
    openBrowser(url);
  });
}

module.exports = { readMidiKeyboardSource, findWindowsCSharpCompiler, buildMidiKeyboardExecutable, makeServer, MIDI_BRIDGE_TOKEN };

if (require.main === module) {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error('index.html not found. Extract the ZIP before running.');
    process.exit(1);
  }
  if (process.argv.includes('--midi-keyboard')) runMidiKeyboardFromConsole();
  else listen(START_PORT, MAX_TRIES);
}
