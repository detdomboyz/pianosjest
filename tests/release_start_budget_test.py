import datetime as dt,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'deploy/shared-host'))
import release_start_budget as budget

class StartBudgetTests(unittest.TestCase):
 def setUp(self):self.now=dt.datetime(2026,11,8,23,20,tzinfo=dt.timezone.utc)
 def test_two_planned_copies_wait_until_old_start_and_margin_expire(self):
  starts=['2026-11-08T21:45:00+00:00','2026-11-08T22:56:00+00:00','2026-11-08T23:01:00+00:00'];before=list(starts);r=budget.assess_start_budget(starts,self.now);self.assertFalse(r['allowed']);self.assertEqual(r['notBefore'],'2026-11-08T23:45:10+00:00');self.assertEqual(starts,before);self.assertFalse(r['mutationsPerformed']);self.assertFalse(r['reservation'])
 def test_two_recent_starts_allow_two_more_without_claiming_a_reservation(self):
  r=budget.assess_start_budget(['2026-11-08T22:56:00+00:00','2026-11-08T23:01:00+00:00'],self.now);self.assertTrue(r['allowed']);self.assertFalse(r['systemdCounterRead'])
 def test_boundary_margin_and_duplicate_log_entries_are_deterministic(self):
  starts=['2026-11-08T21:20:00+00:00']*2+['2026-11-08T23:01:00+00:00','2026-11-08T22:56:00+00:00'];self.assertFalse(budget.assess_start_budget(starts,self.now)['allowed']);self.assertTrue(budget.assess_start_budget(starts,self.now+dt.timedelta(seconds=10))['allowed'])
 def test_invalid_policy_or_clock_is_rejected(self):
  for args in [{'burst':True},{'planned_starts':5},{'window_seconds':0},{'margin_seconds':-1}]:
   with self.assertRaises(ValueError):budget.assess_start_budget([],self.now,**args)
  for value in [None,'invalid','2026-11-08T22:00:00','2026-11-09T00:00:00+00:00']:
   with self.assertRaises(ValueError):budget.assess_start_budget([value],self.now)
  with self.assertRaises(ValueError):budget.assess_start_budget([],self.now.replace(tzinfo=None))
 def observation(self,change=None):
  native='StartLimitBurst=4\nStartLimitIntervalUSec=2h\nResult=success\nMainPID=0\nExecMainStartTimestamp=Sun 2026-11-08 23:01:00 UTC\n';row={'MESSAGE':'Starting '+budget.UNIT+' - Protect own data','__REALTIME_TIMESTAMP':str(int(dt.datetime(2026,11,8,23,1,tzinfo=dt.timezone.utc).timestamp()*1000000))};rows=[row]
  if change=='policy':native=native.replace('Burst=4','Burst=5')
  elif change=='active':native=native.replace('MainPID=0','MainPID=7')
  elif change=='failed':native=native.replace('Result=success','Result=exit-code')
  elif change=='missing':rows=[]
  elif change=='truncated':rows=[row]*128
  return [native,'\n'.join(json.dumps(row) for row in rows)]
 def test_collector_reads_only_exact_own_unit_and_bounded_journal(self):
  with patch.object(budget.subprocess,'check_output',side_effect=self.observation()) as calls:r=budget.observe_start_budget(2,self.now)
  self.assertTrue(r['allowed']);self.assertEqual(len(calls.call_args_list),2);self.assertEqual(calls.call_args_list[0].args[0][:3],['systemctl','show',budget.UNIT]);self.assertIn('128',calls.call_args_list[1].args[0]);self.assertFalse(r['mutationsPerformed'])
 def test_changed_policy_active_or_failed_service_is_not_bypassed(self):
  for change in ['policy','active','failed']:
   with self.subTest(change=change),patch.object(budget.subprocess,'check_output',side_effect=self.observation(change)),self.assertRaises(ValueError):budget.observe_start_budget(2,self.now)
 def test_missing_latest_or_truncated_history_is_not_green(self):
  for change in ['missing','truncated']:
   with self.subTest(change=change),patch.object(budget.subprocess,'check_output',side_effect=self.observation(change)),self.assertRaises(ValueError):budget.observe_start_budget(2,self.now)

if __name__=='__main__':unittest.main()
