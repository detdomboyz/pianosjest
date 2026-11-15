# Курс пианино — исследование19, 10 ноября2026

Проверен source-only контракт выбранных полей v7 для двух существующих кандидатов02/03. После восстановления совпали assessment/music/edition/instruction identities всех6 корректных копий. Исполнены реальные3 pure-функции и выбранные выражения приложения; полный loader, мигратор и writer не запускались. Кандидаты, каталог и79 не изменены; новых уроков/целей/ID/редакционных планов0.

## Точный объём

[QA](../qa/piano-curriculum-2026-11-10-19-v7-roundtrip-probes.json) фиксирует исходные строки index.html, SHA функций,5 выражений сериализатора (rhythm/guide/handMode/learning/lessonReview) и4 соответствующие restore-строки. serializeLessonRhythm вызывает actual normalizeLessonRhythm; normalizeLessonGuide взят из того же файла. Использованы выбранные field bindings, не целый catalogSnapshot/applyCatalogSnapshot. Остальные поля остаются исходной синтетической копией; registry steps поставляют только число шагов. Pattern parsing, stored fingering validation, theme/order, файл/браузер/аккаунтное хранение этим не проверены. Недостающие baseline поля source-derived по77, нового loader capture нет.

Для каждой карточки проверены before, unmarked кандидат и synthetic77 contentReview. Тексты/guide/learning/история сохранены в выбранном roundtrip; исходные объекты и raw копии не менялись. Реальные runtime IDs нот не создавались.

| ID | Копия | До | Только сериализованный ритм | После восстановления |
| --- | --- | --- | --- | --- |
| detail-p-hands-03 | before | 47383ac1 | eec60661 | 47383ac1 |
| detail-p-hands-03 | unmarked-candidate | 59fcadd5 | c7c5d0b5 | 59fcadd5 |
| detail-p-hands-03 | synthetic-history-marker | 59fcadd5 | c7c5d0b5 | 59fcadd5 |
| detail-p-hands-02 | before | 4cdf584f | 21af695f | 4cdf584f |
| detail-p-hands-02 | unmarked-candidate | 36f3afb3 | d8bfa943 | 36f3afb3 |
| detail-p-hands-02 | synthetic-history-marker | 36f3afb3 | d8bfa943 | 36f3afb3 |

Причина разницы wire-подписи — stepIndex: он опускается сериализатором и восстанавливается нормализатором по порядку. Нельзя использовать raw v7 как нормализованный вход подписи или считать stepIndex устойчивым ID ноты/рукой. Music/edition после восстановления также точно совпали, включая два демонстрационных history-маркера77; это не финальный envelope и не зарегистрированная редакция. Unmarked03/34ce5427… и02/2a5c5b5e… сохранены.

## Presence и личные поля

20 логических контролей (по10 на карточку; парные проверки входят внутрь случая) и2 отдельных JSON-проверки отделены от6 корректных roundtrip:

- Отсутствующий rhythm остаётся отсутствующим, явный null остаётся null; assessment-подписи этих состояний различаются.
- Отсутствующие guide/learning/lessonReview в выбранном пути становятся null; handMode null и отсутствие превращаются в пропуск поля. Для самих карточек handMode остаётся split.
- Неизвестные поля guide и rhythm/шага отбрасываются actual normalizer/serializer. Полученный объект может выглядеть как исходная карточка, хотя в raw была личная приписка. Поэтому будущий review обязан проверять и сохранять raw **до** нормализации; совпадения после неё недостаточно. Это synthetic source-диагностика, не наблюдавшаяся потеря production-данных.
- Устаревший stepIndex99 становится0. Неверное число шагов и убывающая пара положительных стартов дают rhythm=null; отрицательный старт отдельно показал clamp. Это поведение функции, не разрешение исправлять повреждённую личную запись и выдавать зачёт.

[Контракт](../qa/piano-curriculum-2026-11-10-19-v7-roundtrip-contract.json) требует отдельного raw precheck, точных before-полей77 включая exam/maxErrors/classification и marker-gate. Он не заменяет CAS writer. 12 будущих acceptance-кейсов перечислены, исполнено0. Не смешивать их с принятыми pure-функциональными диагностиками.

