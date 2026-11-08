import base64,copy,datetime,json,os,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'deploy/shared-host'))
import backup_s3_schedule as schedule
import backup_s3_job as job
import release_artifact as artifact

SHA='a'*64;SNAPSHOT='b'*64
CTX={'coverage':'c'*64,'checkoutSha256':SHA,'currentManifestSha256':'d'*64,'previousManifestSha256':'e'*64}

class FakeBackend:
 def __init__(self):self.calls=[];self.fail_restore=False
 def prepare(self,ctx):self.calls.append('prepare');return {'work':'payload-'+'1'*16,'payloadManifestSha256':'f'*64}
 def backup(self,prepared):self.calls.append('backup');return {'success':True,'snapshotId':SNAPSHOT,'checkedAt':job.now()}
 def validate(self,prepared):self.calls.append('validate')
 def restore(self,prepared):
  self.calls.append('restore')
  if self.fail_restore:raise RuntimeError('fixture failure')
  return {'success':True,'snapshotId':SNAPSHOT,'checkedAt':job.now(),'payloadManifestSha256':prepared['payloadManifestSha256'],'independentExternalCopyVerified':True}

class ScheduleTests(unittest.TestCase):
 def config(self):return {'format':'melodiajest-s3-schedule-v1','enabled':True,'tooling':'/opt/melodiajest/ops/tooling/s3-'+'1'*16,'files':{name:SHA for name in job.SCHEDULE_TOOL_FILES},'developmentArchiveSha256':SHA,'developmentWebManifestSha256':'d'*64,'passwordCopySha256':SHA}
 def snapshot(self):return {'id':'1'*32,'checkedAt':job.now(),'controls':{'sha256':SHA,'bytes':100},'entries':{'current':{'manifestSha256':'d'*64,'web':{'sha256':'1'*64,'bytes':10},'sources':{'sha256':'2'*64,'bytes':20}},'previous':{'manifestSha256':'e'*64,'web':{'sha256':'3'*64,'bytes':10},'sources':{'sha256':'4'*64,'bytes':20}}}}
 def controls(self):return artifact_json({'format':'melodiajest-s3-controls-v1','files':{name:{**artifact.descriptor(name.encode()),'data':base64.b64encode(name.encode()).decode()} for name in job.SCHEDULE_CONTROL_NAMES}})
 def test_exactly_three_post_hooks_preserve_the_existing_timers_and_sandbox(self):
  values=schedule.render_dropins(self.config()['tooling']);self.assertEqual(len(values),3)
  for name,body in values.items():
   self.assertTrue(name.endswith('.service.d/20-external-s3.conf'));self.assertNotIn('.timer',name);self.assertEqual(body.count('ExecStartPost='),1)
   for forbidden in ['ExecStart=','PrivateNetwork=','RestrictAddressFamilies=','ReadWritePaths=','-ExecStartPost','/opt/libre']:self.assertNotIn(forbidden,body)
 def test_foreign_paths_shell_fragments_and_mutable_tooling_are_rejected(self):
  for name in ['/opt/libre/ops/tooling/s3-'+'1'*16,'/opt/melodiajest/current','/opt/melodiajest/ops/tooling/s3-'+'1'*16+';echo bad']:
   with self.assertRaises(ValueError):schedule.render_dropins(name)
 def test_schedule_configuration_rejects_extra_credentials_and_missing_source_hash(self):
  self.assertEqual(schedule.validate_configuration(self.config()),self.config())
  for value in [self.config()|{'AWS_SECRET_ACCESS_KEY':'fixture'},self.config()|{'developmentArchiveSha256':'latest'},self.config()|{'enabled':False}]:
   with self.assertRaises(ValueError):schedule.validate_configuration(value)
 def test_nightly_snapshot_id_and_timestamp_do_not_create_a_new_payload(self):
  one=self.snapshot();two=copy.deepcopy(one);two['id']='2'*32;two['checkedAt']='2030-01-01T00:00:00+00:00'
  self.assertEqual(schedule.coverage(one,SHA,'5'*64),schedule.coverage(two,SHA,'5'*64))
 def test_current_previous_source_and_schedule_changes_invalidate_coverage(self):
  original=self.snapshot();baseline=schedule.coverage(original,SHA,'5'*64)
  for role in ['current','previous']:
   changed=copy.deepcopy(original);changed['entries'][role]['sources']['sha256']='6'*64;self.assertNotEqual(baseline,schedule.coverage(changed,SHA,'5'*64))
  self.assertNotEqual(baseline,schedule.coverage(original,'7'*64,'5'*64));self.assertNotEqual(baseline,schedule.coverage(original,SHA,'8'*64))
 def test_new_release_falls_back_to_its_verified_published_sources(self):
  config=self.config();sha,path=schedule.source_choice(self.snapshot(),config);self.assertEqual(sha,SHA);self.assertIn('development-source-',str(path))
  config['developmentWebManifestSha256']='9'*64;sha,path=schedule.source_choice(self.snapshot(),config);self.assertEqual(sha,'2'*64);self.assertEqual(path.parent,schedule.OPS/'server-backups/blobs')
 def test_changed_payload_is_not_accepted_until_its_exact_cold_restore_passes(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory).resolve();backend=FakeBackend();backend.fail_restore=True
   with self.assertRaises(RuntimeError):schedule.backup_cycle(state,CTX,backend)
   self.assertFalse((state/'last-success.json').exists());self.assertTrue((state/'last-backup-success.json').exists());self.assertEqual(job.read(state/'last-restore-attempt.json')['status'],'failed')
   backend.fail_restore=False;result=schedule.backup_cycle(state,CTX,backend);self.assertTrue(result['success']);self.assertEqual(backend.calls.count('prepare'),1);self.assertEqual(backend.calls.count('backup'),1);self.assertEqual(backend.calls.count('restore'),2)
 def test_unchanged_payload_reuses_the_verified_snapshot_without_s3(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory).resolve();backend=FakeBackend();one=schedule.backup_cycle(state,CTX,backend);two=schedule.backup_cycle(state,CTX,backend)
   self.assertEqual(two['snapshotId'],one['snapshotId']);self.assertEqual(two['backupCreatedAt'],one['backupCreatedAt']);self.assertEqual(two['s3RequestsThisCheck'],0);self.assertEqual(backend.calls,['prepare','backup','restore','validate'])
 def test_weekly_restore_failure_is_retried_without_a_new_backup_or_hidden_by_skip(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory).resolve();backend=FakeBackend();schedule.backup_cycle(state,CTX,backend);backend.fail_restore=True
   with self.assertRaises(RuntimeError):schedule.restore_cycle(state,CTX,backend)
   backend.fail_restore=False;schedule.backup_cycle(state,CTX,backend);self.assertEqual(backend.calls.count('backup'),1);self.assertEqual(backend.calls.count('restore'),3);self.assertEqual(job.read(state/'last-restore-attempt.json')['status'],'success')
 def test_weekly_restore_reads_the_exact_existing_snapshot_and_never_initializes(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory).resolve();backend=FakeBackend();schedule.backup_cycle(state,CTX,backend);result=schedule.restore_cycle(state,CTX,backend)
   self.assertEqual(result['snapshotId'],SNAPSHOT);self.assertEqual(backend.calls,['prepare','backup','restore','restore'])
 def health(self,now=None):
  now=now or datetime.datetime.now(datetime.timezone.utc);stamp=now.isoformat();last={'success':True,'checkedAt':stamp,'coverage':CTX['coverage'],'snapshotId':SNAPSHOT,'backupCreatedAt':stamp,'prepared':{'payloadManifestSha256':'f'*64},'independentExternalCopyVerified':True};restored={'success':True,'checkedAt':stamp,'snapshotId':SNAPSHOT,'payloadManifestSha256':'f'*64,'independentExternalCopyVerified':True};return [CTX,{'status':'success'},last,copy.deepcopy(last),restored,now,{'status':'success'},{'status':'success'}]
 def test_freshness_distinguishes_last_attempts_current_coverage_and_old_success(self):
  args=self.health();self.assertTrue(schedule.assess_health(*args)['success'])
  for index in [1,6,7]:
   changed=copy.deepcopy(args);changed[index]['status']='failed';self.assertFalse(schedule.assess_health(*changed)['success'])
  args[2]['coverage']='f'*64;self.assertFalse(schedule.assess_health(*args)['success'])
 def test_stale_future_missing_or_different_snapshot_proof_cannot_be_green(self):
  for change in ['stale','future','missing','snapshot','payload']:
   args=self.health()
   if change=='stale':args[4]['checkedAt']=(args[5]-datetime.timedelta(days=9)).isoformat()
   elif change=='future':args[3]['checkedAt']=(args[5]+datetime.timedelta(hours=1)).isoformat()
   elif change=='missing':args[4]=None
   elif change=='snapshot':args[4]['snapshotId']='0'*64
   else:args[4]['payloadManifestSha256']='0'*64
   self.assertFalse(schedule.assess_health(*args)['success'])
 def test_an_unchanged_local_check_does_not_refresh_the_remote_restore_age(self):
  args=self.health();args[4]['checkedAt']=(args[5]-datetime.timedelta(days=7)).isoformat();result=schedule.assess_health(*args);self.assertTrue(result['success']);self.assertEqual(result['agesSeconds']['externalRestore'],7*86400)
  args[3]['checkedAt']=(args[5]-datetime.timedelta(hours=31)).isoformat();self.assertFalse(schedule.assess_health(*args)['success'])
 def test_schedule_control_checksums_and_secret_path_allowlist_are_enforced(self):
  raw=self.controls();self.assertEqual(job.schedule_controls(raw),20)
  meta=json.loads(raw);first=next(iter(meta['files']));meta['files'][first]['data']=base64.b64encode(b'changed').decode()
  with self.assertRaises(ValueError):job.schedule_controls(artifact_json(meta))
  meta=json.loads(raw);meta['files']['config/.env.backup']=meta['files'].pop(first)
  with self.assertRaises(ValueError):job.schedule_controls(artifact_json(meta))
 @unittest.skipUnless(os.name=='posix','Root-private file restoration is verified on the Linux fixture')
 def test_schedule_controls_are_written_and_read_in_a_new_isolated_directory(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory).resolve()/'restored';self.assertEqual(job.schedule_controls(self.controls(),path),20);self.assertEqual((path/'config/s3-schedule.json').read_bytes(),b'config/s3-schedule.json')
   with self.assertRaises(ValueError):job.schedule_controls(self.controls(),path)

def artifact_json(value):return json.dumps(value,sort_keys=True).encode()
if __name__=='__main__':unittest.main()
