import copy,hashlib,json,os,tempfile
from pathlib import Path
import sys,unittest
from unittest.mock import patch
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'deploy/shared-host'),str(ROOT/'tools')]
import backup_s3_runtime as s3
import backup_s3_job as job
import melodiajest_secret as secret
ENV={'AWS_ACCESS_KEY_ID':'SERVER_ONLY','AWS_SECRET_ACCESS_KEY':'SERVER_SECRET','AWS_DEFAULT_REGION':'ru-3','RESTIC_REPOSITORY':'FOREIGN_REPO','RESTIC_PASSWORD':'FOREIGN_PASSWORD'}
CLIENT={'LIBRE_OBJECT_STORAGE_ACCESS_KEY_ID':'CLIENT_ONLY'}
KW={'cache':'/opt/melodiajest/ops/external-work/unit/cache','nonce':'1'*32}

class RuntimeContract(unittest.TestCase):
 def test_config_is_fixed_to_existing_backup_file_and_own_repository(self):
  c=s3.configuration();self.assertEqual(s3.validate_configuration(c),c);self.assertEqual(c['credentialSource'],'/opt/libre/deploy/vps/.env.backup');self.assertTrue(c['repository'].endswith('/libreta-backups-a7f39c/melodiajest/backups/v1'));self.assertNotIn('scheduledExternalBackup',c)
 def test_legacy_snapshot_config_is_readable_without_claiming_a_schedule(self):
  c={**s3.configuration(),'format':'melodiajest-s3-runtime-v1','scheduledExternalBackup':False};self.assertEqual(s3.validate_configuration(c),c)
  with self.assertRaises(ValueError):s3.validate_configuration({**c,'scheduledExternalBackup':True})
 def test_anonymous_probe_uses_secret_free_isolated_bridge_container(self):
  with patch.object(job.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='403\n')) as run:
   self.assertEqual(job.anonymous_config_status(),403);command=run.call_args.args[0];text=' '.join(command)
   self.assertIn('--network bridge',text);self.assertIn('--read-only',text);self.assertIn('--cap-drop ALL',text);self.assertNotIn('--env',text);self.assertNotIn('type=bind',text);self.assertIn(s3.IMAGE,text)
 def test_anonymously_readable_config_fails_closed(self):
  with patch.object(job.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='200\n')):
   with self.assertRaises(ValueError):job.anonymous_config_status()
 def test_only_aws_fields_survive_and_foreign_repo_password_do_not(self):
  self.assertEqual(s3.filter_credentials(ENV,CLIENT),{'AWS_ACCESS_KEY_ID':'SERVER_ONLY','AWS_SECRET_ACCESS_KEY':'SERVER_SECRET'})
  v=copy.deepcopy(ENV);v['AWS_SESSION_TOKEN']='SESSION';self.assertEqual(s3.filter_credentials(v,CLIENT)['AWS_SESSION_TOKEN'],'SESSION')
 def test_client_missing_and_malformed_credentials_are_rejected(self):
  for change in [{'AWS_ACCESS_KEY_ID':'CLIENT_ONLY'},{'AWS_SECRET_ACCESS_KEY':''},{'AWS_SECRET_ACCESS_KEY':'secret\n'},{'AWS_DEFAULT_REGION':'other'}]:
   with self.assertRaises(ValueError):s3.filter_credentials({**ENV,**change},CLIENT)
 def test_config_cannot_redirect_repo_key_source_binary_or_scope(self):
  c=s3.configuration()
  for k in c:
   changed=copy.deepcopy(c);changed[k]='OTHER'
   with self.assertRaises(ValueError):s3.validate_configuration(changed)
  with self.assertRaises(ValueError):s3.validate_configuration({**c,'secret':'key'})
 def test_backup_mounts_only_own_payload_readonly_and_has_no_secret_argv(self):
  p=s3.command_plan(s3.configuration(),'backup',source='/opt/melodiajest/ops/external-work/unit/payload',kit_sha='a'*64,checkout_sha='b'*64,**KW)
  cmd=' '.join(p['command']);self.assertIn('dst=/payload,readonly',cmd);self.assertIn('--network bridge',cmd);self.assertIn('--cap-drop ALL',cmd);self.assertIn('--memory 768m',cmd);self.assertIn('--cpus 0.5',cmd);self.assertNotIn('SERVER_SECRET',cmd);self.assertNotIn(s3.CREDENTIAL_FILE,cmd);self.assertNotIn(s3.PASSWORD_FILE,cmd);self.assertIn('--hostname melodiajest-backup',cmd)
 def test_restore_mounts_no_original_input_or_password_source(self):
  p=s3.command_plan(s3.configuration(),'restore',destination='/opt/melodiajest/ops/external-work/unit/restored',snapshot='c'*64,**KW)
  cmd=' '.join(p['command']);self.assertNotIn('dst=/payload',cmd);self.assertNotIn(s3.PASSWORD_FILE,cmd);self.assertNotIn('docker.sock',cmd);self.assertEqual(p['arguments'][-4:],['c'*64,'--target','/restored','--verify'])
 def test_no_delete_prune_unlock_key_or_arbitrary_command(self):
  for op in ['forget','prune','unlock','key','mount','self-update','sh']:
   with self.assertRaises(ValueError):s3.restic_arguments(op)
 def test_snapshot_is_full_sha_and_backup_requires_both_input_hashes(self):
  for value in ['latest','abcd1234','../repo','A'*64]:
   with self.assertRaises(ValueError):s3.restic_arguments('restore',snapshot=value)
  with self.assertRaises(ValueError):s3.restic_arguments('backup',kit_sha='a'*64)
 def test_no_shared_or_traversal_paths_can_be_mounted(self):
  for p in ['/opt/libre','/opt/melodiajest/current','/opt/melodiajest/ops/external-work','/opt/melodiajest/ops/external-work/unit/../input','/opt/melodiajest/ops/external-work/unit/a,b','relative']:
   with self.assertRaises(ValueError):s3.own_path(p)
 def test_no_accidental_source_mount_for_other_operations(self):
  with self.assertRaises(ValueError):s3.command_plan(s3.configuration(),'check',source='/opt/melodiajest/ops/external-work/unit/payload',**KW)
  with self.assertRaises(ValueError):s3.command_plan(s3.configuration(),'backup',kit_sha='a'*64,checkout_sha='b'*64,**KW)
 def test_only_generated_password_format_is_accepted(self):
  self.assertEqual(s3.password_value(b'A'*64),'A'*64)
  for value in [b'password',b'A'*64+b'\n',b'A'*257,'A'*64]:
   with self.assertRaises(ValueError):s3.password_value(value)
 def test_runtime_and_repository_are_pinned_and_init_cannot_take_foreign_args(self):
  self.assertEqual(s3.BINARY_SHA,'20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639');self.assertIn('s3.bucket-lookup=path',s3.restic_arguments('init'))
  with self.assertRaises(ValueError):s3.restic_arguments('init',snapshot='a'*64)
 def payload(self,path):
  contents={'external-config.json':json.dumps(s3.configuration()).encode(),'checkout.tar.gz':b'fixture','runtime-pin.json':b'{}','runtime/restic_0.19.1_linux_amd64.bz2':b'fixture','runtime/SHA256SUMS':b'fixture','runtime/SHA256SUMS.asc':b'fixture','runtime/restic-signing-key.asc':b'fixture','published/kit.json':b'{}'}
  for name,data in contents.items():p=path/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  meta={'format':'melodiajest-external-payload-v1','files':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in contents.items()}}
  raw=json.dumps(meta).encode();(path/'payload.json').write_bytes(raw);return hashlib.sha256(raw).hexdigest()
 def test_payload_verifier_reads_actual_bytes_and_rejects_changed_content(self):
  with tempfile.TemporaryDirectory(prefix='melodiajest-payload-test-') as directory:
   p=Path(directory).resolve();digest=self.payload(p);self.assertEqual(len(job.verify_payload(p,digest)['files']),8);(p/'checkout.tar.gz').write_bytes(b'changed')
   with self.assertRaises(ValueError):job.verify_payload(p,digest)
 def test_extra_nested_manifest_is_not_ignored(self):
  with tempfile.TemporaryDirectory(prefix='melodiajest-payload-test-') as directory:
   p=Path(directory).resolve();digest=self.payload(p);(p/'published/payload.json').write_bytes(b'{}')
   with self.assertRaises(ValueError):job.verify_payload(p,digest)
 def test_even_a_listed_secret_filename_is_outside_payload_allowlist(self):
  with tempfile.TemporaryDirectory(prefix='melodiajest-payload-test-') as directory:
   p=Path(directory).resolve();self.payload(p);(p/'.env').write_bytes(b'not-allowed');meta=json.loads((p/'payload.json').read_bytes());meta['files']['.env']={'bytes':11,'sha256':hashlib.sha256(b'not-allowed').hexdigest()};raw=json.dumps(meta).encode();(p/'payload.json').write_bytes(raw)
   with self.assertRaises(ValueError):job.verify_payload(p,hashlib.sha256(raw).hexdigest())
 def test_payload_expected_hash_is_not_inferred_from_restored_metadata(self):
  with tempfile.TemporaryDirectory(prefix='melodiajest-payload-test-') as directory:
   p=Path(directory).resolve();self.payload(p)
   with self.assertRaises(ValueError):job.verify_payload(p,'0'*64)
 @unittest.skipUnless(os.name=='nt','Windows CurrentUser DPAPI only')
 def test_windows_dpapi_roundtrip_and_corruption_rejection(self):
  value=b'A'*64;encrypted=secret.protect(value);self.assertNotIn(value,encrypted);self.assertEqual(secret.unprotect(encrypted),value)
  damaged=bytearray(encrypted);damaged[-10]^=1
  with self.assertRaises(OSError):secret.unprotect(bytes(damaged))

if __name__=='__main__':unittest.main()
