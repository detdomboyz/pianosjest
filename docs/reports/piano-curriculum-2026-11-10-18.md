# Курс пианино — исследование18, 10 ноября2026

Подготовлен source-only контракт будущего scoped review двух прежних кандидатов02/03. Ни один кандидат не применён; это согласование двух существующих планов, новых уроков/целей/ID/редакционных планов0. Код, каталог, route, registry, ноты/пальцы/ритм, прогресс, grade/XP и точный локальный79 сохранены.

## Реальный порядок и область совпадения

Исходники и точные строки закреплены в [пробах](../qa/piano-curriculum-2026-11-10-18-scoped-review-probes.json), условия — в [контракте](../qa/piano-curriculum-2026-11-10-18-scoped-review-contract.json). Startup: initializeBuiltInCatalog/normalize → upgradeCatalogToV7(0) → Quality → focused register → piano register с61 текущим review/upgrade → normalize. Restoredv7 сначала разбирает pattern и нормализует rhythm/guide/contentKind, затем повторяет review-цепочку. Аккаунтный base snapshot снимается до overlay, затем applyCatalogSnapshot снова входит в этот путь. Register добавляет отсутствующие ID; новый scoped review обязан пропускать отсутствие, не создавать записи.

Сохранённые QA61/62 содержат проекции, без contentKind/maxErrors/exam. Только для диагностики по реальным выражениям восстановлены exercise/1/false, handMode split; новый loader capture не выполнялся. Из-за присутствия contentKind notationSHA полной нормализованной записи отличается от ранее подписанной проекции. Поэтому оба прежних манифеста сохранены как исследовательские данные и не являются готовыми runtime CAS.

20 диагностик (10 на карточку) выявили отдельный пробел: exam/maxErrors не входят в пять прежних частей CAS. Существующий instructionFingerprint их учитывает, как и guide, но удаляет learning.contentReview; верхний lessonReview также нуждается в отдельной явной проверке. Пользовательское содержание и неизвестные learning-поля требуют skip; order/theme placement сохраняются. Это пробел предложенного контракта, не наблюдавшийся отказ production.

| ID | Instruction before | Instruction after |
| --- | --- | --- |
| detail-p-hands-03 | e1ef7965 | e53ebcb6 |
| detail-p-hands-02 | 0106ffe1 | 1277234b |

Это source-derived views, не новые runtime-редакции. При будущем применении нужны полные точные before-поля и post-проверка, отдельный marker-gate, idempotent no-op только для своего after+envelope; похожий текст без происхождения не считается выполненной миграцией. Условия не заменяют исходники, классификацию и хранение личного raw.

## Личные правки и история

На actual CatalogPersonalization.create/apply выполнено16+16 чистых вызовов: для обеих карточек по8 случаев. Неизменённый личный каталог, order, classification и exact-after проходят; личные description/guide/learning конфликтуют как верхнеуровневые поля, возвращая ok=false/snapshot=null. Входы не изменились. Не выполнять автоматический deep-merge learning. Pure removal сохраняет отсутствие в результате merger, но существующий register добавляет отсутствующие встроенные ID; это не доказательство удаления через весь загрузчик, его семантика здесь не менялась.

Два synthetic metadata опыта добавили только демонстрационный learning.contentReview к копиям кандидатов: grade/music и instructionFingerprint прежние, editionVersion меняется, поскольку builder включает learning целиком. Эти stamped-хеши приведены только в QA и не являются финальной редакцией; envelope не утверждён. Unmarked кандидаты03/34ce5427… и02/2a5c5b5e… не переписывались. Будущий review сохраняет immutable previousInstruction до изменений и отдельно прежнюю lessonReview; его конечная edition требует расчёта после финализации envelope.

8 вызовов actual Assessment.record на синтетических summary (4 на карточку) подтвердили: тот же fingerprint сохраняет прежние3 takes/ready; при новом timing fingerprint неуспех даёт0, один успех1, прежние takes остаются в history. Это reducer, не новое MIDI assessment, не writer, не реальные данные. Загрузка/review не должны вызывать record или выдавать готовность, XP и зачёт. Выданные попытки/награды/outbox/общий будущийLVL и отдельные семьи02/03 сохраняются по [71](piano-curriculum-2026-11-10-12.md) и [72](piano-curriculum-2026-11-10-13.md); прежний goalKey сам по себе совместимость не доказывает.

