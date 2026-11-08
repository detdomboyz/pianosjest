"""Bounded restic runner for MelodiaJest's own encrypted S3 repository.

Credentials are read from the existing protected server backup configuration,
as requested by the user. They are passed through container stdin, never argv,
Docker Config.Env, files in the payload, a browser, or the returned receipt.
No shared policy changes, data deletion, prune, unlock, or timer installation.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import uuid

BASE = '/opt/melodiajest'
CREDENTIAL_FILE = '/opt/libre/deploy/vps/.env.backup'
PASSWORD_FILE = BASE + '/ops/secrets/restic-password'
ENDPOINT = 'https://s3.ru-3.storage.selcloud.ru'
BUCKET = 'libreta-backups-a7f39c'
PREFIX = 'melodiajest/backups/v1'
REPOSITORY = 's3:' + ENDPOINT + '/' + BUCKET + '/' + PREFIX
REGION = 'ru-3'
IMAGE = 'sha256:3ec2edd1174df69efd176ebb3e20c2f73ff32b6a4e4fe7ae7f32b7d94ebb13c1'
BINARY_SHA = '20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'
BINARY = BASE + '/ops/tooling/restic-0.19.1-' + BINARY_SHA[:16] + '/restic'
SHA = re.compile(r'[a-f0-9]{64}')


def require(value, message):
    if not value:
        raise ValueError('MelodiaJest external backup: ' + message)


def configuration():
    return {'format': 'melodiajest-s3-runtime-v2', 'repository': REPOSITORY,
            'credentialSource': CREDENTIAL_FILE, 'passwordFile': PASSWORD_FILE,
            'region': REGION, 'image': IMAGE, 'resticBinary': BINARY,
            'resticBinarySha256': BINARY_SHA, 'resticVersion': '0.19.1',
            'credentialScope': 'existing server backup key; IAM scope not narrowed by this runner'}


def validate_configuration(config):
    require(type(config) is dict, 'configuration object required')
    expected_config = configuration()
    if config.get('format') == 'melodiajest-s3-runtime-v1':
        expected_config.update(format='melodiajest-s3-runtime-v1', scheduledExternalBackup=False)
    for key, expected in expected_config.items():
        require(type(config.get(key)) is type(expected) and config.get(key) == expected, 'unexpected configuration field: ' + key)
    require(set(config) == set(expected_config), 'unknown configuration fields')
    return dict(config)


def filter_credentials(environment, client_environment):
    require(type(environment) is dict and type(client_environment) is dict, 'credential environment required')
    require(environment.get('AWS_DEFAULT_REGION') == REGION, 'wrong backup region')
    require(environment.get('AWS_ACCESS_KEY_ID') != client_environment.get('LIBRE_OBJECT_STORAGE_ACCESS_KEY_ID'), 'application client key forbidden')
    result = {}
    for key in ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']:
        value = environment.get(key)
        if key == 'AWS_SESSION_TOKEN' and not value:
            continue
        require(isinstance(value, str) and 0 < len(value) <= 8192 and not any(x in value for x in ['\n', '\r', '\0']), 'invalid server credential')
        result[key] = value
    return result


def resolve_credentials():
    """Resolve only server AWS fields. Do not return Libreta's repo/password."""
    source = Path(CREDENTIAL_FILE)
    require(source.resolve() == source and source.is_file() and not source.is_symlink(), 'credential source link or absence')
    info = source.stat()
    require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) & 0o077 == 0 and info.st_size <= 65536, 'credential source must be root-private')
    result = subprocess.run(['docker', 'compose', '-f', '/opt/libre/deploy/vps/compose.yaml', '--profile', 'tools', 'config', '--format', 'json'], cwd='/opt/libre/deploy/vps', text=True, capture_output=True, timeout=30)
    require(result.returncode == 0, 'cannot resolve protected backup configuration')
    environment = json.loads(result.stdout)['services']['backup']['environment']
    app = json.loads(subprocess.check_output(['docker', 'inspect', 'libre-app-1'], text=True))[0]
    client = dict(value.split('=', 1) for value in app['Config']['Env'] if '=' in value)
    return filter_credentials(environment, client)


