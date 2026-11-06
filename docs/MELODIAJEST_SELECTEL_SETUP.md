# MelodiaJest: домен Selectel и первый выпуск на общем VPS

Проверено 6 ноября 2026 года. Это инструкция для отдельного этапа публикации. Покупка, оплата, изменение DNS и применение серверной конфигурации при её подготовке не выполнялись.

## Что уже работает на сервере

По исходникам Libreta (`libre/deploy/vps`) и Praicer (`diary/deploy/production`), публичному DNS и чтению сервера по SSH:

| Компонент | Подтверждённое размещение |
| --- | --- |
| Общий VPS | `135.106.217.27` |
| Libreta | `libreta.ru`, `/opt/libre`, Next.js / PostgreSQL, свои контейнеры |
| Praicer | `praicer.ru`, `/opt/diary`, Next.js / Python / PostgreSQL, свои контейнеры |
| Общий HTTPS-вход | `libre-caddy-1`, Caddy 2.11.4, публичные порты 80/443 |
| Общая сеть входных контейнеров | `libre_public` |
| Действующий файл Caddy | `/opt/libre/deploy/vps/Caddyfile` → `/etc/caddy/Caddyfile` внутри контейнера |
| Ещё один сосед | Grigorova; его маршрут также нужно сохранить |

При проверке Libreta вернула HTTP 200, Praicer — HTTP 307. Доступно около 1,8 ГБ оперативной памяти и 7,9 ГБ диска; это снимок состояния, не результат нагрузочного теста. В DNS для `melodiajest.ru` пока нет имени; доступность покупки определяет регистратор.

Для первого выпуска подходит тот же VPS. Добавляем один небольшой статический контейнер, существующий Caddy выбирает сайт по домену:

```text
melodiajest.ru → 135.106.217.27:443 → libre-caddy-1
                                      ↓ libre_public
                                melodiajest-web:8080
                                      ↓
                            только файлы dist/web
```

Новый VPS, база данных, Node-сервер и отдельный публичный порт для этой сборки не нужны. Собираем на компьютере. Обычный локальный `server.cjs`, общий `trainer-content.json`, Windows-запуск и локальный MIDI-мост в интернет не переносятся. Пакет `dist/next` пока содержит только отдельную часть приложения; для первого полного браузерного выпуска используем **`dist/web`**.

## 1. Купить домен в Selectel

