import base64,copy,datetime,json,os,sys,tempfile,unittest
from pathlib import Path
from contextlib import nullcontext
from unittest.mock import patch
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

class AccountHealthTests(unittest.TestCase):
 def data(self):
  now=datetime.datetime(2026,11,8,21,tzinfo=datetime.timezone.utc);stamp=now.isoformat();source='1'*64;archive='2'*64
  profile={'kind':'melodiajest-account-profile','version':2,'engine':'postgres','standby':False,'sourceSha256':source,'archiveSha256':archive,'previousArchiveSha256':'3'*64}
  proof={key:True for key in ['postgresImageImported','nodeFromRestoredArchive','pgDependenciesFromRestoredArchive','dataDigestMatched','ddlDenied','wrongPasswordDenied','restoredSessionsRevoked','twoUsersRegistered','privateWriteReadback','forgedOwnerDenied']};proof.update(productionVolumesMounted=False,productionDataUsed=False,network='none',apiHealth='ok',sourceSha256=source)
  last={'kind':'melodiajest-postgres-protection','version':2,'status':'verified','standby':False,'sourceSha256':source,'snapshot':'4'*64,'fingerprint':'5'*64,'dataDigest':'6'*64,'checkedAt':stamp,'dataComparedAt':stamp,'restoredAt':stamp,'restore':proof}
  backend={'kind':'melodiajest-account-source','dataSchemaVersion':2,'sourceSha256':source}
  files={name:{'bytes':10,'sha256':archive} for name in ['release.tar.gz','node.tar.xz','pg-dependencies.tar.gz','postgres-image.tar.gz','data/postgres.dump','data/snapshot.json','profile.json']}
  payload={'kind':'melodiajest-postgres-payload','version':2,'standby':False,'sourceSha256':source,'archiveSha256':archive,'previousArchiveSha256':'3'*64,'fingerprint':last['fingerprint'],'dataDigest':last['dataDigest'],'files':files}
  return [profile,copy.deepcopy(last),last,backend,payload,now]
 def test_current_proof_is_read_without_s3_or_a_new_restore_timestamp(self):
  args=self.data();args[2]['restoredAt']=(args[5]-datetime.timedelta(days=6)).isoformat();result=schedule.assess_account_health(*args)
  self.assertTrue(result['success']);self.assertEqual(result['agesSeconds']['independentRestore'],6*86400);self.assertEqual(result['restoreVerifiedAt'],args[2]['restoredAt']);self.assertEqual(result['s3RequestsThisCheck'],0);self.assertFalse(result['restorePerformedThisCheck'])
 def test_failed_or_abandoned_latest_attempt_is_not_hidden_by_last_success(self):
  for status in ['failed','started','copy-created-restore-pending']:
   args=self.data();args[1]['status']=status;self.assertFalse(schedule.assess_account_health(*args)['success'])
 def test_data_comparison_and_restore_have_independent_freshness_limits(self):
  for index,field,age in [(1,'checkedAt',datetime.timedelta(hours=31)),(2,'dataComparedAt',datetime.timedelta(hours=31)),(2,'restoredAt',datetime.timedelta(days=8))]:
   args=self.data();args[index][field]=(args[5]-age).isoformat();self.assertFalse(schedule.assess_account_health(*args)['success'])
  args=self.data();args[1]['checkedAt']=args[2]['dataComparedAt']=(args[5]-datetime.timedelta(hours=30)).isoformat();args[2]['restoredAt']=(args[5]-datetime.timedelta(days=7)).isoformat();self.assertTrue(schedule.assess_account_health(*args)['success'])
 def test_missing_ambiguous_and_future_account_receipts_cannot_be_green(self):
  for value in [None,'invalid','2026-11-08T21:00:00','2026-11-09T21:00:00+00:00']:
   args=self.data();args[2]['restoredAt']=value;self.assertFalse(schedule.assess_account_health(*args)['success'])
  args=self.data();args[1]=None;self.assertFalse(schedule.assess_account_health(*args)['success'])
 def test_snapshot_source_archive_and_digest_must_match_the_active_reader(self):
  for index,field in [(1,'snapshot'),(1,'fingerprint'),(1,'dataDigest'),(3,'sourceSha256'),(4,'sourceSha256'),(4,'archiveSha256'),(4,'previousArchiveSha256'),(4,'dataDigest')]:
   args=self.data();args[index][field]='9'*64;self.assertFalse(schedule.assess_account_health(*args)['success'])
 def test_standby_partial_recovery_or_production_mounts_do_not_count(self):
  for change in ['standby','image','ddl','volume','network','dump']:
   args=self.data()
   if change=='standby':args[2]['standby']=True
   elif change=='image':args[2]['restore']['postgresImageImported']=False
   elif change=='ddl':args[2]['restore'].pop('ddlDenied')
   elif change=='volume':args[2]['restore']['productionVolumesMounted']=True
   elif change=='network':args[2]['restore']['network']='bridge'
   else:args[4]['files'].pop('data/postgres.dump')
   self.assertFalse(schedule.assess_account_health(*args)['success'])
 def test_a_missing_profile_cannot_hide_an_installed_account_service(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory).resolve();self.assertFalse(schedule.account_health(base)['required'])
   (base/'account-service/current').mkdir(parents=True);result=schedule.account_health(base);self.assertTrue(result['required']);self.assertFalse(result['success'])
 @unittest.skipUnless(os.name=='posix','Real POSIX pointer and linked-receipt guard')
 def test_real_files_accept_only_own_retained_payload_and_unlinked_receipts(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory).resolve();args=self.data();profile,attempt,last,backend,payload,now=args;home=base/'ops/account-postgres-backups';retained=home/('verified-'+'7'*32);reader=base/('account-service/releases/23.5.64-'+'8'*16);retained.mkdir(parents=True);reader.mkdir(parents=True);(base/'account-service/current').symlink_to(reader.relative_to(base/'account-service'),target_is_directory=True);last['localPayload']=str(retained)
   def save(path,value):path.write_text(json.dumps(value))
   save(base/'ops/account-profile.json',profile);save(home/'latest-attempt.json',attempt);save(home/'latest-success.json',last);save(reader/'backend.json',backend);save(retained/'account-payload.json',payload)
   self.assertTrue(schedule.account_health(base,now)['success'])
   outside=base/'outside.json';save(outside,payload);last['localPayload']=str(base/'outside');save(home/'latest-success.json',last);self.assertFalse(schedule.account_health(base,now)['success'])
   last['localPayload']=str(retained);save(home/'latest-success.json',last);(retained/'account-payload.json').unlink();(retained/'account-payload.json').symlink_to(outside);self.assertFalse(schedule.account_health(base,now)['success'])
 def test_existing_hourly_health_persists_account_failure_and_nonzero_status(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory).resolve();backend=FakeBackend();schedule.backup_cycle(state,CTX,backend);account={'required':True,'success':False,'problems':['last-attempt-not-verified'],'s3RequestsThisCheck':0,'restorePerformedThisCheck':False}
   with patch.object(schedule,'STATE',state),patch.object(schedule,'configuration',return_value={}),patch.object(schedule,'context',return_value=CTX),patch.object(schedule.job,'private_directory',return_value=state),patch.object(schedule.backup,'worker_lock',return_value=nullcontext()),patch.object(schedule,'account_health',return_value=account):
    result=schedule.execute('health')
   self.assertFalse(result['success']);self.assertIn('account-last-attempt-not-verified',result['problems']);self.assertFalse(result['independentExternalCopyVerified']);self.assertEqual(job.read(state/'health.json')['accountBackup'],account);self.assertEqual(backend.calls,['prepare','backup','restore'])


