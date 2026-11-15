# Курс пианино — исследование43, 10 ноября2026

Прочитана одна existingcourse07-01 «C левой и правой по очереди»:ownregistry и case2000–2008. Восемь одиночных C3/C4 четвертей согласованы с текстом;существующая sameGoalAs соответствует cachedgoalKey. Новых расхождений,целей,уроков или готовности нет.

[Сверка43](../qa/piano-curriculum-2026-11-10-43-c-handoff-source-review.json):9ownbindings+14generic106 по точному SHA/строкам,всего23bindings/15literalfields/8контекстов.

| Прочитанный слой | Собственные данные |
| --- | --- |
| Ноты и руки |C3/48 LH5 → C4/60 RH1,четыре раза |
| Время |8одиночных четвертей у0…7,последнийC4 заканчивается у8 |
| Темп/профиль |56BPM/standard |
| Подготовка/дальше |requiresdetail-p-hands-01;nextcourse07-02 |
| Существующая цель |source sameGoalAs=detail-p-hands-01;cachedgoalKey тот же |
| Версии |gradeca456c3a;musice09db78…;edition241133… |

Одна рука отпускает прежнюю клавишу у нового вступления другой. Общий пульс не требует перекрывать длительности;дополнительной тихой доли нет. Это два четырёхдольных такта,последняяC4 отпускается у следующего «раз». Sharedapplier явно пишет4/4. Одновременных пар и независимого удержанного голоса здесь нет.56BPM/8атак/фиксированныеLH5RH1 не перенесены из58BPM/10ступенных атак07-02.

Ownsetup готовитC с открытыми подсказками,свободными остальными пальцами и выключенной педалью,без принудительного выравнивания кистей. Вowncase нетafter;из07-02 оно не скопировано. Registryguide/learning/timeSignature/meter/pedal/timingPrecision/assessmentStatus/after/sameGoalAs отсутствуют и не созданы/nullнеподставлены. Наличие sameGoalAs в source-case отдельно от отсутствия этого поля в cachedrow.

Owncontext прямо называет ту же двигательную цель,чтоdetail-p-hands-01,и две дополнительные атаки. Это прочитанная source-декларация. Целевая registry-строкаdetail-p-hands-01 сейчас не читалась:её объём не выдаётся за свежепроверенный. Существующий goalKey не создан заново;alias,grade/XP/history не переносились,450/427upper и семейства целей не пересчитывались.

Триguard имеют разные роли:instructione75497e9/stepsffe0d3b0/gradeca456c3a. Только литералgrade совпал сcachedgrade;signature/version/Assessment/review/register не вычислялись и не исполнялись. Description=c.goal;guide/learning/ритм/самопроверка/происхождение прочитаны в прежнем applier,полныйruntimeguide/merge/normalizer/DOM не собран. Старые source references не скачивались,HANDS_WHOLE глобально не разрешался.

Раскрытыйtransfer внеMIDI — заранее подготовленные RH C4→LH C3→RH C4→LH C3,четыре четверти и отпускание последнего на следующей границе. Смена начинающей руки и числа повторов не новый урок,стимул или независимый слуховой ответ. Известный образ и возвращение после перерыва не подтверждают реальную память,чтение,слух,familiarity/novelty или перенос навыка человеком.

Clark15/36 «Coordinating the Hands» явно reused по точным sourcebaseSHA/QA:72entries/0новых/+1reuseapplication/accessnotes прежние,freshHTML/image/PDF/audio/video0. Короткая отдельная проверка не равна координации вместе. Это педагогическая рекомендация,не controlledstudy/одобрение наших56BPM,нот,пальцев,счёта или числовых допусков. Clark не добавлен вruntime lesson.references.

[Документные проверки](../qa/piano-curriculum-2026-11-10-43-c-handoff-source-checks.json):1recordhelper/1принят,23bindings/15fields/8contexts,новыхmismatch0. Новыхуроков/целей/ID/планов/стимулов/банков/контрактов/протоколов0;application/Assessment/fragmentAPI/fullbuilder/loader/browser/device0. MIDIнепальцы/удобство/баланс/педагог.450/186MIDI/153происхождения/13контролей/10вариантов/427upper,verifiedDistinctnull/teacher0;4F/6future/2C иvoicev2gap прежние.

[HTTPS107](../qa/melodiajest-2026-11-10-107-observation.json):19:55:02UTC,2GET/healthy79/API d424…/course334…/schema2. Known105read19:15:38/actualcalendar19:01:07/057793… reusedSHA;новогоSSH нет/actual20непроверялся. PGmanual102/165de03b…/23files202653287B/restore18:17:07 прежний,неdaily. HistoricalnewSnapshotCreatedtrue относится102,новойкопии107 нет. НовыхS3/backup/restore/архивов/серверныхизменений0;unknowncostне0.

Native2used/98remaining/ordinarytrue/spendfalse/10080min/reserve0. [Финальная сверка](../qa/melodiajest-2026-11-10-107-consistency.json):457runtime/exactpublished79/previous78/7защищённых групп/14local,история61–106/версии/порядок/grade/XP/прогресс сохранены. Source59непокрывает60–107;selectedsource79 независимо защищён102,весьcheckout восстановленным не объявляется. UI/React/PDF-навыки не требовались;find-skills60/OpenAI Docs88/nativeworkflow reused,установок0. [Та же автоматизация](../qa/melodiajest-2026-11-10-107-automation.json)ACTIVE20min/тот же чат. DONT_NOTIFY.

Следующий малый этап — source-only одна existing detail-p-hands-01,указанная целью/подготовкойcourse07-01. Прочитать её собственную registry-строку и найти реальные description/guide/learning/руки/пальцы/длительности/темп/подготовку в ограниченном окне четырёхпрежнихsourcefiles без исполнения. Сравнить с точным107snapshot07-01:не наследовать56BPM/8атак/end8/пальцы/guard/готовность. Проверить фактически прочитанное числоатак,а sourceфразу«2дополнительных» отделитьотнезависимойпедагогическойцели;никакого новогоalias/переносаgrade/XP/history/пересчётасчётчиков. Нетbinding/полей — partial/not-found/отсутствие,не null/выдуманныйmeter/profile/timingPrecision/assessmentStatus. C-чередование необщиепары/неindependentheld;MIDIнепальцы/педагог/переносчеловека. Clark15/36reuseпоточнойзаписи безmediafetch. Не исполнятьreview/register/application/assessment/fragmentAPI/fullbuilder/loader/browser,не создаватьновыйурок/цель/ID/план/контракт/протокол/оценщик/стимул и не писатьmatcher/validator/writer/migrator;6future/4F/2C не внедрять. Вначале nativequota/лёгкийHTTPS79;knownreceipts по необходимости:105actualcalendar19можноreuseSHA,actual20 только посленовогоfixedread/прогнознеinvocation;PGmanual102неdaily. Не перепаковывать/неперепубликовыватьготовый79 безновойпричины;будущиеобычныепроверенныерелизыразрешены,holdsuperseded. Fvoicev2gap/4manualcardsnotobserved/C75-76-history20open/teacher0/XP0 прежние;Baylor88/IMSLP84/ABRSM80 не повторять/необходить. Платныеуслуги/resize/монтирование/защищённыеудалениянеразрешались. ОднаACTIVE20minавтоматизация/чат/checkout/последовательно/until-exhausted/reserve0.

Эксплуатация — [этап107](melodiajest-operations-2026-11-10-107.md).
