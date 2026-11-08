"""Tests exercise the production archive code, never a copy of the algorithm."""
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release_artifact', ROOT / 'deploy/shared-host/release_artifact.py')
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


class ReleaseArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix='artifact-tests-', dir=ROOT / 'tmp')
        cls.base = Path(cls.work.name)
        cls.web = cls.base / 'web'
        subprocess.run(['node', '--preserve-symlinks', '--preserve-symlinks-main', '-e',
                        "require('./tools/build-web.cjs').buildWeb({outDir:process.argv[1]})", str(cls.web)], cwd=ROOT, check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.work.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=self.base)
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.archive = self.folder / 'release.tar.gz'
        self.source = self.folder / 'checkout'
        self.source.mkdir()
        for name, text in {
            'piano-lesson-development.js': 'uncommitted lesson revision: C4 E4 G4, 1 3 5',
            'tools/local.cjs': 'local tool', 'docs/state.json': '{"cursor":"course03-08"}',
            'tests/example.py': '# source test', 'package.json': '{"version":"23.5.33"}',
            'trainer-content.json': 'PRIVATE CATALOG', '.env': 'PRIVATE KEY',
            '.aws/credentials': 'PRIVATE CREDENTIALS', '.git/config': 'PRIVATE REMOTE',
            'private.pem': 'PRIVATE KEY', 'data/export.json': 'PRIVATE EXPORT'
            , 'service/server.cjs': 'separate account API source', 'service/package.json': '{"private":true}',
            'service/data/user.json': 'PRIVATE ACCOUNT DATA', 'service/backups/bundle.json': 'PRIVATE BACKUP'
        }.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        self.receipt = artifact.pack(self.web, ROOT / 'deploy/shared-host', self.archive, self.source)

    def members(self):
        return artifact.read_bundle(self.archive, self.receipt['sha256'])[0]

    def write_variant(self, members=None, extra=None, update_manifest=False):
        members = dict(self.members() if members is None else members)
        if update_manifest:
            meta = json.loads(members['bundle.json'])
            meta['files'] = {name: artifact.descriptor(data) for name, data in members.items() if name != 'bundle.json'}
            members['bundle.json'] = json.dumps(meta).encode()
        result = self.folder / 'variant.tar.gz'
        with tarfile.open(result, 'w:gz') as tar:
            for name, data in members.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                tar.addfile(item, io.BytesIO(data))
            if extra:
                item, data = extra
                tar.addfile(item, io.BytesIO(data) if data is not None else None)
        return result, artifact.sha256(result.read_bytes())

    def rejects(self, archive, digest):
        destination = self.folder / 'should-not-exist'
        with self.assertRaises((artifact.ArtifactError, tarfile.TarError, ValueError)):
            artifact.restore(archive, destination, digest)
        self.assertFalse(destination.exists())

    def test_roundtrip_includes_actual_uncommitted_sources_and_no_private_data(self):
        destination = self.folder / 'restored'
        result = artifact.restore(self.archive, destination, self.receipt['sha256'])
        self.assertTrue(result['restoreVerified'])
        self.assertTrue(result['sourceSnapshotIncluded'])
        self.assertEqual((destination / 'source/piano-lesson-development.js').read_text(), 'uncommitted lesson revision: C4 E4 G4, 1 3 5')
        self.assertEqual((destination / 'source/docs/state.json').read_text(), '{"cursor":"course03-08"}')
        self.assertFalse(any(b'PRIVATE' in value for value in self.members().values()))
        self.assertEqual((destination / 'source/service/server.cjs').read_text(), 'separate account API source')
        self.assertEqual(artifact.read_web(self.web), {name: (destination / 'web' / name).read_bytes() for name in artifact.PUBLIC})

    def test_pack_is_reproducible(self):
        other = self.folder / 'same.tar.gz'
        receipt = artifact.pack(self.web, ROOT / 'deploy/shared-host', other, self.source)
        self.assertEqual(receipt['sha256'], self.receipt['sha256'])

    def test_archive_never_overwritten(self):
        with self.assertRaises(artifact.ArtifactError):
            artifact.pack(self.web, ROOT / 'deploy/shared-host', self.archive, self.source)
        self.assertEqual(artifact.sha256(self.archive.read_bytes()), self.receipt['sha256'])

    def test_existing_restore_destination_preserved(self):
        destination = self.folder / 'existing'
        destination.mkdir()
        (destination / 'progress.json').write_text('keep user progress')
        with self.assertRaises(artifact.ArtifactError):
            artifact.restore(self.archive, destination, self.receipt['sha256'])
        self.assertEqual((destination / 'progress.json').read_text(), 'keep user progress')

    def test_checksum_is_required(self):
        for value in ['', 'x' * 64, '0' * 64]:
            self.rejects(self.archive, value)

    def test_archive_corruption(self):
        self.archive.write_bytes(self.archive.read_bytes()[:-9])
        self.rejects(self.archive, self.receipt['sha256'])

    def test_changed_public_bytes_fail_even_with_updated_bundle_hash(self):
        members = self.members()
        members['web/index.html'] += b'corruption'
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_missing_asset(self):
        members = self.members()
        del members['web/music-document.js']
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_native_server_cannot_become_public(self):
        members = self.members()
        members['web/server.cjs'] = b'not public'
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_private_source_forbidden_even_with_correct_checksum(self):
        members = self.members()
        members['source/trainer-content.json'] = b'private'
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_unlisted_source_folder(self):
        members = self.members()
        members['source/node_modules/arbitrary.js'] = b'unlisted'
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_missing_configuration(self):
        members = self.members()
        del members['config/nginx.conf']
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_source_corruption(self):
        members = self.members()
        members['source/piano-lesson-development.js'] = b'changed source'
        self.rejects(*self.write_variant(members))

    def test_escaping_and_windows_device_names(self):
        for name in ['../outside', '/absolute', 'web/../../outside', 'web\\outside', 'C:/outside', 'web/file.', 'source/tools/CON.js', 'web//index.html']:
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                item.size = 1
                self.rejects(*self.write_variant(extra=(item, b'x')))

    def test_links_and_special_members(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE]:
            with self.subTest(kind=kind):
                item = tarfile.TarInfo('web/link')
                item.type, item.linkname = kind, '../../outside'
                self.rejects(*self.write_variant(extra=(item, None)))

    def test_duplicate_and_case_collision(self):
        for name in ['web/index.html', 'web/INDEX.HTML']:
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                item.size = 1
                self.rejects(*self.write_variant(extra=(item, b'x')))

    def test_declared_member_size_limit(self):
        item = tarfile.TarInfo('source/tools/large.py')
        item.size = artifact.MAX_FILE + 1
        self.rejects(*self.write_variant(extra=(item, None)))

    def test_expansion_limit_includes_tar_metadata(self):
        bomb = self.folder / 'bomb.tar.gz'
        bomb.write_bytes(gzip.compress(b'x' * 8193))
        with patch.object(artifact, 'MAX_TOTAL', 4096), patch.object(artifact, 'MAX_FILES', 4):
            self.rejects(bomb, artifact.sha256(bomb.read_bytes()))

    def test_wrong_mode_not_accepted(self):
        members = self.members()
        manifest = json.loads(members['web/web-release.json'])
        manifest['nativeCompanion'] = True
        members['web/web-release.json'] = json.dumps(manifest).encode()
        self.rejects(*self.write_variant(members, update_manifest=True))

    def test_bundle_identity(self):
        members = self.members()
        meta = json.loads(members['bundle.json'])
        meta['version'] = '0.0.0'
        members['bundle.json'] = json.dumps(meta).encode()
        self.rejects(*self.write_variant(members))

    def test_source_symlink(self):
        path = self.source / 'tools/linked.cjs'
        try:
            path.symlink_to(self.source / 'piano-lesson-development.js')
        except OSError:
            self.skipTest('Windows symlink privilege unavailable; Linux integration checks this case')
        with self.assertRaises(artifact.ArtifactError):
            artifact.pack(self.web, ROOT / 'deploy/shared-host', self.folder / 'linked.tar.gz', self.source)

    def test_backup_without_sources_reports_limited_coverage(self):
        output = self.folder / 'server-backup.tar.gz'
        result = artifact.pack(self.web, ROOT / 'deploy/shared-host', output)
        self.assertFalse(result['sourceSnapshotIncluded'])
        restored = artifact.restore(output, self.folder / 'server-restore', result['sha256'])
        self.assertTrue(restored['restoreVerified'])
        self.assertFalse(restored['sourceSnapshotIncluded'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
