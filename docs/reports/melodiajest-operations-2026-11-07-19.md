# Ежедневный S3-этап в существующих службах

7 ноября 2026. **Внешние backup, cold restore и health подключены к трём существующим службам MelodiaJest и проверены через настоящие service paths.** Новых таймеров **0**, базовые шесть unit-файлов сохранены. Повтор того же содержимого не вызвал S3-запросов. Сайт остаётся **23.5.41**. Доказательства — [JSON](melodiajest-operations-2026-11-07-19.json), рабочий порядок — [S3 schedule](../MELODIAJEST_S3_SCHEDULE.md).

## Поведение и защита

`backup_s3_schedule.py` установлен через три собственных `20-external-s3.conf`: daily backup, weekly restore-check, hourly backup-health. ExecStartPost выполняется после успешного серверного шага; его ошибка делает службу неуспешной. Базовый worker, три существующих timer-файла и их календари не менялись. RandomizedDelaySec сохраняется; фактическое следующее время может уточняться systemd.

Сохранены PrivateNetwork, AF_UNIX, ProtectSystem=strict, MemoryMax=256M, ReadWritePaths только собственных ops/реальной общей блокировки. S3 выполняется в ограниченных временных контейнерах; anonymous probe перенесён из сетевого пространства хоста. Во временной systemd-службе с теми же ограничениями проверены разрешение серверного backup-конфига и 403 anonymous GET. Клиентский ключ не используется, секреты не выводятся. Первичные источники: [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [restic restore](https://restic.readthedocs.io/en/stable/050_restore.html).

Версия покрытия учитывает current/previous web/source SHA, собственные controls, development archive, scheduler controls и restic. Новые ID/время неизменного серверного snapshot не создают новую внешнюю копию. При изменении: prepare → backup → cold restore → успешная общая квитанция. Сбой restore сохраняет созданный backup и продолжает тот же snapshot без повторной отправки. Неизменный daily обновляет локальную проверку покрытия, сохраняя время настоящей записи/удалённого восстановления; weekly заново читает тот же точный snapshot из S3.

Backup/restore имеют отдельные last-attempt; старый успех и unchanged-пропуск не скрывают последний неуспешный restore. Health проверяет текущий fingerprint, snapshot/manifest, coverage-check моложе 30 часов и S3-restore моложе 8 дней, не обращаясь к бакету. Transport v2 отделён от scheduler-конфига; старый v1 фазы 18 остаётся читаемым. Плановые restores используют собственный серверный пароль и явно отмечают passwordReadFromVpsFile=true, passwordRecoveredFromIndependentCopy=false; независимая DPAPI-проверка пароля относится к фазе 18.

## Проверки и обратимая установка

- `npm test`: **734/734**, 0 ошибок/пропусков, **441698,0179 ms**. Исполняемые runtime/scheduler после этого не менялись.
- Windows: runtime **20**, scheduler **14**, один POSIX-only file-restore пропущен. Linux: runtime **19**, один DPAPI-only пропущен, scheduler **15**. Из восстановленного development checkpoint — **34 успешных**, один POSIX-only пропуск на Windows.
- Проверены неизменный fingerprint при новых timestamp/ID, изменение покрытия при новых current/previous/source/config, продолжение после отказа restore, точный snapshot/manifest, просроченные/будущие/неполные квитанции, лишние/секретные пути и действительное восстановление 20 control-файлов на Linux.
- Исправлен обнаруженный при проверке установщика дефект удаления впервые созданного собственного конфига при rollback. Установщик и передаваемый серверный код скомпилированы; исправление проверено настоящим install → rollback → install. Полный npm-прогон не повторялся: его runtime/scheduler не изменились, изменённый installer проверен по своему реальному пути.

Закреплённый каталог `/opt/melodiajest/ops/tooling/s3-f832ae3aa2ed85fe`, конфиг `ops/s3-schedule.json`, transport `ops/s3-backup.json`. Постоянный установщик `tools/install-melodiajest-s3-schedule.py` сверяет исходники с восстановленным архивом, сохраняет baseline, восстанавливает его байты в новом частном каталоге, проверяет systemd и ограничения. SHA текущих файлов и baseline проверяются до отката; другие изменения не перезаписываются.

Первоначальная установка `ops/s3-install-99af341f0b1f2cde` отменена проверенным откатом. Итоговая — `ops/s3-install-f1c228b0a96dbec2`. Прежние файлы и квитанции сохранены. Использованы настоящий `/run/lock/libre-deploy.lock`, собственная operation.lock и worker-lock; чужие операции не прерывались. Сайты/сервисы Libreta, Praicer и Grigorova не менялись.

## Копия и восстановление

Итоговый development checkpoint после исправления installer: **448 исходников, 480 файлов архива**, **2180366 байт**. SHA256 `fa7618b06fbe2ac7834d2db0b7be66a3d81983e9ad15ce557eb6917295a7c0f1`. Локально `dist/backups/melodiajest-development-23.5.41-20261107-19b.tar.gz`, VPS `ops/development-source-fa7618b06fbe/selected-checkout.tar.gz`; обе копии восстановлены. Предыдущий checkpoint 19 сохранён, но итоговым не объявляется. Архив сделан до S3: поздние квитанции/документы исключены. Опубликованный 431-source артефакт 23.5.41 учитывается отдельно.

Полезная нагрузка — **17 файлов, 17449503 байта**, manifest SHA256 `0d7291a95df0dc0e3f07630357a775be6f0be8c1d17d8481157a0015b8802cee`. Kit SHA256 `7b7470f8adf1900a979cbdf3c51313d19de6cc2c58f3bd9f73975b149638a267`. Внешний snapshot:

`c9036c4dffc6cb62d110b26ccf7283042132836e4d1036155cee774d1b5fad74`

Первый настоящий daily service завершился **07:01:42 UTC**: backup и cold restore нового комплекта прошли. Совпали SHA/размеры всех 17 файлов; восстановлены 480 файлов архива, current/previous **23.5.41/40**, **12 базовых controls** и **20 scheduler controls**. Два Nginx без сети/публичных портов каждый отдали 28 совпадающих файлов. Исходный payload временно отсутствовал, кеш/destination были новыми; production-тома не подключались. Временные каталоги удалены, оставшихся собственных контейнеров 0.

Повтор daily создал очередную серверную квитанцию, но внешний snapshot и байты сетевых backup/restore-квитанций остались прежними; S3-запросов **0**. Weekly service вручную проверил основной серверный restore и повторный внешний cold restore до **07:03:27 UTC**. Hourly service вручную проверил оба health до **07:04:44 UTC**, problems=[]; S3-запросов health **0**.

Нативные daily/weekly внешнего этапа **ещё не наблюдались**. Первый нативный hourly в **07:00:17 UTC** предшествовал первому backup и корректно сообщил об отсутствующих bootstrap-квитанциях; этот неуспешный отчёт сохранён в JSON, а результат после ручного bootstrap подтверждён отдельно. Следующий native hourly около 08:01 UTC; daily/weekly — 8 ноября. Установка таймеров не выдаётся за уже наблюдённый успешный плановый restore.

## Измерения, ограничения и очередь

| Restic | Время процесса | CPU user/system | Peak child RSS |
| --- | ---: | ---: | ---: |
| backup | 1,638 s | 0,341 / 0,110 s | 72576 KiB |
| первый S3 restore | 1,308 s | 0,375 / 0,092 s | 63916 KiB |
| повторный S3 restore | 1,677 s | 0,383 / 0,117 s | 63476 KiB |

Для 17449503 байт входа restic сообщил **2249593 data_added_packed**; это не полный биллинг и не число объектов. В этой фазе List-запросов **0**, известны два anonymous GET (контекстная проверка и backup), три вызова restic (backup/restore/restore). Полное число HTTP-запросов и стоимость **неизвестны**. CDN/ускорение сайта не внедрялись и не заявляются.

Итоговый preflight **07:05:15 UTC**: четыре HTTPS-сайта 200, MelodiaJest healthy, manifest 23.5.41 `5575c6e9c5b1d025c3b9ee8f0ab9dc28cd24b89778e500b9d0ff1ff763910b72`, Caddy прежний. Свободно **4922363904 байта**, MemAvailable **1719548 kB**; изменение общих ресурсов не приписывается только этой работе. Серверный snapshot `39150d3669df4eea8c3022d76a4f723b` отдельно восстановлен; его ID отличается от snapshot, включённого в прежний S3-kit, но проверенное содержимое current/previous/controls совпадает. Внешние last-attempt и health успешны.

IAM-область общего серверного ключа не сужалась, политики не менялись. Автоматическое восстановление данных не является новой проверкой пароля с компьютера; его независимая DPAPI-копия и ограничения Windows-профиля описаны в фазе 18. Для потери VPS нужны также полномочия Selectel/перевыпуск доступа. Браузерный прогресс копией не покрывается. Ротация/prune/удаление старых копий не включены; current/previous и подтверждённые точки сохранены.

Новых уроков **0**, курсор **course01-06** сохранён. Браузерные файлы/музыка не менялись, build/deploy/повтор музыкальных аудитов и браузера не требовались. Git commit/push, DNS, новые услуги и guitarjest не затрагивались. Квота перед установкой: обычное использование разрешено, недельный расход 83%, остаток 17%, резерв 0%.

Следующий этап — проверенный разбор C/G и чередования рук **course01-06**. Далее сохранены браузерный controller lesson packages и отдельная ограниченная ротация собственных подтверждённых копий.
