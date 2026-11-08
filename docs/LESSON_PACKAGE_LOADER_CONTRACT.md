# Браузерная загрузка частей, v1

7 ноября 2026. `piano-lesson-package-loader.js` — отдельный UMD-модуль с `.d.ts`; рабочий bundled-каталог к нему ещё не подключён. Import/create ничего не загружают и не открывают storage. Fetch, SubtleCrypto и необязательный Cache передаются явно; npm-зависимостей, Node-polyfill, Service Worker и нового публичного endpoint нет.

Общий `piano-lesson-parts-codec.js` используется браузером и прежним Node-производителем. Синхронные Parts.readManifest/readPart/build/assemble/write сохранены. После SHA256 конкретных байтов оба пути проверяют одинаковые схему, UTF-8 fatal и обратимую PianoCatalogAdapter-проекцию. Парсер ограничивает глубину JSON 80 и миллион узлов, отвергает нефинитные числа. Неподдерживаемая legacy-длительность сохраняется с INVALID_STEP_TIME в проекции; целостность не является педагогическим одобрением или зачётом.

## Источник и запросы

`create({baseUrl, origin, fetch, subtle, cache})` требует совпадающий origin, HTTPS либо loopback HTTP, отсутствие username/password/query/hash и конечный `/`. S3/CDN/CORS — отдельный будущий этап. Ключи генерируются как manifests/v1/<sha>.json и parts/v1/<sha>.json. URL из произвольных JSON-полей не исполняются, LIST/HEAD не выполняются.

`load({pin, active, signal, timeoutMs, reload})` получает доверенный pin: release, manifestSha256, webManifestSha256. Хеш удостоверяет байты, не автора. Выпуск — три компонента 0…999999 без ведущих нулей; downgrade и иной pin того же номера отвергаются до запроса. Active=null нужен для отдельного bootstrap. Будущий контроллер передаёт актуальный active из store и проверяет его снова перед commit. Pin копируется без вызова accessors.

GET использует same-origin, credentials=omit, redirect=error, referrerPolicy=no-referrer, cache=no-store и Accept=application/json. Клиентских ключей и auth-заголовков нет. HTTP/opaque/redirect/wrong-MIME, обрыв, отмена и неизвестный формат дают статическую типизированную ошибку без текста приватных данных. MIDI/звук не включаются, пустой каталог взамен старого не создаётся.

## Ограниченные байты и проверяемый кеш

Манифест до 256 КиБ, часть до 1 МиБ, сумма частей до 16 МиБ; загрузка последовательная, максимум 65 известных объектов. GetReader ограничивает фактические chunks, SubtleCrypto.digest проверяет SHA256, затем общий codec сверяет данные. Content-Length служит ранней границей только для identity: при сжатии размер/SHA относятся к декодированному body. Дедлайн всей операции — 15 с, настраиваемый диапазон 50…60000 мс. Cancel/timeout останавливают собственный fetch/reader.

Cache передаётся явно, содержит только входящие пакетные байты и не считается доверенным. Каждое чтение повторяет размер/SHA/decode и итоговую сверку source pin. Валидный по байтам манифест может кешироваться до сверки caller pin; это не активирует источник. Повреждённый кеш завершает операцию ошибкой; явный reload=true обходит запись и заменяет проверенными байтами. Сбой match ведёт к загрузке с cacheReadFailures; отказ put/квоты оставляет проверенный результат в памяти с cacheWriteFailures. Это не успех сохранения каталога. Частичный кеш допустим, частичный рабочий каталог не выдаётся.

Замороженный результат `{active, catalog, stats}` содержит исходный пакет, **не объединённый личный каталог и не commit**. Нет вызова Store.prepare/commit, localStorage, переноса прогресса или смены видимого урока. Requests/networkBytes/cacheHits — счётчики этого пути, не S3-биллинг и не все внутренние браузерные HTTP-повторы. Ключи immutable, но source.release входит в байты частей: межверсионное повторное использование не обещается. Польза CDN и скорость всего сайта не измерены.

В фазе 25 добавлен requireVerified: оригинальный замороженный Loaded зарегистрирован в WeakSet после полной проверки байтов; JSON/clone/spread не становятся доверенным входом планировщика. Сам load ничего не записывает. Отдельный [браузерный planner](LESSON_PACKAGE_PLANNER_CONTRACT.md) проверен на общем с Node алгоритме, с личными конфликтами и атомарным Store; две настоящие QA-вкладки проверили позднюю запись. Рабочий каталог и все прежние writers ещё не подключены. Начальная проверка фазы 23 с revision=1 остаётся отдельным историческим доказательством, а браузерный прогресс не становится частью VPS-копии.

## Воспроизведение и источники

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/piano-lesson-package-loader.test.cjs
node --preserve-symlinks --preserve-symlinks-main tools/qa-piano-package-loader.cjs
```

Вторая команда раздаёт только allowlist fixtures/scripts на 127.0.0.1:63344. Настоящие fetch/WebCrypto/ReadableStream/CacheStorage и IndexedDB проверяются 12 сценариями по кнопке/Enter, включая закрытый сокет и отказ редиректа. Тестовая 43→44 не является публичным выпуском 44. Удаление только созданных QA-кеша/БД подтверждено; 390 px без переполнения, кнопка 44 px и aria-live polite проверены. Публичная 23.5.43 не меняется.

Первичные источники прочитаны 7 ноября: [WHATWG Fetch](https://fetch.spec.whatwg.org/#http-fetch), [Streams/getReader](https://streams.spec.whatwg.org/#rs-get-reader), [Encoding §7.2](https://encoding.spec.whatwg.org/#interface-textdecoder), [W3C WebCrypto §14.3.5](https://www.w3.org/TR/webcrypto/#SubtleCrypto-method-digest), [W3C Cache §5.4](https://w3c.github.io/ServiceWorker/#cache-objects). Конкретные лимиты, pin, ошибки, reload и отсутствие автоматического commit — решения проекта.
