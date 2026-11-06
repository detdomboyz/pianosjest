# Подготовка инструкции первого выпуска MelodiaJest на общем хосте

6 ноября 2026 года. Отдельный ответ на просьбу пользователя изучить размещение Libreta/Praicer и объяснить регистрацию домена в Selectel. Учебная партия не создавалась, число уроков и музыкальные редакции не менялись. Домен не покупался, DNS, серверные файлы и работающие контейнеры не изменялись.

## Подтверждено

- Локальные источники: `libre/deploy/vps/compose.yaml`, `libre/deploy/vps/Caddyfile`, `diary/PUBLIC_DEPLOYMENT.md`, `diary/deploy/production/compose.yaml`, `diary/deploy/production/manage.py`, документы/compose Grigorova. Существующий SSO изучен по `libre/src/lib/praicer-sso-policy.ts` и серверному модулю; чужие конфиги и секреты не копировались.
- Актуальный DNS: Libreta и Praicer указывают на `135.106.217.27`; MelodiaJest пока NXDOMAIN. Последнее не доказывает доступность регистрации.
- Чтение по существующему SSH-ключу: общий Caddy `libre-caddy-1`, версия 2.11.4, сеть `libre_public`, одиночный bind mount `/opt/libre/deploy/vps/Caddyfile` → `/etc/caddy/Caddyfile`, существующее постоянное хранилище сертификатов. Прочие сервисы разделены контейнерами; присутствует Grigorova.
- HTTPS при проверке: Libreta 200, Praicer 307. Снимок ресурсов: около 1828 MiB available памяти, 7,9 ГБ доступного диска, занято 84%; нагрузочная ёмкость не измерялась. Выбран первый статический выпуск с локальной сборкой.
- Первичные источники регистрации/DNS: [регистрация Selectel](https://docs.selectel.ru/domains/register-domain/), [DNS quickstart](https://docs.selectel.ru/dns-hosting/quickstart/), [A-записи](https://docs.selectel.ru/dns-hosting/records/connect-domain-to-ip-address/). Для HTTPS/контейнеров: [Caddy](https://caddyserver.com/docs/automatic-https), [reload](https://caddyserver.com/docs/command-line#caddy-reload), [Compose networking](https://docs.docker.com/compose/how-tos/networking/), [официальный nginx](https://hub.docker.com/_/nginx).

## Подготовлено

- `docs/MELODIAJEST_SELECTEL_SETUP.md`: регистрация на владельца, актуальное оформление цены и автопродление, новая зона и две записи, сборка/передача только разрешённых файлов, проверка manifest и SHA256, запуск своего контейнера, сохранение inode Caddyfile, точечный reload, HTTPS-проверки, перенос каталога перед прогрессом, обновление и откат.
- `deploy/shared-host/compose.yaml`: официальный уже имеющийся nginx, существующая external-сеть, alias `melodiajest-web`, 8080 только внутри сети, непривилегированный UID, read-only и tmpfs, ограниченные ресурсы/логи, healthcheck.
- `deploy/shared-host/nginx.conf`: только статика, корректные MIME-типы, revalidation стабильных имён, 404 отсутствующим путям и закрытые dotfiles. У `server.cjs` и общего JSON-каталога нет backend-маршрута.
- `deploy/shared-host/Caddyfile.fragment`: основной домен и каноническое перенаправление `www`, без изменения соседних блоков. Отмечена необходимость сохранить этот блок также в исходниках общего прокси в отдельном этапе публикации, чтобы дальнейший релиз Libreta не удалил его.
- Обновлены план веб-версии и состояние готовности продукта. Исходная версия приложения 23.5.30 сохранена. Публикуемая папка — `dist/web`, не ограниченный пакет `dist/next`.

## Проверки

- `npm run build:web` — успешно, 27 разрешённых ресурсов плюс manifest.
- `node --preserve-symlinks --preserve-symlinks-main --test tests/web-release.test.cjs` — **4/4**. Проверены allowlist, запрет API/native/source/traversal в preview, выполнение реального браузерного JS без серверного API, явная ошибка переполнения хранения. Сообщение `Storage full` — намеренная тестовая инъекция, все тесты прошли.
- Установленный Compose client: `config --quiet` — успешно. Проверка выполнена напрямую имеющимся `docker-compose.exe` с отдельным пустым CLI-config; daemon не требовался.
- Четыре блока PowerShell — Parser без ошибок; четыре блока Bash — `bash -n` без выполнения команд; вложенный Python — compile без выполнения. Bash parser использован через SSH stdin, без сохранения файлов.
- Подготовленный файл Caddy, переданный через stdin: `caddy adapt --config - --adapter caddyfile` на 2.11.4 — успешно. Reload, Caddy validate полного будущего конфига и выпуск сертификатов не запускались.
- JSON состояния и `git diff --check` проверяются после финальной записи документов. Полные музыкальные тесты/аудиты не повторялись: исполняемый код, ноты, модель прогресса и педагогика не изменены.

## Ограничения и продолжение

Локальный Linux engine Docker Desktop не запущен. Поэтому runtime nginx и маршруты нового домена ещё не проверены. Инструкция требует `docker compose run --rm --no-deps web -t`, успешного запуска/healthcheck и GET из Caddy **до** добавления публичного маршрута; затем проверяются настоящий TLS, 404 приватных путей и поведение приложения/MIDI.

Общий вход/облачное хранение пока не готовы; первый выпуск хранит данные в браузере. Разрешения MIDI и все настройки автоматически между origin не переносятся; конфликтующие непустые истории импорта не затираются. Регистрация и DNS выполняются владельцем отдельно; техническая публикация — следующий явно выделенный этап после их проверки. `guitarjest`, `trainer-content.json`, пользовательское хранилище, серверные данные и `lesson-review-baseline.js` не менялись. Commit/push не выполнялись.
