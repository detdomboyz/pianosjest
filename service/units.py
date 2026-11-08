"""Own account units. Pure rendering; never writes /etc or changes a service."""
import re

USER = 'melodiajest-account'
SOCKET = '/run/melodiajest-account/api.sock'
DATA = '/opt/melodiajest/account-data'


def render(node, tooling, *, postgres=False, dependencies=None):
    if not re.fullmatch(r'/opt/melodiajest/runtime/node-v24\.22\.2-[a-f0-9]{12}/node', str(node)):
        raise ValueError('Expected own pinned Node runtime')
    if not re.fullmatch(r'/opt/melodiajest/ops/tooling/account-[a-f0-9]{16}', str(tooling)):
        raise ValueError('Expected immutable own account tooling')
    if postgres and not re.fullmatch(r'/opt/melodiajest/runtime/pg-8\.23\.1-[a-f0-9]{12}/node_modules',str(dependencies)):
        raise ValueError('Expected own pinned PostgreSQL dependencies')
    service = f'''[Unit]
Description=MelodiaJest private account API
After=local-fs.target
StartLimitIntervalSec=2h
StartLimitBurst=6

[Service]
Type=simple
User={USER}
Group={USER}
WorkingDirectory=/opt/melodiajest/account-service/current
EnvironmentFile=/opt/melodiajest/deploy/account.env
Environment=NODE_ENV=production UV_THREADPOOL_SIZE=2 MELODIA_SERVICE_SOCKET={SOCKET}
ExecStartPre={node} --preserve-symlinks --preserve-symlinks-main /opt/melodiajest/account-service/current/service/socket-clean.cjs
ExecStart={node} --preserve-symlinks --preserve-symlinks-main /opt/melodiajest/account-service/current/service/server.cjs
RuntimeDirectory=melodiajest-account
RuntimeDirectoryMode=0755
RuntimeDirectoryPreserve=yes
UMask=0077
Restart=on-failure
RestartSec=10s
TimeoutStopSec=20s
MemoryMax=384M
CPUQuota=40%
TasksMax=48
NoNewPrivileges=yes
PrivateTmp=yes
PrivateNetwork=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
ProtectKernelModules=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX
ReadWritePaths={DATA} /run/melodiajest-account
InaccessiblePaths=-/opt/libre -/opt/diary -/opt/praicer -/opt/grigorova

[Install]
WantedBy=multi-user.target
'''
    backup = f'''[Unit]
Description=MelodiaJest account data copy and isolated recovery
After=local-fs.target docker.service
StartLimitIntervalSec=2h
StartLimitBurst=4

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -B {tooling}/service/account_backup.py run
WorkingDirectory=/opt/melodiajest
Environment=PYTHONDONTWRITEBYTECODE=1 DOCKER_HOST=unix:///var/run/docker.sock DOCKER_CONFIG=/opt/melodiajest/ops/docker-client
UMask=0077
TimeoutStartSec=15min
Restart=on-failure
RestartSec=15min
Nice=10
CPUWeight=10
IOWeight=10
MemoryMax=512M
NoNewPrivileges=yes
PrivateTmp=yes
PrivateNetwork=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX
ReadWritePaths=/opt/melodiajest/ops /opt/melodiajest/account-data /opt/melodiajest/account-backup-work /opt/melodiajest/account-restore-work /run/lock/libre-deploy.lock
'''
    timer = '''[Unit]
Description=Daily MelodiaJest account data protection

[Timer]
OnCalendar=*-*-* 02:10:00 UTC
Persistent=true
RandomizedDelaySec=5min
AccuracySec=1min
Unit=melodiajest-account-backup.service

[Install]
WantedBy=timers.target
'''
    if postgres:
        service=service.replace('After=local-fs.target','After=local-fs.target melodiajest-postgres.service\nRequires=melodiajest-postgres.service').replace('Environment=NODE_ENV=production','Environment=NODE_PATH='+str(dependencies)+'\nEnvironment=NODE_ENV=production')
    return {'melodiajest-account.service':service,'melodiajest-account-backup.service':backup,'melodiajest-account-backup.timer':timer}


def environment(enabled=False, *, postgres=False, maintenance=False):
    return 'MELODIA_SERVICE_ORIGIN=https://melodiajest.ru\nMELODIA_SERVICE_DATA_DIR='+DATA+'\nMELODIA_SERVICE_TRUST_PROXY=1\nMELODIA_REGISTRATION_ENABLED='+('1' if enabled else '0')+'\n'+('MELODIA_POSTGRES_CONFIG='+DATA+'/postgres.json\n' if postgres else '')+('MELODIA_MAINTENANCE_READ_ONLY=1\n' if maintenance else '')
