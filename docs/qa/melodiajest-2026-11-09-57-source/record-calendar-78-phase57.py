from pathlib import Path
code=Path('tmp/record-calendar-77-phase56.py').read_text(encoding='utf-8')
code=code.replace('tmp/melodiajest-56-native-observation.json','tmp/melodiajest-57-end-native-observation.json')
code=code.replace('8f185f9865a44c06911897daf8f76da2','3017efcb97a647d28c6b1c86805f8e2f')
code=code.replace('a02a4e05ed56109344c5d6fd5ba0ce7b0cc9c38f6400734c6ba012e014f21d50','07222f7c6eb47590074f71635bf157fc84ffade8612f71e4096e3bf4ddd167dd')
code=code.replace('2026-11-09T13:30:50.895910+00:00','2026-11-09T16:15:21.593234+00:00')
code=code.replace('calendar-hourly77-before-candidate78','first-calendar-hourly78-after-publication56')
code=code.replace('docs/qa/melodiajest-2026-11-09-56-calendar77.json','docs/qa/melodiajest-2026-11-09-57-calendar78.json')
exec(compile(code,'record-calendar-78-phase57.py','exec'))
