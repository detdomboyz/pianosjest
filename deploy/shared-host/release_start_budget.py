"""Read-only planning for the existing account-backup start limit.

This is a conservative journal snapshot, not systemd's internal counter or a
reservation. systemd still enforces its real limit. Never resets/starts a unit,
changes controls, or claims a new backup. Used by the staged release workflow.
"""
import datetime as dt
import json
import subprocess

UNIT = 'melodiajest-account-backup.service'


def stamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing start time')
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError('Ambiguous start time')
    return parsed


def assess_start_budget(starts, now, burst=4, window_seconds=7200, planned_starts=2, margin_seconds=10):
    if not isinstance(now, dt.datetime) or now.tzinfo is None:
        raise ValueError('Aware observation time required')
    if not isinstance(starts, list) or len(starts) > 128:
        raise ValueError('Invalid bounded start history')
    if any(type(value) is not int for value in [burst, window_seconds, planned_starts, margin_seconds]):
        raise ValueError('Integer start policy required')
    if not (1 <= planned_starts <= burst <= 64 and 1 <= window_seconds <= 86400 and 0 <= margin_seconds <= 300):
        raise ValueError('Invalid start policy')
    history = sorted(set(stamp(value) for value in starts))
    if any(value > now + dt.timedelta(seconds=5) for value in history):
        raise ValueError('Future start history')
    window = dt.timedelta(seconds=window_seconds + margin_seconds)
    recent = [value for value in history if value + window > now]
    excess = len(recent) + planned_starts - burst
    retry = recent[excess - 1] + window if excess > 0 else now
    return {'checkedAt':now.isoformat(), 'unit':UNIT, 'allowed':excess <= 0,
            'recentStarts':[value.isoformat() for value in recent], 'plannedStarts':planned_starts,
            'burst':burst, 'windowSeconds':window_seconds, 'marginSeconds':margin_seconds,
            'notBefore':retry.isoformat(), 'conservativeJournalSnapshot':True,
            'reservation':False, 'systemdCounterRead':False, 'mutationsPerformed':False}


def observe_start_budget(planned_starts=2, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    props = ['StartLimitBurst','StartLimitIntervalUSec','Result','MainPID','ExecMainStartTimestamp']
    raw = subprocess.check_output(['systemctl','show',UNIT,*[arg for name in props for arg in ['-p',name]]], text=True, timeout=15)
    limits = dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
    if limits.get('StartLimitBurst') != '4' or limits.get('StartLimitIntervalUSec') != '2h':
        raise ValueError('Account start policy changed; inspect before release')
    if limits.get('MainPID') != '0' or limits.get('Result') != 'success':
        raise ValueError('Account backup is active or unsuccessful; inspect first')
    since = (now - dt.timedelta(seconds=7210)).isoformat()
    raw = subprocess.check_output(['journalctl','-u',UNIT,'--since',since,'-n','128','--output=json','--no-pager'], text=True, timeout=20)
    rows = [json.loads(line) for line in raw.splitlines()]
    if len(rows) >= 128:
        raise ValueError('Account start history may be truncated')
    starts = [dt.datetime.fromtimestamp(int(row['__REALTIME_TIMESTAMP']) / 1000000,dt.timezone.utc).isoformat()
              for row in rows if row.get('MESSAGE','').startswith('Starting '+UNIT)]
    if limits.get('ExecMainStartTimestamp'):
        latest = dt.datetime.strptime(limits['ExecMainStartTimestamp'], '%a %Y-%m-%d %H:%M:%S UTC').replace(tzinfo=dt.timezone.utc)
        if (now-latest).total_seconds() <= 7210 and not any(abs((stamp(value)-latest).total_seconds()) < 5 for value in starts):
            raise ValueError('Latest native start missing from journal')
    result = assess_start_budget(starts,now,planned_starts=planned_starts)
    result['nativeLimits'] = limits
    return result
