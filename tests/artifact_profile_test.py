"""Exercise shipped archive selection, legacy reading and exact byte budgets."""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('artifact_profile_production', ROOT / 'deploy/shared-host/release_artifact.py')
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)
PROFILE = 'application-course-reports-v1'


class ArchiveProfileTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory(dir=ROOT / 'tmp', prefix='archive-profile-')
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        self.public = {name: ('public fixture:' + name).encode() for name in artifact.ASSETS}
        self.public['web-runtime.js'] = b"window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'browser'});\n"
        manifest = dict(version='1.2.3', targetDomain='melodiajest.ru', domainStatus='registered',
                        mode='web', nativeCompanion=False, storage='browser',
                        files={name: artifact.descriptor(data) for name, data in self.public.items()})
        self.public['web-release.json'] = json.dumps(manifest).encode()
        for name, data in self.public.items():
            (self.web / name).write_bytes(data)
        self.checkout = self.root / 'checkout'
        for name in ['tools', 'tests', 'docs/qa', 'docs/reports', 'deploy/shared-host', 'service']:
            (self.checkout / name).mkdir(parents=True, exist_ok=True)
        self.originals = {'piano-lesson-development.js': b'original notes and fingers',
                          'docs/piano-curriculum-state.json': b'{"progressVersion":2}',
                          'docs/reports/lesson.md': b'full lesson explanation',
                          'service/course-registry.json': b'{"canonical":"unchanged"}',
                          'tests/example.py': b'# regression source',
                          'tools/helper.cjs': b'// local tool',
                          'docs/qa/large.json': b'qa-evidence-' * 1024,
                          'trainer-content.json': b'PRIVATE USER NOTES'}
        for name, data in self.originals.items():
            (self.checkout / name).write_bytes(data)

    def pack(self, name='release.tar.gz', checkout=True):
        target = self.root / name
        return target, artifact.pack(self.web, ROOT / 'deploy/shared-host', target,
                                     self.checkout if checkout else None)

    def legacy_archive(self, contradictory_profile=False):
        members = {'web/' + name: data for name, data in self.public.items()}
        members.update({'config/' + name: (ROOT / 'deploy/shared-host' / name).read_bytes()
                        for name in artifact.CONFIG})
        members['source/docs/qa/legacy.json'] = b'old preserved evidence'
        meta = dict(format='melodiajest-artifact-v1', version='1.2.3',
                    webManifestSha256=artifact.sha256(self.public['web-release.json']),
                    sourceSnapshotIncluded=True,
                    files={name: artifact.descriptor(data) for name, data in members.items()})
        if contradictory_profile:
            meta.update(sourceProfile=PROFILE, excludedEvidenceRoots=['docs/qa'])
        members['bundle.json'] = json.dumps(meta).encode()
        target = self.root / 'legacy.tar.gz'
        with tarfile.open(target, 'w:gz', format=tarfile.USTAR_FORMAT) as stream:
            for name, data in members.items():
                item = tarfile.TarInfo(name)
                item.size = len(data)
                stream.addfile(item, io.BytesIO(data))
        return target, artifact.sha256(target.read_bytes())

    def test_application_profile_preserves_code_course_reports_and_declares_evidence_scope(self):
        target, receipt = self.pack()
        files, meta = artifact.read_bundle(target, receipt['sha256'])
        self.assertNotIn('source/docs/qa/large.json', files)
        self.assertEqual(meta['sourceProfile'], PROFILE)
        self.assertEqual(meta['excludedEvidenceRoots'], ['docs/qa'])
        self.assertEqual(receipt['sourceProfile'], PROFILE)
        self.assertEqual(receipt['excludedEvidenceRoots'], ['docs/qa'])
        self.assertTrue(receipt['sourceSnapshotIncluded'])
        for name, data in self.originals.items():
            self.assertEqual((self.checkout / name).read_bytes(), data)
            if name not in ['docs/qa/large.json', 'trainer-content.json']:
                self.assertEqual(files['source/' + name], data)
        self.assertFalse(any(b'PRIVATE USER NOTES' in data for data in files.values()))

    def test_old_complete_qa_sources_still_restore_with_original_reader_allowlist(self):
        self.assertTrue(artifact.source_allowed('docs/qa/legacy.json'))
        target, digest = self.legacy_archive()
        result = artifact.restore(target, self.root / 'legacy-restored', digest)
        self.assertTrue(result['restoreVerified'])
        self.assertEqual((self.root / 'legacy-restored/source/docs/qa/legacy.json').read_bytes(),
                         b'old preserved evidence')

    def test_manifest_bytes_are_budgeted_before_any_output_is_created(self):
        payload = sum(map(len, self.public.values()))
        payload += sum((ROOT / 'deploy/shared-host' / name).stat().st_size for name in artifact.CONFIG)
        output = self.root / 'over-budget.tar.gz'
        with patch.object(artifact, 'MAX_TOTAL', payload):
            with self.assertRaises(artifact.ArtifactError):
                artifact.pack(self.web, ROOT / 'deploy/shared-host', output)
        self.assertFalse(output.exists(), 'A payload that fits without its manifest must not leave an invalid archive')

    def test_exact_total_limit_including_manifest_remains_accepted(self):
        target, receipt = self.pack(checkout=False)
        files, _ = artifact.read_bundle(target, receipt['sha256'])
        total = sum(map(len, files.values()))
        with patch.object(artifact, 'MAX_TOTAL', total):
            second, other = self.pack('exact-total.tar.gz', checkout=False)
            self.assertEqual(receipt['sha256'], other['sha256'])
            self.assertEqual(artifact.read_bundle(second, other['sha256'])[0], files)

    def test_member_count_reserves_the_manifest_and_never_raises_existing_caps(self):
        target, receipt = self.pack(checkout=False)
        files, _ = artifact.read_bundle(target, receipt['sha256'])
        with patch.object(artifact, 'MAX_FILES', len(files)):
            _, other = self.pack('exact-count.tar.gz', checkout=False)
            self.assertEqual(receipt['sha256'], other['sha256'])
        with patch.object(artifact, 'MAX_FILES', len(files) - 1):
            with self.assertRaises(artifact.ArtifactError):
                self.pack('too-many.tar.gz', checkout=False)
        self.assertFalse((self.root / 'too-many.tar.gz').exists())
        self.assertEqual((artifact.MAX_TOTAL, artifact.MAX_FILES, artifact.MAX_FILE),
                         (128 * 1024 * 1024, 4096, 16 * 1024 * 1024))

    def test_new_profile_cannot_silently_claim_excluded_qa_is_part_of_its_payload(self):
        target, digest = self.legacy_archive(contradictory_profile=True)
        with self.assertRaises(artifact.ArtifactError):
            artifact.restore(target, self.root / 'contradiction', digest)
        self.assertFalse((self.root / 'contradiction').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
