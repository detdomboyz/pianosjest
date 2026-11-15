from pathlib import Path
code=Path('tmp/read-native-health-57.py').read_text(encoding='utf-8')
code=code.replace("tmp/melodiajest-57-native-observation.json","tmp/melodiajest-57-end-native-observation.json")
exec(compile(code,'read-native-health-end-57.py','exec'))
