"""Own systemd units only. Rendering does not install or start anything."""
import re

JOBS = {'backup': 'snapshot', 'restore-check': 'restore-check', 'backup-health': 'health'}
CALENDARS = {'backup': '*-*-* 01:35:00 UTC', 'restore-check': 'Sun *-*-* 04:15:00 UTC', 'backup-health': 'hourly'}


def render(tooling):
    if not re.fullmatch(r'/opt/melodiajest/ops/tooling/backup-[0-9a-f]{16}', str(tooling)):
        raise ValueError('Expected immutable own backup tool directory')
    result = {}
    for name, command in JOBS.items():
        unit = 'melodiajest-' + name
        retry = '' if command == 'health' else 'Restart=on-failure\nRestartSec=15min\n'
        result[unit + '.service'] = f'''[Unit]
Description=MelodiaJest {name}
After=local-fs.target docker.service
StartLimitIntervalSec=2h
StartLimitBurst=8

[Service]
Type=oneshot
ExecStart=/usr/bin/python3 -B {tooling}/release_backup.py {command}
WorkingDirectory=/opt/melodiajest
Environment=PYTHONDONTWRITEBYTECODE=1 DOCKER_HOST=unix:///var/run/docker.sock DOCKER_CONFIG=/opt/melodiajest/ops/docker-client
UMask=0077
TimeoutStartSec=10min
Nice=10
CPUWeight=10
IOWeight=10
MemoryMax=256M
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
ReadWritePaths=/opt/melodiajest/ops /run/lock/libre-deploy.lock
{retry}'''
        result[unit + '.timer'] = f'''[Unit]
Description=Schedule MelodiaJest {name}

[Timer]
OnCalendar={CALENDARS[name]}
RandomizedDelaySec={'2min' if command == 'health' else '10min'}
Persistent=true
Unit={unit}.service

[Install]
WantedBy=timers.target
'''
    return result