В [панели Selectel](https://my.selectel.ru/) открой **Продукты → Домены**, выбери свой проект → **Зарегистрировать домен**. Введи `melodiajest`, проверь доступность именно `melodiajest.ru` и нажми **Оформить**, если он доступен. Выбери своего существующего администратора домена либо введи новые данные владельца непосредственно в Selectel. Проверь итоговую цену, условия и оплати. Дождись статуса **ACTIVE** и письма о регистрации. Цена берётся из актуального оформления; старые цены из документов проектов здесь не используются. [Официальные шаги регистрации](https://docs.selectel.ru/domains/register-domain/).

`.ru` оформляется на год. По умолчанию включено автопродление: при достаточном балансе деньги за следующий год списываются за 60 дней до окончания регистрации. Проверь, подходит ли тебе эта настройка. DNS NXDOMAIN сам по себе не подтверждает, что имя свободно для покупки. [Срок и автопродление](https://docs.selectel.ru/domains/register-domain/).

## 2. Направить домен на имеющийся сервер

В **Продукты → DNS-хостинг** используй актуальную версию сервиса. Если зоны ещё нет, добавь **`melodiajest.ru.`** с конечной точкой и включённой активацией. DNS Selectel бесплатный; для первого доступа документация указывает пополнение минимум на 200 ₽ — сумма остаётся на балансе для услуг. Если сервис уже доступен в твоём аккаунте, новое пополнение ради DNS может не потребоваться. [Создание зоны](https://docs.selectel.ru/dns-hosting/quickstart/).

Добавь записи только в новой зоне:

| Имя группы в Selectel | Тип | Значение | TTL |
| --- | --- | --- | --- |
| **Оставить пустым** — корень зоны | A | `135.106.217.27` | `300` |
| `www` | CNAME | `melodiajest.ru.` | `300` |

В поле корня в этой панели не нужно писать `@`. Неподтверждённую AAAA-запись не добавляем. Для первого выпуска почтовые MX и платный SSL не требуются. [Записи DNS](https://docs.selectel.ru/dns-hosting/records/connect-domain-to-ip-address/).

У зарегистрированного в Selectel домена управление DNS делегируется в Selectel автоматически. Проверь серверы имён: **`a.ns.selectel.ru`, `b.ns.selectel.ru`, `c.ns.selectel.ru`, `d.ns.selectel.ru`**. В зоне NS/SOA создаются автоматически. Распространение DNS может занимать до 72 часов. Зоны Libreta и Praicer не редактируем. [Делегирование](https://docs.selectel.ru/dns-hosting/quickstart/).

Проверка в PowerShell:

```powershell
Resolve-DnsName melodiajest.ru -Type A
Resolve-DnsName www.melodiajest.ru -Type A
Resolve-DnsName melodiajest.ru -Type NS
```

Оба имени должны приводить к `135.106.217.27`; для `www` допустим промежуточный CNAME. До этого шага новый маршрут Caddy не включаем.

## 3. Собрать выпуск на компьютере

В PowerShell в папке `C:\Users\Alexander\Documents\web\pianosjest`:

```powershell
npm run build:web
if ($LASTEXITCODE -ne 0) { throw 'Сборка не прошла' }
$release = (Get-Content package.json -Raw | ConvertFrom-Json).version
$archive = "dist/melodiajest-web-$release.tar.gz"
if (Test-Path $archive) { throw 'Архив с таким именем уже есть; сохрани его или выбери новое имя' }
tar -czf $archive -C dist/web .
if ($LASTEXITCODE -ne 0) { throw 'Архивация не прошла' }
Get-FileHash $archive -Algorithm SHA256
```

На момент подготовки версия — **23.5.30**, в веб-каталоге 27 разрешённых ресурсов и `web-release.json`. При последующем выпуске используй фактическую версию. Архивируем только `dist/web`; ни корень проекта, ни личный каталог не добавляем. Перед публикацией нового изменённого кода выполняются применимые проверки из `AGENTS.md`; готовый результат партии 30 описан в `docs/reports/piano-curriculum-2026-11-06-30.md`.

До смены адреса экспортируй **каталог** в старом приложении, а затем отдельно **прогресс / подготовки** из журнала. Сохрани оба JSON-файла на компьютере. Данные `localhost` автоматически на домен не переедут.

## 4. Передать архив и конфиги

Используем имеющийся ключ `~/.ssh/libre_vps` и проверенный SSH-хост; новый ключ на сервер добавлять не нужно. Ниже тот же способ выбора исходного Ethernet-адреса, который использует существующий помощник Praicer. Если подключение сейчас идёт через другой интерфейс, сначала подставь его действующий адрес.

```powershell
$serverAddress = '135.106.217.27'
$sshKey = Join-Path $env:USERPROFILE '.ssh/libre_vps'
$bindAddress = Get-NetIPAddress -InterfaceAlias Ethernet -AddressFamily IPv4 |
    Where-Object AddressState -EQ Preferred |
    Select-Object -First 1 -ExpandProperty IPAddress
if (-not $bindAddress) { throw 'Не найден IPv4 Ethernet для SSH' }
$sshOptions = @('-i', $sshKey, '-o', "BindAddress=$bindAddress",
    '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes')
ssh @sshOptions "root@$serverAddress" 'install -d -m 755 /opt/melodiajest/incoming /opt/melodiajest/releases /opt/melodiajest/deploy /opt/melodiajest/ops'
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить каталог' }
scp @sshOptions $archive deploy/shared-host/compose.yaml deploy/shared-host/nginx.conf deploy/shared-host/Caddyfile.fragment "root@${serverAddress}:/opt/melodiajest/incoming/"
if ($LASTEXITCODE -ne 0) { throw 'Передача не прошла' }
ssh @sshOptions "root@$serverAddress"
```

Не отключай проверку SSH-ключа хоста. Если fingerprint неожиданно изменился, сначала нужно проверить сервер через доверенную панель.

## 5. Поднять только контейнер MelodiaJest

Дальше команды в **SSH на Linux**, не в PowerShell. Это блок **первого** запуска: повторная установка на существующий `current` остановится. Версию замени, если собран другой выпуск. Сначала сравни SHA256 архива с выводом PowerShell:

```bash
sha256sum /opt/melodiajest/incoming/melodiajest-web-23.5.30.tar.gz
```

Если совпало:

```bash
bash <<'MELODIA_FIRST_RELEASE'
set -euo pipefail
release=23.5.30
base=/opt/melodiajest
test ! -e "$base/current"
test ! -L "$base/current"
test ! -e "$base/releases/$release"
docker network inspect libre_public >/dev/null
docker image inspect nginx:stable-alpine --format '{{json .RepoDigests}}'
test -s "$base/incoming/melodiajest-web-$release.tar.gz"
mkdir "$base/releases/$release"
tar --no-same-owner -xzf "$base/incoming/melodiajest-web-$release.tar.gz" -C "$base/releases/$release"
python3 - "$base/releases/$release" "$release" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'web-release.json').read_text())
assert manifest['version'] == sys.argv[2]
assert manifest['mode'] == 'web' and manifest['storage'] == 'browser'
assert manifest['nativeCompanion'] is False
expected = set(manifest['files']) | {'web-release.json'}
assert {p.name for p in root.iterdir()} == expected
for name, entry in manifest['files'].items():
    assert pathlib.PurePosixPath(name).name == name and '\\' not in name
    path = root / name
    assert path.is_file() and not path.is_symlink()
    data = path.read_bytes()
    assert len(data) == entry['bytes']
    assert hashlib.sha256(data).hexdigest() == entry['sha256']
print('Версия, состав и контрольные суммы выпуска совпали')
PY
find "$base/releases/$release" -type d -exec chmod 755 {} +
find "$base/releases/$release" -type f -exec chmod 644 {} +
install -m 644 "$base/incoming/compose.yaml" "$base/deploy/compose.yaml"
install -m 644 "$base/incoming/nginx.conf" "$base/deploy/nginx.conf"
install -m 644 "$base/incoming/Caddyfile.fragment" "$base/deploy/Caddyfile.fragment"
ln -s "releases/$release" "$base/current"
cd "$base/deploy"
docker compose config --quiet
docker compose run --rm --no-deps web -t
docker compose up -d --wait web
docker compose exec -T web wget -q -O /dev/null http://127.0.0.1:8080/
docker exec libre-caddy-1 wget -q -O /dev/null http://melodiajest-web:8080/
docker compose ps
MELODIA_FIRST_RELEASE
```

Если блок закончился ошибкой — сначала исправляется она, к включению Caddy не переходим. Для диагностики: `cd /opt/melodiajest/deploy` и `docker compose logs --tail=80 web`. При неудачной первой распаковке существующий каталог версии нужно изучить, а затем продолжить с проверенной точки; повторный запуск намеренно не перезаписывает его молча.

Образ nginx уже имеется на проверенном сервере. `pull_policy: never` предотвращает незапланированную замену образа; записанный digest помогает воспроизвести выпуск. Контейнер работает без root, с файловой системой для чтения, лимитом 64 МБ и ограниченными логами; **8080 не публикуется на IP сервера**. Существующая сеть указывается как external. [Сети Compose](https://docs.docker.com/compose/how-tos/networking/), [официальный nginx](https://hub.docker.com/_/nginx).

## 6. Добавить домен в существующий Caddy

В новом фрагменте уже есть `melodiajest.ru` и перенаправление `www` на основной адрес. Перед применением повторно проверь публичный DNS. Не устанавливаем второй Caddy на порты 80/443 и не пересоздаём стек Libreta.

Следующий блок сохраняет все имеющиеся маршруты, проверяет кандидата, записывает конфиг **в существующий файл** и делает reload только Caddy. Это необходимо из-за одиночного bind mount: замена файла через `mv` может оставить контейнер на старом inode.

```bash
bash <<'MELODIA_ENABLE_CADDY'
set -euo pipefail
umask 077
live=/opt/libre/deploy/vps/Caddyfile
stamp=$(date -u +%Y%m%dT%H%M%SZ)
before=/opt/melodiajest/ops/Caddyfile.before-$stamp
candidate=/opt/melodiajest/ops/Caddyfile.candidate-$stamp
test -s "$live"
docker exec libre-caddy-1 cat /etc/caddy/Caddyfile | cmp -s - "$live"
if grep -Fq 'melodiajest.ru' "$live"; then
    echo 'Маршрут уже есть: нужен отдельный этап обновления, не повторное добавление.' >&2
    exit 1
fi
cp -p "$live" "$before"
chmod 600 "$before"
{ cat "$before"; printf '\n'; cat /opt/melodiajest/deploy/Caddyfile.fragment; } > "$candidate"
docker exec -i libre-caddy-1 caddy validate --config - --adapter caddyfile < "$candidate"
cmp -s "$before" "$live"
cat "$candidate" > "$live"
if ! docker exec libre-caddy-1 cat /etc/caddy/Caddyfile | cmp -s - "$candidate"; then
    cat "$before" > "$live"
    echo 'Caddy видит другой файл; конфиг возвращён, reload не выполнялся.' >&2
    exit 1
fi
if ! docker exec libre-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    cmp -s "$candidate" "$live"
    cat "$before" > "$live"
    docker exec -i libre-caddy-1 caddy reload --config - --adapter caddyfile < "$before"
    exit 1
fi
printf 'Копия до изменения: %s\nКандидат: %s\n' "$before" "$candidate"
MELODIA_ENABLE_CADDY
```

Сохрани выведенные пути до проверки сайта. Для сертификата нужны правильный DNS, доступные 80/443 и постоянное хранилище Caddy — последние два условия уже используются другими сайтами. Caddy выпускает и продлевает сертификаты автоматически; отдельная покупка SSL и установка Certbot не нужны. Выпуск сертификата может занять некоторое время. [HTTPS Caddy](https://caddyserver.com/docs/automatic-https), [reload](https://caddyserver.com/docs/command-line#caddy-reload).

После успешного включения этот же фрагмент нужно внести в версионируемый `C:\Users\Alexander\Documents\web\libre\deploy\vps\Caddyfile` в рамках согласованного этапа общего прокси. Иначе будущая выкладка Libreta из старой копии может убрать маршрут MelodiaJest. При подготовке этой инструкции чужой репозиторий не изменялся.

## 7. Проверить сайт и перенести личные данные

В PowerShell на компьютере:

```powershell
curl.exe -I https://melodiajest.ru/
curl.exe -I http://melodiajest.ru/
curl.exe -I https://www.melodiajest.ru/
curl.exe -I https://melodiajest.ru/web-release.json
curl.exe -I https://melodiajest.ru/server.cjs
curl.exe -I https://melodiajest.ru/trainer-content.json
curl.exe -I https://melodiajest.ru/.env
curl.exe -I https://melodiajest.ru/api/content
curl.exe -I https://libreta.ru/
curl.exe -I https://praicer.ru/
```

Ожидания: основной HTTPS — 200 без пропуска проверки сертификата; HTTP переходит на HTTPS, `www` — на основной домен; manifest — 200. `server.cjs`, `trainer-content.json`, `.env` и `/api/content` — **404**. Libreta и Praicer сохраняют прежнее поведение. В manifest опубликованная версия соответствует архиву; браузерные JS/CSS отдаются с корректными типами и без ошибок загрузки.

В обычной вкладке проверь «Обучение», «Произведения», выбор урока, показ нот, доступное раскрытие описания и режим памяти. Включи звук и выбери MIDI-устройство явным действием. Настоящий MIDI-путь проверяется с подключённым инструментом; успешный HTTP-запрос этого не доказывает.

На **основном** `https://melodiajest.ru` сначала импортируй сохранённый **каталог**, проверь ноты, редакции и порядок. Затем импортируй отдельный **экспорт прогресса / подготовок** через предпросмотр и явное подтверждение. После перезагрузки проверь данные и сделай новый экспорт. Не используй частичный pending-архив как завершённую резервную копию.

Первый импорт прогресса поддерживает пустую либо совпадающую историю назначения. Различающиеся непустые истории требуют отдельного разрешения конфликтов; их нельзя принудительно затирать. В новом браузерном origin заново выбираются разрешения и устройство MIDI; перенос всех персональных настроек не обещается. Переход с `www` на основной адрес предотвращает два разных пользовательских хранилища.

## 8. Последующие обновления и откат

Для нового выпуска: снова собрать на компьютере, загрузить новый архив, проверить SHA256 и manifest, распаковать в **новый** `/opt/melodiajest/releases/ВЕРСИЯ`. Сохранить прежнюю цель `readlink /opt/melodiajest/current`. После проверки новой папки переключить существующую ссылку `current` и выполнить из `/opt/melodiajest/deploy`:

```bash
docker compose up -d --force-recreate --no-deps --wait web
```

Пересоздаётся только контейнер MelodiaJest: Docker разрешает symlink bind mount при создании контейнера, поэтому одного переключения ссылки недостаточно. Для отката вернуть `current` на **сохранённую предыдущую** папку и выполнить ту же команду. Общий Caddy при обычном обновлении файлов не меняется. Новое содержимое `web-release.json` и браузерный smoke test подтверждают переключение. Стабильные имена ресурсов требуют перезагрузки уже открытых старых вкладок.

Если откат нужен сразу после первого добавления домена, использовать сохранённые `before` и `candidate` из шага 6: сначала убедиться `cmp`, что действующий Caddyfile всё ещё равен именно этому candidate. Если его уже менял другой проект, нужна выборочная правка блока MelodiaJest, полную копию поверх новых чужих изменений не возвращать. Если совпадает — вернуть before **записью в существующий файл**, проверить совпадение с файлом в контейнере и сделать `caddy reload`. При необходимости остановить только `web` из `/opt/melodiajest/deploy`. Не выполнять `docker compose down` в Libreta/Praicer, очистку Docker, удаление томов или перезапуск соседних баз.

Архив выпуска, конфиги и журнал версии хранятся вне публичной папки и копируются на компьютер/в существующее отдельное резервное хранилище. Личные данные этой первой версии находятся в браузере: серверная копия статики их не защищает, нужны собственные JSON-экспорты пользователя.

## Границы первого выпуска и точка продолжения

Доступны браузерный тренажёр, обучение и произведения, локальный каталог, MIDI/звук и перенос JSON. Сборка не создаёт облачный аккаунт, синхронизацию между устройствами или готовую интеграцию входа Libreta. Существующий Libreta–Praicer SSO рассчитан на клиент Praicer; MelodiaJest впоследствии получит собственный client ID, redirect allowlist и проверки доступа. Копировать секрет Praicer нельзя. Полный перенос интерфейса на React/Next.js и независимая преподавательская проверка курса остаются отдельными задачами.

При подготовке инструкции: подтверждены сервер, сеть, mount Caddy, версии и ответы соседних сайтов; синтаксис нового фрагмента прошёл `caddy adapt` на установленной версии без его применения. Локальный Docker Desktop установлен, но его Linux engine выключен, поэтому запуск nginx в контейнере ещё не проверен. Обязательные `docker compose run ... -t`, запуск, проверка из Caddy и реальные HTTPS/MIDI-проверки включены выше и выполняются **до принятия публикации**.

Точный следующий шаг пользователя: зарегистрировать `melodiajest.ru`, дождаться ACTIVE и настроить две записи новой зоны. Точный следующий технический этап: проверить их публичное разрешение, провести первый выпуск по шагам 3–7 и сохранить результаты проверок. На текущем этапе домен не куплен, DNS и серверные файлы не изменены, публикации нет.