def own_path(value):
    require(isinstance(value, str), 'own path required')
    p = PurePosixPath(value)
    require(p.is_absolute() and str(p) == value and '..' not in p.parts and ',' not in value, 'non-canonical own path')
    require(str(p).startswith(BASE + '/ops/external-work/'), 'path outside own external-work')
    require(len(p.parts) >= 6, 'dedicated child path required')
    return str(p)


def restic_arguments(operation, *, snapshot=None, kit_sha=None, checkout_sha=None):
    common = ['/melodiajest-restic', '--repo', REPOSITORY, '--cache-dir', '/cache', '--json', '--retry-lock', '0s', '-o', 's3.bucket-lookup=path']
    if operation == 'init':
        require(not any([snapshot, kit_sha, checkout_sha]), 'unexpected init arguments')
        args = ['init', '--repository-version', '2']
    elif operation == 'backup':
        require(SHA.fullmatch(kit_sha or '') and SHA.fullmatch(checkout_sha or '') and snapshot is None, 'exact input hashes required')
        args = ['backup', '--host', 'melodiajest', '--tag', 'kit-' + kit_sha, '--tag', 'checkout-' + checkout_sha, '/payload']
    elif operation == 'restore':
        require(SHA.fullmatch(snapshot or '') and not any([kit_sha, checkout_sha]), 'exact full snapshot ID required')
        args = ['restore', snapshot, '--target', '/restored', '--verify']
    elif operation == 'check':
        require(not any([snapshot, kit_sha, checkout_sha]), 'unexpected check arguments')
        args = ['check', '--read-data']
    else:
        raise ValueError('MelodiaJest external backup: unsupported operation')
    return common + args


WRAPPER = r'''
import json,os,resource,subprocess,sys,time
p=json.loads(sys.stdin.buffer.read(65537));assert set(p)=={'credentials','password','args'}
assert set(p['credentials']).issubset({'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'})
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','TMPDIR':'/tmp','AWS_DEFAULT_REGION':'ru-3',**p['credentials'],'RESTIC_PASSWORD':p['password']}
start=time.monotonic();r=subprocess.run(p['args'],env=env,capture_output=True,text=True,timeout=240)
usage=resource.getrusage(resource.RUSAGE_CHILDREN)
safe=[]
allowed={'message_type','snapshot_id','id','repository_version','files_new','files_changed','files_unmodified','total_files_processed','total_bytes_processed','data_added','data_added_packed','total_duration','files_restored','bytes_restored','total_files','total_bytes'}
for line in r.stdout.splitlines():
 try:
  value=json.loads(line)
  if isinstance(value,dict):safe.append({k:v for k,v in value.items() if k in allowed and isinstance(v,(str,int,float,bool))})
 except (ValueError,TypeError):pass
error=None
if r.returncode:
 error='access-denied' if 'AccessDenied' in r.stderr or 'Access Denied' in r.stderr else 'password-rejected' if 'password' in r.stderr.lower() else 'restic-command-failed'
out={'exitCode':r.returncode,'elapsedSeconds':round(time.monotonic()-start,3),'cpuUserSeconds':round(usage.ru_utime,3),'cpuSystemSeconds':round(usage.ru_stime,3),'peakChildRssKiB':usage.ru_maxrss,'result':safe,'error':error}
sys.stdout.write(json.dumps(out))
'''