class BaseAccountDispatchTests(unittest.TestCase):
 def save(self,path,value):
  path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))
 def legacy(self,base,now):
  self.save(base/'ops/account-profile.json',{'kind':'melodiajest-account-profile','version':1,'sourceSha256':'1'*64})
  value={'status':'verified','checkedAt':now.isoformat(),'dataDigest':'6'*64,'sourceSha256':'1'*64,'restore':{'verifiedAt':now.isoformat(),'restoredRuntimeExecuted':True}}
  for name in ['latest-attempt.json','latest-success.json']:self.save(base/'ops/account-backups'/name,value)
 def postgres(self,base):
  profile,attempt,last,backend,payload,now=AccountHealthTests().data();home=base/'ops/account-postgres-backups';retained=home/('verified-'+'7'*32);reader=base/('account-service/releases/23.5.65-'+'8'*16)
  last['localPayload']=str(retained)
  for path,value in [(base/'ops/account-profile.json',profile),(home/'latest-attempt.json',attempt),(home/'latest-success.json',last),(reader/'backend.json',backend),(retained/'account-payload.json',payload)]:self.save(path,value)
  (base/'account-service/current').symlink_to(reader.relative_to(base/'account-service'),target_is_directory=True)
  return now
 def freshness(self,base,now,cli=False):
  backup=schedule.backup;home=base/'ops/server-backups';sha='d'*64
  self.save(home/'last-backup-success.json',{'success':True,'checkedAt':now.isoformat(),'currentManifestSha256':sha})
  self.save(home/'last-restore-success.json',{'success':True,'checkedAt':now.isoformat(),'entries':{'current':{'manifestSha256':sha}}})
  # Directory fsync is POSIX-only; the same writes execute unpatched on Linux.
  sync=nullcontext() if os.name=='posix' else patch.object(backup.update,'sync_directory')
  with sync,patch.object(backup,'layout',return_value=home),patch.object(backup,'load_snapshot',return_value={'entries':{}}),patch.object(backup.update,'current_sha',return_value=sha),patch.object(backup.update,'ref',return_value=None):
   if cli:
    with patch.object(backup.update,'PRODUCTION',base),patch.object(sys,'argv',['release_backup.py','health']):return backup.main()
   return backup.freshness(base,now)
 def test_base_and_hourly_use_one_postgres_assessor(self):
  self.assertIs(schedule.assess_account_health,schedule.backup.assess_account_health)
 @unittest.skipUnless(os.name=='posix','Real account reader symlink')
 def test_pg_base_accepts_missing_or_stale_sqlite_without_touching_it(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory).resolve();now=self.postgres(base)
   result=self.freshness(base,now);self.assertTrue(result['success'],result);self.assertEqual(result['accounts']['engine'],'postgres')
   legacy=base/'ops/account-backups/latest-success.json';legacy.parent.mkdir();legacy.write_text('{old invalid SQLite receipt');before=(legacy.read_bytes(),legacy.stat().st_mtime_ns)
   result=self.freshness(base,now);self.assertTrue(result['success'],result);self.assertEqual(before,(legacy.read_bytes(),legacy.stat().st_mtime_ns));self.assertEqual(result['accounts'],{'configured':True,'browserProgressCovered':False,**schedule.account_health(base,now)})
 @unittest.skipUnless(os.name=='posix','Real account reader symlink')
 def test_pg_failure_staleness_and_wrong_source_cannot_use_healthy_sqlite(self):
  for change in ['failed','comparison','restore','source','reader']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as directory:
    base=Path(directory).resolve();now=self.postgres(base);profile=(base/'ops/account-profile.json').read_bytes();self.legacy(base,now);(base/'ops/account-profile.json').write_bytes(profile)
    path=base/'ops/account-postgres-backups'/('latest-attempt.json' if change=='failed' else 'latest-success.json');value=json.loads(path.read_text())
    if change=='failed':value['status']='failed'
    elif change=='comparison':value['dataComparedAt']=(now-datetime.timedelta(hours=31)).isoformat()
    elif change=='restore':value['restoredAt']=(now-datetime.timedelta(days=8)).isoformat()
    elif change=='source':value['sourceSha256']='9'*64
    else:path=base/'account-service/current/backend.json';value=json.loads(path.read_text());value['dataSchemaVersion']=1
    self.save(path,value);result=self.freshness(base,now);self.assertFalse(result['success'],result);self.assertTrue(any(x.startswith('account-') for x in result['problems']))
 @unittest.skipUnless(os.name=='posix','Real account reader symlink and native CLI')
 def test_pg_invalid_receipt_is_persisted_as_failure_and_cli_exits_nonzero(self):
  for change in ['missing','oversize','linked','malformed']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as directory:
    base=Path(directory).resolve();now=self.postgres(base);path=base/'ops/account-postgres-backups/latest-attempt.json'
    if change=='missing':path.unlink()
    elif change=='oversize':path.write_text(' '*262145)
    elif change=='linked':path.unlink();path.symlink_to(base/'ops/account-postgres-backups/latest-success.json')
    else:path.write_text('[]')
    result=self.freshness(base,now);self.assertFalse(result['success']);self.assertEqual(result['accounts']['problems'],['receipt-missing-or-invalid']);self.assertEqual(json.loads((base/'ops/server-backups/health.json').read_text()),result)
    self.assertEqual(self.freshness(base,now,cli=True),1)
 def test_unknown_malformed_or_missing_profile_is_not_treated_as_unconfigured(self):
  for profile in [None,[],{'kind':'other','version':1},{'kind':'melodiajest-account-profile','version':3},{'kind':'melodiajest-account-profile','version':2,'engine':'sqlite'}]:
   with self.subTest(profile=profile),tempfile.TemporaryDirectory() as directory:
    base=Path(directory).resolve();(base/'account-service/current').mkdir(parents=True)
    if profile is not None:self.save(base/'ops/account-profile.json',profile)
    result=self.freshness(base,datetime.datetime.now(datetime.timezone.utc));self.assertFalse(result['success']);self.assertTrue(result['accounts']['configured'])
 def test_legacy_sqlite_freshness_remains_supported(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory).resolve();now=datetime.datetime.now(datetime.timezone.utc);self.legacy(base,now);result=self.freshness(base,now)
   self.assertTrue(result['success'],result);self.assertEqual(result['accounts']['engine'],'sqlite');self.assertTrue(result['accounts']['independentReadAndRestore'])
 def test_legacy_sqlite_failure_expiry_and_ambiguous_time_still_fail(self):
  for change in ['failed','attempt-expired','restore-expired','ambiguous']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as directory:
    base=Path(directory).resolve();now=datetime.datetime.now(datetime.timezone.utc);self.legacy(base,now);path=base/'ops/account-backups'/('latest-attempt.json' if change=='attempt-expired' else 'latest-success.json');value=json.loads(path.read_text())
    if change=='failed':value['status']='failed'
    elif change=='attempt-expired':value['checkedAt']=(now-datetime.timedelta(hours=31)).isoformat()
    elif change=='restore-expired':value['restore']['verifiedAt']=(now-datetime.timedelta(days=9)).isoformat()
    else:value['checkedAt']='2026-11-08T21:00:00'
    self.save(path,value);self.assertFalse(self.freshness(base,now)['success'])
 def test_pg_installation_marker_prevents_legacy_fallback(self):
  with tempfile.TemporaryDirectory() as directory:
   base=Path(directory).resolve();now=datetime.datetime.now(datetime.timezone.utc);self.legacy(base,now);self.save(base/'account-data/postgres.json',{})
   self.assertFalse(self.freshness(base,now)['success'])


def artifact_json(value):return json.dumps(value,sort_keys=True).encode()
if __name__=='__main__':unittest.main()
