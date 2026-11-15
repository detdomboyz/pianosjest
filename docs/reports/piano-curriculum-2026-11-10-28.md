# Курс пианино — исследование28, 10 ноября2026

Сведён индекс уже существующих доказательств для двух C-кандидатов. Он не создаёт новый acceptanceplan, случай, критерий или исполняющий модуль. Для10групп прежних границ указаны точные QA-файлы, полные SHA256, JSONPointer и digest значения по указателю. Готовность к применению не изменилась: executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady. Новых уроков/целей/ID/планов0.

## Как читать индекс

[Индекс28](../qa/piano-curriculum-2026-11-10-28-required-gates-status.json) разделяет alreadyObservedInPriorEvidence и stillNotVerifiedOrImplemented у каждой строки. Это группировка исходных ограничений, не новая исчерпывающая спецификация продукта. Частичные pure/harness проверки сохраняют свою область и не становятся полной интеграционной приёмкой. Все10общих групп границ применения остаются открыты; отдельные наблюдения внутри них уже были выполнены раньше.

| Граница | Прежнее свидетельство | Что им не доказано |
| --- | --- | --- |
| XP/ledger и раздельные семьи |71:6arith examples,72:собственная disjoint family | Реальная DB/concurrency/adoption; текущие no-alias кандидаты не требуют внедрять будущий cursor |
| Выданные попытки/идемпотентность |71:4actual game-function branch harness cases | DB-races/owner-fence/drain; start409 до receipt остаётся не исправлен |
| Маршрут/ручная подготовка |72:short58/source96/main125/28-IDclosure/явныйmanual−12 | Новый маршрут/автотранспозиция/зачёт/обязательная полная гамма не созданы |
| Полная идентичность/raw |77:20digest diagnostics,exam/maxErrors/instruction/marker | CAS matcher и сохранение всех raw/unknown/foreign-marker случаев не реализованы |
| Личные правки/классификация/порядок |77:16create+16apply pure | Полный loader/browser/persistence/deletion путь не проверен |
| V7/presence/stepIndex |78:6roundtrips,20logical+2JSON controls | Полный parser/storedfingering/themeorder/loader/persistence;rawпроверять доnormalization |
| Review history |20:2envelopes,6triples/18bindings/12metadata | Budget16KiB/depth12/валидатор/executor/foreign-history поведение не внедрены |
| Readiness/реальное исполнение |77:8synthetic summary calls,86:18textbindings/12claims | MIDI/DOM/reading/ear/memory/физические пальцы/педагог не доказаны |
| Startup review order |77:61вызовlisted по source | Это не61новый исполненный вызов;register/review/fullstartup не запускались |
| Rollback/backup/portal |71/72:сохранение старых результатов/outbox/общего будущегоLVL | Совместимый будущийpolicyrollback/export-backup/handoff не проверен;SSO не стало условием этихno-aliaspayloads |

Пять исходных групп cases сохранены отдельно:71=20planned/0executed;72=10/0;77=16/0;78=12/0;20=10/0. Сумма и дедупликация не выполнялись: области частично перекрываются и не являются общим числом успешных тестов. Новых acceptancecases/plans0; старые pure calls не прогонялись.

## Область будущих политик и версии

SameGoalAs в обоих75/76 исключён, goalKey/семьи остаются прежними. Будущая family-cursor/alias/adoption/SSO политика не стала обязательной или разрешённой реализацией из-за её присутствия в71/72. Для текущих no-alias payloads обязательна сохранность существующей истории/attempts/awards/outbox в исходной области, а не внедрение каждой будущей политики. Это [документное уточнение области](../qa/piano-curriculum-2026-11-10-28-scope-clarification.json), внесённое до финального checkpoint: before/afterSHA сохранены, payloads/критерии/код не менялись.

Unmarked03=34ce5427…/02=2a5c5b5e… и documentaryreviewed03=1c725e77…/02=94c60c21… переиспользованы по metadata. Новых подписей,registry или сохранённых активных редакций нет. Локальный79 — отдельный неизменный артефакт, не сборка этих двух неприменённых изменений. Старые backup/restore78 не являются копией будущего мутационного состояния или этих документов.

