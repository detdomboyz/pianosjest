# Возвращение архивной незавершённой правки

Продолжение: в [фазе 2026-11-08-07](RECOVERY_FILE_IMPORT_CONTRACT.md) подготовлен импорт собственного recovery-v2 в пустую БД. Он не переключает production-приложение на общий store и не включает отдельный MIDI-прогресс. Ниже сохранён исторический результат фазы 01.

Фаза 2026-11-08-01. Реализовано и проверено в изолированном store/controller. Публичная версия 23.5.51 и прежние writers приложения не подключены. Это продолжение [архивирования pending](PENDING_ARCHIVE_CONTRACT.md), без импорта файла recovery-v2 и без очистки архива.

`preparePendingRestore()` читает согласованный снимок пяти слотов и наличие ключей pending/pendingArchive. Отсутствие архива возвращает null. Поддерживается только собственный `melodiajest-piano-pending-archive-v1` той же БД с полным контекстом. Current, previous и receipt должны совпадать с архивными, а pending — проходить прежний валидатор `recoverPending`: начальное состояние, известное before либо уже применённое after. Stale, future, повреждённые и чужие записи остаются для экспорта; подготовка ничего не исправляет и не записывает.

Замороженное непрозрачное разрешение содержит version, archiveId и pendingBytes без личного каталога. Его полное содержимое хранится в WeakMap того же store, а контроллер учитывает собственные разрешения отдельно. JSON-копия, чужой store/controller и закрытый контроллер не дают права записи. Подготовка не сообщает сохранение каталога.

`commitPendingRestore(plan)` ставит запись в общую очередь контроллера и вызывает `store.restorePending(plan)`. Одна короткая native readwrite-транзакция повторно сравнивает полный архив и три рабочих слота. `getKey` отличает отсутствие pending от занятого ключа с null или undefined. Только свободный ключ получает исходный pending через `add`. Current, previous, receipt и pendingArchive не записываются; archiveId, музыкальная версия и зачёт не меняются. Точное повторение возвращает replayed; конкурентный другой pending даёт PENDING, изменённый контекст/архив — STALE.

Успех сообщается только по transaction.complete. Abort и QuotaExceededError откатывают добавление pending; исходный архив сохраняется. Контроллер сообщает pending-restored, а confirmedRevision остаётся прежним: это не saved и не активация каталога. Strict — durability hint браузеру, не гарантия при любой аварии питания.

Для активации нужен следующий отдельный явный `prepareRecovery()` → `commitRecovery(token)`. В native QA это проверено на синтетическом каталоге: обычный commit повышает revision 1→2, сохраняет previous и архив; уже применённый pending потребляется с replayed без повторной ротации. Само возвращение архивной правки ничего не активирует. Производственное приложение, личные данные и прогресс в проверке не участвовали.

Архив сохраняет прежние строгие JSON-ограничения и размер до 96 МиБ с ограниченным служебным обрамлением. Значения не обрезаются. Recovery-v2 экспортирует текущие слоты и полный архив; после возвращения присутствуют оба экземпляра pending. Один архив той же БД/origin не заменяет независимую приватную копию пользователя. Нет импорта recovery-файла, освобождения места, ротации, адаптации схем 1–6 или общей защиты старых localStorage writers.

Проверка: 10 новых Node-тестов, 39 целевых вместе с прежними и TypeScript 5.8.3 strict/noEmit. [Native QA](qa/melodiajest-2026-11-08-01-pending-restore.json) прошёл 18/18 сценариев: reopen/export, отдельный resume, CAS каждого рабочего слота/архива, null/undefined, два настоящих IDB-соединения, конкурентный stage, внедрённый quota и native abort после add. LocalStorage origin не изменился; синтетические БД удалены. Это два соединения одной страницы, не две вкладки, физическое заполнение диска или аппаратный power-loss test. Enter, focus-visible, aria-live=polite, кнопка 44 px и отсутствие горизонтального переполнения при 390 px проверены; снимок сохранён после сброса временного viewport.

Воспроизведение без установки зависимостей:

```powershell
node --preserve-symlinks --preserve-symlinks-main --test tests/piano-pending-restore.test.cjs
node --preserve-symlinks --preserve-symlinks-main tools/qa-piano-pending-restore.cjs --port 63349
```

Открыть `http://127.0.0.1:63349/` и нажать явную кнопку. Host привязан к loopback и раздаёт только allowlist модулей и синтетический fixture, без корня проекта, реального каталога и MIDI/звука.

Первичные источники перечитаны 8 ноября по местной дате: [IndexedDB §2.7.1](https://w3c.github.io/IndexedDB/#transaction-lifecycle), [§2.7.2](https://w3c.github.io/IndexedDB/#transaction-scheduling), [§5.4](https://w3c.github.io/IndexedDB/#commit-transaction) и [durability hint](https://w3c.github.io/IndexedDB/#transaction-durability-hint). Они подтверждают атомарность commit, rollback и сериализацию пересекающихся readwrite. Формат архива, непрозрачные разрешения, лимиты, число копий и политика конфликтов — решения проекта.
