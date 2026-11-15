# Курс пианино — исследование20, 10 ноября2026

Зафиксирован конкретный data-only review-history envelope для двух существующих C-кандидатов02/03. Формат документально завершён для этих payloads, но writer/matcher/validator/migrator не реализованы и кандидаты не применены. Это уточнение прежних двух планов, новых уроков/целей/ID/редакционных планов0; каталог, ноты, пальцы, ритм, route/registry, grade/XP и локальный79 сохранены.

## Состав истории

[Полный дескриптор](../qa/piano-curriculum-2026-11-10-20-history-envelope.json) содержит обе editableReviewedAfter-копии и exact markers. В learning.contentReview восемь ключей: version, id, sourceFingerprint, previousAssessmentFingerprint, previousMusicVersion, previousContentSha256, previousInstruction, reviewedFingerprint. PreviousInstruction — один immutable снимок description/guide/learning исходника, до новых текстов. Оба исходных learning не имеют contentReview; legacy lessonReview не записывается поверх существующей истории. Непустая/неизвестная прежняя история требует отказа и отдельного решения, не очистки. Вложенной previous-цепочки, timestamp и рекурсивного старого marker нет.

Реальные conventions сверены в piano-lesson-development.js: sourceFingerprint/previousInstruction/reviewedFingerprint и отдельный previous для известных апгрейдов; lesson-quality.js хранит legacy lessonReview отдельно. Наши previousMusicVersion/previousContentSha256 усиливают привязку к исходнику. InstructionFingerprint исключает contentReview, поэтому дополнительно нужны полный envelopeSHA и явный marker-gate. Ни один новый вызов review не добавлен.

| ID | UTF8 bytes | Marker ID | Documentary reviewed edition |
| --- | --- | --- | --- |
| detail-p-hands-03 | 3004 | contrary-short-instruction-v1 | 1c725e77fdae54f7006c4943e0ff21d47df86809b0c7e44c2ae59cf5361aeb9f |
| detail-p-hands-02 | 2957 | c-pair-instruction-v1 | 94c60c21c415b25dfc132546310488f889dbaa3c77cedb4e51177feab0e246ff |

Глубина обоих markers4, снимков1/вложенныхreview0. Собственный будущий бюджет —16384B/depth12, выбран для этой схемы проекта. Это **не действующий validator/лимит сервиса**; actual catalog-personalization имеет собственные40/2MiB проверки. При превышении предлагаемого бюджета нужен отказ с сохранением source, не truncation. Текущие данные укладываются; boundary-validator не реализован/не тестировался.

## Точные привязки и версии

Для before/unmarked-after/documentary-reviewed-after подготовлены6 троек/18bindings: source-derived fresh-normalized, selected-v7 поверх перечисленной guard projection, restored-normalized. Top-level lessonReview absent в fresh и null в выбранном restored — отдельные presence slots, не байтовое равенство.13 guard-полей включают exam/maxErrors/contentKind и весь learning/guide; order/theme placement не переписываются. Это не подпись полного rawcatalog: перед будущей нормализацией остаётся обязательный raw precheck неизвестных полей77/78. Источник полей восстановлен по коду77, не новым loader capture.

Для03 grade59fcadd5/music2e81d531… и для02 grade36f3afb3/musicb35cdd65… прежние; новый envelope меняет edition. Указанные в таблице SHA точны **для этих документальных payloads**, не являются registry/saved-edition и не означают productionReady. Unmarked03/34ce5427… и02/2a5c5b5e… из75/76 не переписаны. Прежние synthetic77 stamps также не заменены задним числом: у них другой демонстрационный состав.

12 metadata-вариантов actual builder/signature (по6 на карточку) дали устойчивую exactJSONcopy и отдельные edition для неверного ID, изменённого previous snapshot, неизвестного marker-поля, отсутствующего marker и marker другой карточки. Все варианты сохраняют grade/music/instruction, потому что эти потребители history не учитывают. Значит, одного instruction fingerprint недостаточно для idempotent no-op. Это наблюдение hash-функций; proposed eligibility/apply решение не выполнялось.

