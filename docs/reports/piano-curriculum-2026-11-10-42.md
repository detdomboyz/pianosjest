# Курс пианино — исследование42, 10 ноября2026

Одна существующая course07-02 «Зеркальная лесенка по очереди» прочитана по своей registry-строке и owncase2009–2017. Руки вступают по очереди,а высоты обеих линий идут вверх. Зеркальны номера пальцев. Подтверждённых расхождений нет;новой готовности или исполнения человека не наблюдалось.

[Сверка42](../qa/piano-curriculum-2026-11-10-42-alternation-source-review.json):15literalfields/23exactsourcebindings/8контекстов;applier2019/2022–2034. Description=c.goal;guide,learning,условныеguard и прежние ссылки прочитаны без исполнения.

| Доли | Последовательные ноты | Пальцы из ownsetup/motion |
| --- | --- | --- |
|0/1 |C3/48 → C4/60 |LH5 → RH1 |
|2/3 |D3/50 → D4/62 |LH4 → RH2 |
|4/5 |E3/52 → E4/64 |LH3 → RH3 |
|6/7 |F3/53 → F4/65 |LH2 → RH4 |
|8/9 |G3/55 → G4/67 |LH1 → RH5 |

Свои58BPM/standard,10одиночных вступлений по1доле,конецу10. Предыдущая клавиша освобождается у следующего вступления,дополнительной тихой доли нет;последнийG4 отпускается у «три» третьего такта. Это пятипальцевая фигура,не полная гамма,не contrarypitchmotion,не одновременные октавные пары и не independentheldvoice.54BPM/52BPM,двухдольные пары и пальцы других карточек не перенесены.

Owncount прямо задаёт4/4;genericrhythmNotice также4/4. Десять долей — два полных такта и две доли третьего. Structuredmeter/timeSignature отсутствует вregistry/не найден как объект в boundedapplier,а timingPrecision/assessmentStatus отсутствуют вregistry:они не созданы и не подставлены null/v1/v2. Ownsetup прямо выключает педаль;структурного pedalfield не добавлено.

Собственные after07-01/requires07-01,02-03,03-03 и next07-03. Подготовка — ровная передачаC и пять пальцев вверх каждой рукой. Короткий разбор C3→C4→D3→D4,затем E/F и G возвращается к целой записи. Появление07-02 в сохранённой подготовке07-03 — связь маршрута,не доказательство переноса skill/grade или исполнения общих пар человеком.

Sourceguards имеют три разные роли:instructionee16e592,steps298ea6f7,grade2eea3a0e. Только литералgrade совпал с текущим cachedgrade2eea3a0e. Signatures,музыкальные версии и условная review-функция сейчас не вычислялись/не вызывались. Musicc7053937…/editiond1dc7b… прочитаны из registry. Чтениеguard не подтверждает полную runtimeсборку/grade/persistence.

Registryguide/learning отсутствуют. Source-guide/learning описывает известный образ низких и высоких ответов,добровольное «Слушать»,внутреннее представление,самопроверку,повтор после отдыха и на следующий день. Это практика знакомой записи,не независимый слуховой/памятный/читательский тест. Реальные навыки/familiarity/novelty человека не наблюдались.

Открытыйtransfer вне текущего MIDI-зачёта — заранее подготовленные C4/RH1→C3/LH5→D4/RH2→D3/LH4→E4/RH3→E3/LH3,шесть четвертей с отпусканием последнего на следующей границе. Подсказки разрешены,темп сначала удобный. Это раскрытая проба переноса,не новый урок,стимул,банк или протокол.

