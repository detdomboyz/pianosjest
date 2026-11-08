"""Render review-only append proposals for the existing MelodiaJest S3 prefix.

No S3 client, credentials, network calls, policy installation or key creation.
An existing policy and its expected exact SHA are required for a merge proposal.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import uuid

BUCKET = 'libreta-backups-a7f39c'
PREFIX = 'melodiajest/backups/v1'
ENDPOINT = 'https://s3.ru-3.storage.selcloud.ru'
REGION = 'ru-3'
MAX_POLICY_BYTES = 20000  # Conservative bound below Selectel's documented 20 KB.
PLACEHOLDER = '<MELODIAJEST_SERVICE_USER_ID>'


def require(ok, message):
    if not ok:
        raise ValueError('MelodiaJest S3 proposal: ' + message)


def principal_id(value):
    require(isinstance(value, str) and re.fullmatch(r'(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})', value), 'service-user ID required, not a key or wildcard')
    parsed = uuid.UUID(value)
    require(parsed.int != 0, 'nil service-user ID')
    return parsed.hex


def statements(principal):
    principal = principal_id(principal)
    bucket = 'arn:aws:s3:::' + BUCKET
    objects = bucket + '/' + PREFIX + '/'
    who = {'AWS': [principal]}
    tls = {'Bool': {'aws:SecureTransport': 'true'}}
    def rule(sid, actions, resources, condition=None):
        return {'Sid': sid, 'Effect': 'Allow', 'Principal': copy.deepcopy(who), 'Action': actions,
                'Resource': resources, 'Condition': copy.deepcopy(condition or tls)}
    return [
        rule('MelodiaJestBackupLocationV1', ['s3:GetBucketLocation'], [bucket]),
        rule('MelodiaJestBackupListV1', ['s3:ListBucket'], [bucket],
             {**tls, 'StringLike': {'s3:prefix': [PREFIX, PREFIX + '/*']}}),
        rule('MelodiaJestBackupObjectsV1', ['s3:GetObject', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'], [objects + '*']),
        rule('MelodiaJestBackupLocksV1', ['s3:DeleteObject'], [objects + 'locks/*'])
    ]


def template():
    rules = statements('11111111111111111111111111111111')
    for rule in rules:
        rule['Principal']['AWS'] = [PLACEHOLDER]
    return {'format': 'melodiajest-s3-access-review-v1', 'readyForApply': False,
            'endpoint': ENDPOINT, 'region': REGION, 'bucket': BUCKET, 'prefix': PREFIX,
            'requiredServiceRole': 's3.bucket.user', 'appendRulesTemplate': rules,
            'requiredBeforeApply': ['real dedicated service-user ID and server key',
                                    'owner-readable existing bucket policy and expected SHA',
                                    'owner approval preserving current callers and rules',
                                    'private bucket/access verification',
                                    'encrypted worker and independent password copy'],
            'notImplemented': ['cloud changes', 'key creation', 'external backup', 'retention/prune']}


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON policy key')
        result[key] = value
    return result


def proposal(base_bytes, expected_sha256, principal):
    require(type(base_bytes) is bytes and 0 < len(base_bytes) <= MAX_POLICY_BYTES, 'existing policy byte limit')
    require(isinstance(expected_sha256, str) and re.fullmatch(r'[a-f0-9]{64}', expected_sha256), 'expected base policy SHA256 required')
    require(hashlib.sha256(base_bytes).hexdigest() == expected_sha256, 'base policy changed')
    principal = principal_id(principal)
    def invalid_constant(_):
        raise ValueError('Non-JSON policy number')
    base = json.loads(base_bytes.decode('utf-8'), object_pairs_hook=_pairs, parse_constant=invalid_constant)
    require(isinstance(base, dict) and base.get('Version') == '2012-10-17' and isinstance(base.get('Statement'), list), 'existing policy required; no first-policy creation')
    require(all(isinstance(s, dict) for s in base['Statement']), 'invalid existing statements')
    rules = statements(principal)
    sids = {s['Sid'] for s in rules}
    require(not any(s.get('Sid') in sids for s in base['Statement']), 'own SID already exists; inspect instead of overwriting')
    merged = copy.deepcopy(base)
    merged['Statement'].extend(rules)
    encoded = (json.dumps(merged, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
    require(len(encoded) <= MAX_POLICY_BYTES, 'merged policy byte limit')
    return {'format': 'melodiajest-s3-access-review-v1', 'readyForApply': False,
            'expectedBasePolicySha256': expected_sha256, 'baseStatementsPreserved': len(base['Statement']),
            'appendRules': rules, 'proposedPolicy': merged,
            'proposedPolicySha256': hashlib.sha256(encoded).hexdigest(), 'proposedPolicyBytes': len(encoded),
            'requiresOwnerReview': True,
            'limits': 'Role permissions and existing Deny statements still apply. This function does not simulate effective access or write a policy.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--template', action='store_true')
    parser.add_argument('--principal')
    parser.add_argument('--base-policy', type=Path)
    parser.add_argument('--expected-base-sha256')
    args = parser.parse_args()
    if args.template:
        require(not any([args.principal, args.base_policy, args.expected_base_sha256]), 'template cannot be mixed with a merge')
        result = template()
    else:
        require(args.base_policy is not None, 'owner-readable existing policy required')
        require(args.base_policy.is_file() and not args.base_policy.is_symlink(), 'regular existing policy file required')
        require(args.base_policy.stat().st_size <= MAX_POLICY_BYTES, 'existing policy byte limit')
        result = proposal(args.base_policy.read_bytes(), args.expected_base_sha256, args.principal)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