Свежепрочитан [RFC6902§4.6/5](https://www.rfc-editor.org/rfc/rfc6902): логическое равенство test и неуспешная операция не дают считать patch успешным. Это терминологическая опора для уже описанных границ, не доказательство реализованного JSONPatch/HTTPPATCH/CAS в проекте. RFC9110 в этом этапе не обновлялся; ECMA78 явно переиспользован для прежнего absence/null контекста.71sources/0новых/1freshtechnical+1reuse, педагогической аттестации нет.

[Проверки индекса](../qa/piano-curriculum-2026-11-10-28-evidence-index-checks.json):1helper/1принят+1документное уточнение;13files/полныеSHA/всеJSONPointers и valueSHA проверены чтением. Новых applicationcalls/assessment/reducer/matcher/validator/writer/migrator/register/review/loadApp/fullbuilder/browser0. Не пересчитывались версии и не воспроизводились прежние tests.450/186MIDI/153происхождения/13контролей/10вариантов/427верхняя граница/teacher0/verifiedDistinctnull/4F/6future/2C прежние. F4gap/voicev2 не реализованы,4manualcards notobserved;manualfragment73 незарегистрирован/неMIDI-ready/безXP.

## Эксплуатация и продолжение

[HTTPS](../qa/melodiajest-2026-11-10-87-observation.json)13:19:50UTC healthy78/API2c0…/course334…/schema2. [Новые известные квитанции87](../qa/melodiajest-2026-11-10-87-native-receipts.json)read13:19:47.186331UTC:actualhourly13:01:32/94768955f94c4300966b04c02ad6e338/success0/inactive/timerjournal/обе полные квитанции. Старое84read12:22/actual12 сохранено в history. PGdaily02:12/37f62…/8summaryfields/старыйrestore9ноября16:15/newSnapshotfalse прежние;следующий daily11ноября02:13:25 прогноз,неactual. Counteroriginals3RequestsThisCheck/adapternormalized0 относится толькоhealth,неполныйбиллинг/unknowncostне0.

Один новыйSSHread,новыхS3/backup/restore/архивов/серверныхизменений0. Native92used/8remaining/10080min/ordinaryAllowedtrue/spendControlfalse/reserve0. Source59 не покрывает документы60–87. [Финальная сверка](../qa/melodiajest-2026-11-10-87-consistency.json) сохраняет457runtime/exact79/7защищённых групп/14operations.local*/61–86/старые музыкальные курсоры; [автоматизация](../qa/melodiajest-2026-11-10-87-automation.json) та же ACTIVE20min/чат.79не переупакован/не опубликован, ресурсный вопрос не повторялся. BlockedIMSLP84/PDF40380/observer80 не повторялись. DONT_NOTIFY: состояние готовности неакционно и не изменилось.

Следующий малый этап — source-only сверить ужеописаннуюручнуюподготовкуC3–B2–A2/левая1–2–3 из73 с одним первичнымнотнымисточником нисходящегоC-контекста:точно прочитать высоты/направление/напечатанныецифры/октаву и явно отделить переносрегистра,еслионнужен. Не повторятьF-score67/полныйаудитBaylor,искатьтолькооднонужноеC-окно. Неподтверждённыецифры/редакторскуюатрибуцию оставитьunknown,не выдумывать. Не создаватьновыйурок/цель/ID/план/обязательнуюцелуюгамму;manualfragment73 не регистрировать/неMIDI-ready/безXP/безавтотранспозиции. 87 свёл только существующие71/72/77/78/history20:10группграницopen/13QAfiles+SHA+JSONPointer,5plannedgroups20/10/16/12/10каждаяexecuted0,безсуммы/новыхcases/acceptanceplan. Conditionalalias/SSOне сталиобязательнойреализациейдляno-aliasC75/76. ОбаCpayload/editions/historyнеизменны/executionAllowed=false/proposedEditorialCutoverReady=false/notpublicationReady;XP/issued/outbox/goalKey/семьи не сливать. Не исполнятьmatcher/validator/writer/migrator/register/review/fullbuilder/browser;не повторять75/76/78/79 без новойпричины. F4shared65/voicev2/matcher/validator gap открыт/4manualcards22/23 notobserved/human0/teacher0/XP0. Czerny/Peters63611verification84/PDF40380/observer80 неавтоповторять/необходить. 79точныйлокальный/замороженный,не менять/переупаковывать/публиковать;ресурсныйответполучен,не спрашивать/покупать/resize/переносить/чистить. Та же ACTIVE20min автоматизация/чат/checkout,последовательно/без параллельных изменений.

Эксплуатация — [этап87](melodiajest-operations-2026-11-10-87.md).