Michael Clark,[§15 Practice Strategies / Coordinating the Hands](https://openbooks.library.baylor.edu/pianobasics/chapter/practice-strategies/) явно reused из36 по sourcebaseSHA/QA.72entries/0новых/+1reuseapplication/accessnotes прежние;freshHTML/image/PDF/audio/video0. Краткая отдельная работа не равна координации рук вместе;это педагогическая рекомендация,не controlledstudy/одобрение наших58BPM,нот,пальцев,счёта или допусков. Clark в runtime.references не вставлен;прежние OpenLearn/Yamaha/Pierce/Duke-ссылки не объявлены свежепрочитанными,HANDS_WHOLE глобально не разрешался.

[Документные проверки](../qa/piano-curriculum-2026-11-10-42-alternation-source-checks.json):1recordhelper/1принят,23bindings/15fields/8contexts. Новых уроков/целей/ID/планов/стимулов/банков/контрактов/протоколов0;application/Assessment/fragmentAPI/fullbuilder/loader/browser/device0. MIDI не доказывает пальцы,удобство,баланс,художественность или педагога.450/186MIDI/153происхождения/13контролей/10вариантов/427верхняя граница,verifiedDistinctnull/teacher0;4F/6future/2C иvoicev2gap прежние.

[HTTPS106](../qa/melodiajest-2026-11-10-106-observation.json):19:35:36UTC,healthy79/API d424…/course334…/schema2,2GET. Known105read19:15:38/actualcalendar19:01:07/057793… переиспользованы поSHA;новогоSSH нет. PGmanual102/ff0…/165de03b…/23files202653287B/restore18:17:07 прежний,неdaily. ПрочитанноеnewSnapshotCreatedtrue принадлежит102,новойкопии106 нет. НовыхS3/backup/restore/архивов/серверныхизменений0;unknowncostне0. Один локальный read имел опечатку piano-prefix вместо melodiajest для сохранённой QA105;новогоSSH или повторного сетевого чтения это не вызвало.

Native1used/99remaining/ordinarytrue/spendfalse/10080min/reserve0. [Финальная сверка](../qa/melodiajest-2026-11-10-106-consistency.json):457runtime/exactpublished79/previous78/7защищённых групп/14local,история61–105/версии/порядок/grade/XP/прогресс сохранены. Тяжёлые тесты,упаковка,повторная публикация не нужны. Source59непокрывает документы60–106;selectedsource79 независимо защищён102,весьcheckout восстановленным не объявляется.

UI не менялся,новой браузерной проверки этой карточки нет. Find-skills60/OpenAI Docs88/nativeworkflow reused;UI/React/PDF-навыки не требовались,установок0. [Та же автоматизация](../qa/melodiajest-2026-11-10-106-automation.json)ACTIVE20min/тот же чат. DONT_NOTIFY:новогоакционногорасхождения нет.

Следующий малый этап — source-only одна existing course07-01 как подготовка07-02. Прочитать собственную registry-строку и owncase2000–2008,переиспользовать общие applierbindings2019/2022–2034 из106 поSHA,еслифайлпрежний. Свои высоты/руки/пальцы/BPM/объём/начала/концы/подготовка/guide-learning/transfer/фактическиимеющийсяsameGoalAs не подменять данными07-02. УказанныйsameGoalAs/detail-p-hands-01 не новыйalias/переносgrade/XP;две дополнительные атаки не новая самостоятельная цель. Разделить instruction/steps/gradeguards без вычисленияsignatures или исполнения;нетполей — не создавать/nullнеподставлять. ЧередованиеC не совместныепары/неindependentheld;MIDIнепальцы/педагог/переносчеловека. Clark15/36reuseпоточнойзаписи безmediafetch;еслиbindingне найден — partial/not-found безглобальногоаудита. Не исполнятьreview/register/application/assessment/fragmentAPI/fullbuilder/loader/browser,не создаватьновыйурок/цель/ID/план/контракт/протокол/оценщик/стимул и не писатьmatcher/validator/writer/migrator;6future/4F/2C не внедрять. Nativequota/лёгкийHTTPS79/known105actualcalendar19 поSHA по необходимости;manualPG102неdaily/прогнознеinvocation. Не перепаковывать/неперепубликовыватьготовый79 безновойпричины;будущиеобычныепроверенныерелизыразрешены,holdsuperseded. Fvoicev2gap/4manualcardsnotobserved/C75-76-history20open/teacher0/XP0 прежние;Baylor88/IMSLP84/ABRSM80 не повторять/необходить. Платныеуслуги/resize/монтирование/защищённыеудалениянеразрешались. ОднаACTIVE20minавтоматизация/чат/checkout/последовательно/until-exhausted/reserve0.

Эксплуатация — [этап106](melodiajest-operations-2026-11-10-106.md).