## Проверки и источники

Один запуск helper, один принят: 20digest-диагностик,16create/16apply,8summary-reducer,2marker metadata. Register/review/normalizeCatalog/applyCatalogSnapshot, loader, fullbuilder, grader, proposed matcher/migrator и application storage/БД не вызывались. 16 будущих acceptance-кейсов перечислены в контракте, исполнено0; это не результаты нового migrator. Переиспользованы3 чистые функции comparison75 без main, все24 source dependencies сверены; оба прежних кандидата и контракты61–76 сохранены. Проверки457runtime/exact79/7защищённых групп и той же автоматизации — [финальная квитанция](../qa/melodiajest-2026-11-10-77-consistency.json).

Прочитаны [RFC6902§4.6/5](https://www.rfc-editor.org/rfc/rfc6902.html#section-4.6): полное типизированное сравнение и неуспешная операция не образуют успешный patch; [RFC9110§13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match): сильное условие до изменения предотвращает перезапись другой версии. Это техническая основа отказа по несовпадению. HTTP If-Match/JSON Patch API не добавлены; наши hashes, порядок и история — проектные решения. Одна техническая запись/две прочитанные страницы, источники66→67. Новых нотных/педагогических утверждений нет; прежние источники и ограничения кандидатов75/76 не заменены.

## Эксплуатация и продолжение

[HTTPS и native](../qa/melodiajest-2026-11-10-77-observation.json):10:00:32UTC healthy78/API2c0…/course334…/schema2. Первый сетевой запрос внутри sandbox получил WinError10013, затем разрешённое узкое чтение успешно; это не отказ сайта и не отклонение automatic approval review. Фиксированные [квитанции](../qa/melodiajest-2026-11-10-77-native-receipts.json) перечитаны10:00:33UTC: actualhourly09:01/b15916…/success0/обе полные квитанции;10:01 ещё не наблюдался. PGdaily02:12/37f62…/8полей совпали, snapshot старый07222…/23files202181413B, newSnapshotCreated=false/restored9ноября16:15:21 прежний. Это повторное чтение, не новая копия/restore. Нативная квота85%used/15%remaining,ordinaryUsageAllowed=true/spendControl=false/reserve0; неизвестная S3-стоимость не0, счётчик health не биллинг.

Новых архивов, backup/restore, серверных изменений и запросовS3 нет. Source59 не покрывает документы60–77. Новых уроков0;450/186MIDI/153происхождения/13контролей/10вариантов/427только верхняя граница/teacher0/verifiedDistinctnull прежние;4F/6future/2C-плана отдельно. Manualfragment73 не зарегистрирован/безXP, Fvoicev2/matcher/validator не реализованы/F4gap открыт. Нет браузерной/DOM/390px/реальногоMIDI/звука/пальцев/педагога проверки. ExecutionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady.

Следующий малый этап — source-only roundtrip-контракт двух существующих кандидатов02/03: реальные serializeLessonRhythm/normalizeLessonRhythm/normalizeLessonGuide на синтетических копиях normalized→v7→normalized; проверить подписи, stepIndex, absence/null, guide и подготовку review-history envelope. Не вызывать applyCatalogSnapshot/register/review/writer, не менять79, реестр, маршрут, grade/XP/выданные попытки. Это уточнение тех же2планов, не новый урок/цель/план. Оба кандидата executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady;71/72 совместимость и обязательные проверки остаются. Manualfragment73 не зарегистрирован/не MIDI-ready/безXP,Fvoicev2/общий matcher/валидатор НЕ реализованы,F4gap открыт,4F не уроки/реальная двуручная готовность не проверена. 79 заморожен/локальный,не менять/переупаковывать/публиковать. Ресурсный ответ получен,не спрашивать/покупать/resize/переносить/чистить. Та же ACTIVE20min автоматизация/чат/checkout,последовательно/без параллельных изменений.

Эксплуатация — [этап77](melodiajest-operations-2026-11-10-77.md). Одна ACTIVE20min автоматизация/тот же чат, [нативная сверка](../qa/melodiajest-2026-11-10-77-automation.json); commit/push/worktree/новых автоматизаций нет.
