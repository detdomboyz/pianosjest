import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'deploy/shared-host'))
import backup_s3_access as access

USER = '11111111111111111111111111111111'  # Synthetic, never sent to any service.
BASE = {'Version': '2012-10-17', 'Id': 'old', 'Statement': [
    {'Sid': 'ExistingBackup', 'Effect': 'Allow', 'Principal': {'AWS': ['22222222222222222222222222222222']}, 'Action': ['s3:GetObject'], 'Resource': ['arn:aws:s3:::libreta-backups-a7f39c/database/v1/*']},
    {'Sid': 'ExistingDeny', 'Effect': 'Deny', 'Principal': '*', 'Action': 's3:DeleteBucket', 'Resource': 'arn:aws:s3:::libreta-backups-a7f39c'}]}


class ScopeProposalTest(unittest.TestCase):
    def call(self, policy=BASE):
        raw=json.dumps(policy).encode()
        return access.proposal(raw, hashlib.sha256(raw).hexdigest(), USER)

    def test_template_is_explicitly_not_an_installed_policy(self):
        t=access.template();self.assertFalse(t['readyForApply']);self.assertNotIn('Statement',t)
        self.assertEqual(t['requiredServiceRole'],'s3.bucket.user')
        for r in t['appendRulesTemplate']:self.assertEqual(r['Principal']['AWS'],[access.PLACEHOLDER])

    def test_only_the_fixed_backup_bucket_and_prefix_are_granted(self):
        for r in access.statements(USER):
            self.assertEqual(r['Principal'],{'AWS':[USER]});self.assertEqual(r['Effect'],'Allow')
            self.assertEqual(r['Condition']['Bool'],{'aws:SecureTransport':'true'})
            for resource in r['Resource']:
                self.assertTrue(resource=='arn:aws:s3:::'+access.BUCKET or resource.startswith('arn:aws:s3:::'+access.BUCKET+'/'+access.PREFIX+'/'))

    def test_listing_has_no_empty_prefix_or_sibling_prefix_wildcard(self):
        listing=next(r for r in access.statements(USER) if 's3:ListBucket' in r['Action'])
        self.assertEqual(listing['Condition']['StringLike']['s3:prefix'],[access.PREFIX,access.PREFIX+'/*'])
        self.assertNotIn('*',listing['Resource'][0]);self.assertNotIn('',listing['Condition']['StringLike']['s3:prefix'])

    def test_delete_is_only_for_own_restic_locks_not_data_or_versions(self):
        rules=access.statements(USER);deletes=[r for r in rules if any('Delete' in a for a in r['Action'])]
        self.assertEqual(len(deletes),1);self.assertEqual(deletes[0]['Action'],['s3:DeleteObject'])
        self.assertEqual(deletes[0]['Resource'],['arn:aws:s3:::'+access.BUCKET+'/'+access.PREFIX+'/locks/*'])
        self.assertFalse(any('*' in action or 'Policy' in action or action in ['s3:DeleteBucket','s3:ListAllMyBuckets'] for r in rules for action in r['Action']))

    def test_base_fields_rules_conditions_and_order_are_preserved(self):
        before=copy.deepcopy(BASE);out=self.call();self.assertEqual(BASE,before);self.assertEqual(out['proposedPolicy']['Statement'][:2],BASE['Statement'])
        self.assertEqual(out['proposedPolicy']['Id'],'old');self.assertEqual(out['baseStatementsPreserved'],2);self.assertFalse(out['readyForApply']);self.assertTrue(out['requiresOwnerReview'])

    def test_exact_preimage_hash_and_a_real_base_are_required(self):
        raw=json.dumps(BASE).encode()
        for blob,digest in [(raw,'0'*64),(b'',hashlib.sha256(b'').hexdigest()),(b'{}',hashlib.sha256(b'{}').hexdigest())]:
            with self.assertRaises(ValueError):access.proposal(blob,digest,USER)

    def test_existing_own_sid_never_silently_overwrites_or_duplicates(self):
        base=copy.deepcopy(BASE);base['Statement'].append(access.statements(USER)[0])
        with self.assertRaises(ValueError):self.call(base)

    def test_principals_cannot_be_wildcards_keys_placeholders_or_nil(self):
        for value in ['*',access.PLACEHOLDER,'AWS_ACCESS_KEY_ID','0'*32,None,'user/'+USER]:
            with self.assertRaises(ValueError):access.statements(value)
        self.assertEqual(access.principal_id('11111111-1111-1111-1111-111111111111'),USER)

    def test_duplicate_keys_bad_unicode_non_json_numbers_and_oversize_fail(self):
        for raw in [b'{"Version":"2012-10-17","Version":"2012-10-17","Statement":[]}',b'{"Version":"2012-10-17","Statement":[],"x":NaN}',b'{"Version":"2012-10-17","Statement":[],"x":1e400}',b'\xff',b' '*20001]:
            with self.assertRaises((ValueError,UnicodeError)):access.proposal(raw,hashlib.sha256(raw).hexdigest(),USER)
        base=copy.deepcopy(BASE);base['padding']='x'*(access.MAX_POLICY_BYTES-500)
        with self.assertRaises(ValueError):self.call(base)

    def test_repeat_proposals_are_deterministic_and_do_not_mutate_inputs(self):
        first=self.call();second=self.call();self.assertEqual(first,second)
        raw=(json.dumps(first['proposedPolicy'],ensure_ascii=False,separators=(',',':'))+'\n').encode()
        self.assertEqual(first['proposedPolicySha256'],hashlib.sha256(raw).hexdigest())


if __name__=='__main__':unittest.main()