## Проверка и источники

Один запуск/один принят.38field projections/38selected restore;36serializeLessonRhythm/72normalizeLessonRhythm/76normalizeLessonGuide, счёт включает внутренние вызовы сериализатора. Новых assessment/grader, fullbuilder, loadApp, applyCatalogSnapshot/register/review/writer/storage/БД0. Pure overlay иsummary-пробы77 не повторялись.24 source dependencies и предыдущий контракт сверены по SHA. Доказательства и ограничения относятся к выбранным полям, не полному roundtrip приложения.

Прочитана официальная living-страница [ECMA262 JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify), на момент чтения§25.5.4 notes2/5, и [SerializeJSONObject](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonobject),§25.5.4.5: undefined-свойство объекта опускается, null представим вJSON. Преобразования guide/rhythm определяет код проекта, не спецификация языка.1новая техническая запись/1страница/2раздела; RFC-контракт77 переиспользован явно без нового чтения. Источники67→68. Новых музыкальных/педагогических утверждений нет.

## Эксплуатация и границы

[HTTPS](../qa/melodiajest-2026-11-10-78-observation.json)10:19:25UTC healthy78/API2c0…/course334…/schema2. [Фиксированные квитанции](../qa/melodiajest-2026-11-10-78-native-receipts.json) прочитаны10:19:25.542134UTC: actualhourly10:01:54/6e734c6d9162444bac2a0c74632c6e6b/success0/inactive, timer/journal/обе полные квитанции совпали,checkedAt10:01:54.308599/.594286. PGdaily02:12/37f62… по8summary-полям прежний, snapshot07222…/23files202181413B/newSnapshotfalse/restored9ноября16:15/dataCompared10ноября02:12. Это чтение старой verified копии, не новый backup/restore; stdout daily не полная квитанция. S3 health-counter0 относится к этому health, не биллинг/неизвестнаястоимость не0.

Native quota85%used/15%remaining/10080min/ordinaryAllowedtrue/spendControlfalse, резерв0. Новых архивов, копий, restore, запросовS3, серверных изменений0. Source59 не покрывает документы60–78. [Финальная сверка](../qa/melodiajest-2026-11-10-78-consistency.json) сохраняет457runtime/exact79/7защищённых групп/14operations.local*/прежние61–77 и оба кандидата; [автоматизация](../qa/melodiajest-2026-11-10-78-automation.json) та же ACTIVE20min/чат.

450/186MIDI/153происхождения/13контролей/10вариантов/427только верхняя граница/teacher0/verifiedDistinctnull,4F/6future/2C-плана прежние. Manualfragment73 не зарегистрирован/безXP, Fvoicev2/matcher/validator не реализованы/F4gap открыт. Нет браузера/DOM/390px/реальногоMIDI/звука/пальцев/педагога;executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady. ID/ноты/пальцы/ритм/goalKey/sameGoalAs/семьи/grade/XP/issued/outbox/один общий будущийLVL не менялись.

Следующий малый этап — source-only конкретный review-history envelope для тех же2кандидатов02/03:сверить текущие contentReview/previousInstruction/lessonReview conventions, ограничить состав/глубину истории и задать before/after/raw-v7/normalized bindings с учётом77/78. Финальные documentary reviewed-editions считать только после точного envelope; старые unmarked manifests75/76 не переписывать,не создавать новый урок/цель/редакционный план. Не писать/вызывать writer/migrator/applyCatalogSnapshot/register/review,не менять79/registry/route/grade/XP/issued/outbox. Оба кандидата executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady;71/72 совместимость и обязательные проверки сохраняются. Manualfragment73 не зарегистрирован/не MIDI-ready/безXP,Fvoicev2/matcher/validator не реализованы/F4gap открыт;4F не уроки/реальная двуручная готовность не проверена. 79точный локальный/замороженный,не менять/переупаковывать/публиковать;ресурсный ответ получен,не спрашивать/покупать/resize/переносить/чистить. Та же ACTIVE20min автоматизация/чат/checkout,последовательно/без параллельных изменений.

Эксплуатация — [этап78](melodiajest-operations-2026-11-10-78.md).
