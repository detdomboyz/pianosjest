# Кто записывает браузерные данные

Проверено 8 ноября 2026 на неизменной23.5.55. Это карта существующего кода и подготовленный контракт перехода. Общий writer, перенос всех данных и production-включение package-store **ещё не реализованы**. [Машинная карта с SHA256 и строками](melodiajest-browser-writers-2026-11-08-09.json) относится к source `261d422abbea0ce9c9b1aa8e0ba38869ed1ac497022f1458ee319e0aca3e0e33`. Все315 исполняемых исходников совпали с восстановленным артефактом, 28 публичных файлов не изменились. Реальные пользовательские записи не читались.

## Восемь разных семейств

| Данные | Ключ/БД | Кто записывает | Состояние |
| --- | --- | --- | --- |
| catalog | `piano-blind-trainer-catalog-v1` | saveCatalog;direct importCatalogText | public-active |
| ui-preferences | `piano-blind-trainer-ui-v20` | saveUiPreferences | public-active |
| workspace | `music-catalog-workspace-piano-v1` | rememberCatalogSelection -> MusicCatalog.saveState | public-active |
| legacy-midi-progress | `music-learning-piano-v1` | PianoProgressStore.record/retry;PianoPreparationImport.apply | public-active |
| whole-preparation | `music-preparation-piano-v1` | PianoPreparationStore whole;PianoPreparationImport.apply | public-active |
| fragment-preparation | `music-preparation-fragments-piano-v1` | PianoPreparationStore fragments;PianoPreparationImport.apply | public-active |
| progress-transfer-archive | `music-preparation-transfer-backups-piano-v1` | PianoPreparationImport.apply journal phases | public-active |
| package-store | `melodiajest-piano-packages-v1 / slots` | PianoLessonPackageStore/Controller | isolated-not-connected-to-public-app |

Семь ключей localStorage уже используются приложением. IndexedDB package-store пока изолирован. Каталог JSON содержит ноты/ритм/пальцы/редакции/классификацию/порядок, но не отдельный MIDI-прогресс. Подготовленный JSON прогресса v2 содержит whole/fragment journals, legacy history и при необходимости transfer archive; это **другой формат**, чем package recovery-v2. Последний пока не переносит ни LEARNING_STORAGE_KEY, ни его pending-операции. Ни один из этих файлов сам по себе не является полной копией приложения.

В UI-ключе сохраняются представление клавиатуры, подписи, настройки проверки ритма и разбора. Звук/громкость, MIDI-подключение и выбранный input в проверенном коде живут в state и не обещаются как переносимые настройки. Разрешения устройства, активные звуки и native-bridge команды в резервный файл не превращаются. Неизвестные поля UI-ключа должны сохраняться, как их сейчас сохраняет spread прежнего объекта.

## Каталог: девять входов и прямой импорт

| Вход | Источник | Запись |
| --- | --- | --- |
| `loadCatalog` | `index.html:1356` | Через saveCatalog |
| `importCatalogText` | `index.html:1407` | Отдельный прямой setItem и вызов saveCatalog только в local-mode |
| `finishThemeDrag` | `index.html:1429` | Через saveCatalog |
| `finishLessonDrag` | `index.html:1443` | Через saveCatalog |
| `saveThemeFromEditor` | `index.html:1840` | Через saveCatalog |
| `saveLessonFromEditor` | `index.html:1857` | Через saveCatalog |
| `deleteThemeFromEditor` | `index.html:1910` | Через saveCatalog |
| `deleteLessonFromEditor` | `index.html:1928` | Через saveCatalog |
| `calculateCurrentFingering` | `index.html:2650` | Через saveCatalog |

`catalogSnapshot` (index.html:1209) вызывает normalizeCatalog и формирует v7. Поэтому его вызов не равен чтению исходных байтов localStorage. `applyCatalogSnapshot`, upgradeCatalogToV7 и installReviewedLessons меняют модель; при загрузке изменённая встроенная редакция сохраняется через loadCatalog. MIDI/аудио сначала создают editor draft (`createLessonFromMidi`, 1779); долговременная запись происходит по сохранению редактора, а не при открытии файла. Расчёт аппликатуры внутри редактора остаётся draft; calculateCurrentFingering записывает реальный урок.