def command_plan(config, operation, *, cache, source=None, destination=None, snapshot=None, kit_sha=None, checkout_sha=None, nonce=None):
    validate_configuration(config)
    cache = own_path(cache)
    token = nonce or uuid.uuid4().hex
    require(re.fullmatch(r'[a-f0-9]{32}', token or ''), 'invalid operation nonce')
    require((source is not None) == (operation == 'backup'), 'source mounted only for backup')
    require((destination is not None) == (operation == 'restore'), 'restore destination required only for restore')
    arguments = restic_arguments(operation, snapshot=snapshot, kit_sha=kit_sha, checkout_sha=checkout_sha)
    name = 'melodiajest-s3-' + operation + '-' + token[:12]
    command = ['docker', 'run', '--rm', '-i', '--pull', 'never', '--name', name,
               '--label', 'com.melodiajest.role=external-s3', '--label', 'com.melodiajest.s3-operation=' + token,
               '--hostname', 'melodiajest-backup', '--network', 'bridge', '--read-only', '--user', '0:0',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '768m', '--cpus', '0.5', '--pids-limit', '64',
               '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,mode=1777',
               '--mount', 'type=bind,src=' + BINARY + ',dst=/melodiajest-restic,readonly',
               '--mount', 'type=bind,src=' + cache + ',dst=/cache']
    if source is not None:
        command += ['--mount', 'type=bind,src=' + own_path(source) + ',dst=/payload,readonly']
    if destination is not None:
        command += ['--mount', 'type=bind,src=' + own_path(destination) + ',dst=/restored']
    command += ['--entrypoint', 'python3', IMAGE, '-c', WRAPPER]
    return {'command': command, 'arguments': arguments, 'name': name, 'token': token,
            'mountedPaths': [cache] + ([source] if source else []) + ([destination] if destination else [])}


def password_value(value):
    require(type(value) is bytes and 43 <= len(value) <= 256 and re.fullmatch(rb'[A-Za-z0-9_-]+', value), 'generated repository password required')
    return value.decode('ascii')


def run(config, operation, credentials, password, **kwargs):
    """Caller holds the actual shared/own locks; no secret is returned."""
    plan = command_plan(config, operation, **kwargs)
    binary = Path(BINARY)
    require(binary.resolve() == binary and binary.is_file() and not binary.is_symlink(), 'runtime link or absence')
    require(hashlib.sha256(binary.read_bytes()).hexdigest() == BINARY_SHA, 'runtime changed')
    for item in plan['mountedPaths']:
        p = Path(item)
        require(p.resolve() == p and p.is_dir() and not p.is_symlink() and p.stat().st_uid == 0 and stat.S_IMODE(p.stat().st_mode) & 0o077 == 0, 'mount must be an own private real directory')
    secret = password_value(password)
    require(set(credentials).issubset({'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'}) and all(credentials.get(k) for k in ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']), 'server AWS fields required')
    try:
        result = subprocess.run(plan['command'], input=json.dumps({'credentials': credentials, 'password': secret, 'args': plan['arguments']}), text=True, capture_output=True, timeout=270)
    except subprocess.TimeoutExpired:
        # Stop only the exact transient container created by this invocation.
        inspected = subprocess.run(['docker', 'inspect', plan['name']], text=True, capture_output=True, timeout=10)
        if inspected.returncode == 0:
            labels = json.loads(inspected.stdout)[0]['Config']['Labels']
            require(labels.get('com.melodiajest.role') == 'external-s3' and labels.get('com.melodiajest.s3-operation') == plan['token'], 'refuse foreign container cleanup')
            subprocess.run(['docker', 'rm', '-f', plan['name']], capture_output=True, check=True, timeout=20)
        raise RuntimeError('MelodiaJest external backup command timed out') from None
    require(result.returncode == 0, 'isolated restic wrapper failed')
    observed = json.loads(result.stdout)
    observed.update(operation=operation, s3HttpRequestCount=None, billingMeasured=False,
                    credentialsInArgv=False, productionInputsMounted=False)
    require(observed['exitCode'] == 0, 'restic ' + operation + ': ' + str(observed.get('error')))
    return observed