## Проверка и первоисточники

[Пробы](../qa/piano-curriculum-2026-11-10-20-history-envelope-probes.json):1запуск/1принят,2markers/1snapshot каждый,6stage triples/18bindings/12metadata variants. Для новых stage-bindings выполнены6selected projection/6restore,6serialize/12normalizeRhythm/12normalizeGuide. Старые20controls78,16overlay/8summary77 не повторялись; новые MIDIassessment/grader/reducer/overlay/fullbuilder/loader/register/review/writer/storage/БД0.10future acceptance перечислены, исполнено0; исполненного migrator, whole-row restore/fingering/themeorder/persistence/browser proof нет.

Свежепрочитаны [RFC6902§4.6/5](https://www.rfc-editor.org/rfc/rfc6902.html#section-4.6) — точное типизированное сравнение объекта/неуспешный patch, и [ECMA262 SerializeJSONObject§25.5.4.5](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonobject) — сериализация представимых полей. Два свежих применения существующих технических записей, источников68/новых0. Ни стандарт не утверждает наши пределы, envelope или пианистические карточки. Новых педагогических утверждений нет.

## Сохранность и продолжение

[HTTPS](../qa/melodiajest-2026-11-10-79-observation.json)10:41:15UTC healthy78/API2c0…/course334…/schema2. Knownreceipts78 переиспользованы с фактическим чтением10:19:25UTC, actualhourly10:01:54/6e734c6d…/success0/обе полные квитанции; новогоSSH79 нет. PGdaily02:12/37f62…/8summary полей/старый restore9ноября16:15/newSnapshotfalse прежние. Нет новыхS3/архивов/backup/restore/серверных изменений; source59 не покрывает документы60–79. Counterhealth0 не полный биллинг/неизвестнаястоимость не0.

Native quota86%used/14%remaining/10080min/ordinaryAllowedtrue/spendControlfalse/reserve0. [Финальная сверка](../qa/melodiajest-2026-11-10-79-consistency.json) сохраняет457runtime/exact79/7защищённых групп/14operations.local*/старые61–78/два исходныхкандидата, [автоматизация](../qa/melodiajest-2026-11-10-79-automation.json) та же ACTIVE20min/чат. 450/186MIDI/153происхождения/13контролей/10вариантов/427только верхняя граница/teacher0/verifiedDistinctnull/4F/6future/2C-плана прежние. Manualfragment73 не зарегистрирован/безXP, Fvoicev2/matcher/validator не реализованы/F4gap открыт;реальная двуручная готовность/пальцы/звук/педагог не проверены. ExecutionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady;71/72 issued/XP/outbox/owner fencing/rollback остаются обязательными.

Следующий малый этап — source-only музыкальный контекст уже существующих4F-заготовок:найти и прочитать первичный нотный/педагогический источник, где игра Fmajor обеими руками вместе указана явно. Сверить высоты,октавный разнос,направление и пальцы с65–70;отделить указание «вместе» от двух отдельных планов рук/физической и педагогической проверки. Не повторять полныйаудит/Baylor67 без новойпричины,не приписывать источнику наши BPM/.85/окна/допуски. Новые уроки/цели/ID/планы не добавлять ради регистра или темпа. Не писатьmatcher/validator/параллельныйоценщик/мигратор,не подменятьlegatoнаstandard,не расширятьoldtimeLimit30/timingPrecisionv2Fharness в план. Оба C-кандидата/20-history-envelope только документальны,executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady;raw/exam/maxErrors/marker gates77/78 иXP-issued71/72 остаются. Manualfragment73 не зарегистрирован/не MIDI-ready/безXP,Fvoicev2/matcher/validator не реализованы/F4gap открыт,4F не уроки/реальная двуручная готовность не проверена. 79точный локальный/замороженный,не менять/переупаковывать/публиковать;ресурсный ответ получен,не спрашивать/покупать/resize/переносить/чистить. Та же ACTIVE20min автоматизация/чат/checkout,последовательно/без параллельных изменений.

Эксплуатация — [этап79](melodiajest-operations-2026-11-10-79.md).