`saveSerial` в saveCatalog защищает актуальность сообщения UI. Это не очередь записей и не межвкладочная блокировка. `importCatalogText` имеет отдельный прямой setItem и откат модели при отказе; будущий общий writer обязан включить этот путь. Текущий каталог сохраняется без readback и общего catalog-lock. При отказе сохранения UI предлагает экспорт; несохранённая модель не является автоматически подтверждённой копией.

В local-mode дополнительно действует PUT /api/content (`server.cjs:handleContentApi`) с записью `.tmp` и rename. Он не входит в публичный сервер. Сохранность при нескольких конкурентных local PUT не доказана этой картой; импортировать его механизм в многопользовательский сервис нельзя.

## Прогресс и незавершённые операции

`completeLesson` записывает legacy summary через PianoProgressStore.record; корректные whole/fragment попытки дополнительно идут через соответствующие capture. Каждая запись привязана к музыкальной версии и собственной области. Нельзя восстанавливать зачёт только из summary или сводного числа успешных повторов.

Три действующих progress-lock берутся импортом в таком порядке: progress → whole preparation → fragment preparation. Он задан LOCK_NAMES в piano-preparation-import.js:4. Будущая общая операция должна согласовать порядок со всеми существующими участниками. Объявление нового имени блокировки само по себе не защищает старые writers; сортировать только новый набор, оставляя старую цепочку, также недостаточно для доказательства отсутствия deadlock.

В памяти есть pending/baseRaw/draftRaw legacy-store, recoveryEntries и jobs двух capture, editor draft и prepared transfer с исходным JSON. ExportCombined проверяет локальные поколения; это не общий атомарный снимок каталога и всех вкладок. Сохранённый ранее raw и ещё не подтверждённая операция должны различаться. Нельзя очищать pending, подменять повреждённый journal пустым или сообщать saved до подтверждения записи.

Нынешний beforeunload (index.html:2205) проверяет pending трёх progress-store и transfer. Флаг несохранённого каталога в эту проверку не входит. Это выявленная по коду граница защиты, а не воспроизведённая потеря реальных данных. Ближайшая реализация должна проверить искусственный отказ каталожного setItem, сохранить экспортируемую несохранённую модель и добавить наблюдаемую защиту закрытия/повтора.

## Последовательность следующей реализации

1. Ввести одну очередь записи фактического каталога для девяти входов и прямого импорта. Снимать неизменяемый candidate, различать принятую модель/подтверждённые байты/pending, сверять readback. Проверить порядок быстрых сохранений, quota/readback/import rollback и сохранение редактора/экспорта. Не менять музыкальные версии ради оболочки хранения.
2. Затем согласовать catalog epoch с тремя progress journals, transfer archive и их pending. До барьера дождаться jobs либо явно вернуть incomplete с восстановимым материалом. Не обрывать текущую MIDI-попытку, не выдавать её за завершённую и не закрывать draft автоматически.
3. Общий снимок считать согласованным только после участия всех writers, включая другую вкладку, импорт, редактор, удаление, порядок, аппликатуру и миграции. Все имена ключей/ID/версии/истории сохраняются. Future/неподдерживаемые схемы остаются как исходные данные; конвертация1–6 — отдельный этап.
4. Только после изолированных проверок этого пути, двух вкладок, ошибок записи/reopen/rollback подключать production package-store и обсуждать полный формат резервной копии. В этой фазе новый формат не создан и пользовательские данные не записаны.

Карта составлена ручным чтением этих путей и поиском setItem в allowlist браузерных исходников: найдено 5 файлов с кандидатами. Это не AST-анализ и не доказательство всех возможных косвенных вызовов. При изменении любого pinned-файла строки и семантику нужно проверить снова; синтаксическое совпадение не заменяет регрессию поведения.

Первичные источники перечитаны 8 ноября: [HTML Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html), 12.1/12.2.1, и [Web Locks](https://w3c.github.io/web-locks/), request/5.1. Из них следует ограничение обычного разделяемого localStorage и необходимость согласования участвующих блокировок. Конкретная очередь, поколения, порядок миграции и критерии отказа выше — проектные решения.
