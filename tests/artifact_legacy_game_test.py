"""Pin the complete public99/100 game profile independently of current assets."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('artifact_legacy_production', ROOT / 'deploy/shared-host/release_artifact.py')
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)
FIXTURE = json.loads((ROOT / 'tests/fixtures/artifact-public99-100-profile-v1.json').read_text())
LEGACY = frozenset(FIXTURE['profiles'][0]['assets'])


def public_files(names, version):
    files = {name: ('fixture:' + name).encode() for name in names}
    files['web-runtime.js'] = ("window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'account',serviceVersion:1,gameVersion:1,version:"
                               + json.dumps(version) + "});\n").encode()
    meta = dict(version=version, targetDomain='melodiajest.ru', domainStatus='registered', mode='web',
                nativeCompanion=False, storage='account', serviceVersion=1, gameVersion=1,
                personalProgress='database-and-versioned-browser-history',
                sourceEntries={'index.html': 'learn.html', 'trainer.html': 'index.html'},
                files={name: artifact.descriptor(data) for name, data in files.items()})
    files['web-release.json'] = json.dumps(meta).encode()
    return files


class LegacyGameProfileTests(unittest.TestCase):
    def test_complete_public100_profile_roundtrips(self):
        self.assertEqual(len(LEGACY), 38)
        self.assertNotIn('piano-open-response.js', LEGACY)
        files = public_files(LEGACY, '23.5.100')
        self.assertEqual(artifact.verify_web(files)['version'], '23.5.100')
        with tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='legacy-game-') as work:
            root = Path(work)
            web = root / 'web'
            web.mkdir()
            for name, data in files.items():
                (web / name).write_bytes(data)
            receipt = artifact.pack(web, ROOT / 'deploy/shared-host', root / 'legacy.tar.gz')
            result = artifact.restore(root / 'legacy.tar.gz', root / 'restored', receipt['sha256'])
            self.assertTrue(result['restoreVerified'])
            for name, data in files.items():
                self.assertEqual((root / 'restored/web' / name).read_bytes(), data)

    def test_complete_previous99_profile_is_the_same_pinned_set(self):
        self.assertEqual(FIXTURE['profiles'][0]['assets'], FIXTURE['profiles'][1]['assets'])
        self.assertEqual(artifact.verify_web(public_files(LEGACY, '23.5.99'))['version'], '23.5.99')

    def test_current_complete_game_profile_remains_valid(self):
        self.assertEqual(artifact.verify_web(public_files(artifact.ASSETS, '23.5.165'))['version'], '23.5.165')

    def test_legacy_subsets_extra_assets_and_wrong_game_contract_are_rejected(self):
        for names in [LEGACY - {'service-client.js'}, LEGACY - {'piano-game-player.js'}, LEGACY | {'unexpected.js'}]:
            with self.assertRaises(artifact.ArtifactError):
                artifact.verify_web(public_files(names, '23.5.100'))
        files = public_files(LEGACY, '23.5.100')
        meta = json.loads(files['web-release.json'])
        meta['personalProgress'] = 'unscoped'
        files['web-release.json'] = json.dumps(meta).encode()
        with self.assertRaises(artifact.ArtifactError):
            artifact.verify_web(files)


if __name__ == '__main__':
    unittest.main(verbosity=2)
