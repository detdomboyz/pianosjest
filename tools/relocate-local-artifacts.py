"""Move this checkout's generated artifacts to private D: after full readback.

Two phases: copy (default), then --retire after reviewing the private map.
No dependencies, archive repacking, Git data, or user catalogs are involved.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import time
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[1]
PRIVATE=Path(r'D:\MelodiaJest-private\host-maintenance')
DEST=PRIVATE/'workspace-artifacts'
NAMES=('dist','tmp','.qa','web-app/.tooling','web-app/.next','web-app/out','web-app/node_modules',
       'tools/__pycache__','service/__pycache__','deploy/shared-host/__pycache__','tests/__pycache__')


def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024**2),b''):h.update(b)
    return h.hexdigest()


def scan(home):
    out=[];pending=[]
    def describe(p,s):
        directory=stat.S_ISDIR(s.st_mode);digest=None if directory else sha(p)
        after=p.lstat()
        if (s.st_ino,s.st_size,s.st_mtime_ns,s.st_mode)!=(after.st_ino,after.st_size,after.st_mtime_ns,after.st_mode):raise ValueError('file changed while hashing')
        return dict(path=p.relative_to(home).as_posix(),directory=directory,bytes=0 if directory else s.st_size,
                    mtimeNs=s.st_mtime_ns,mode=stat.S_IMODE(s.st_mode),sha256=digest)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for folder,dirs,files in os.walk(home,onerror=lambda e:(_ for _ in ()).throw(e)):
            for name in sorted(dirs+files):
                p=Path(folder)/name;s=p.lstat()
                if stat.S_ISLNK(s.st_mode) or getattr(s,'st_reparse_tag',0):raise ValueError('unexpected reparse point: '+str(p))
                if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):raise ValueError('special file')
                if stat.S_ISDIR(s.st_mode):out.append(describe(p,s))
                else:pending.append(pool.submit(describe,p,s))
                if len(pending)>=64:out.extend(f.result() for f in pending);pending=[]
                if len(out)>500000:raise ValueError('artifact entry budget exceeded')
        out.extend(f.result() for f in pending)
    return sorted(out,key=lambda x:x['path'])


def save(path,value):
    temporary=path.with_suffix('.pending')
    with temporary.open('w',encoding='utf-8') as stream:
        stream.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)


def junction(source,target):
    import subprocess
    result=subprocess.run(['cmd','/d','/c','mklink','/J',str(source),str(target)],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise RuntimeError('junction creation failed: '+result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))
    if source.resolve()!=target:raise ValueError('junction verification failed')


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--retire',action='store_true');p.add_argument('--resume-copy',action='store_true');args=p.parse_args()
    if os.name!='nt' or ROOT!=Path(r'C:\Users\Alexander\Documents\web\pianosjest'):raise ValueError('fixed Windows checkout required')
    if PRIVATE.resolve()!=PRIVATE or DEST.is_symlink():raise ValueError('unexpected destination')
    DEST.mkdir(exist_ok=True)
    map_path=PRIVATE/'local-artifacts-20261116-map.json'
    if args.retire:
        report=json.loads(map_path.read_text(encoding='utf-8'))
        if report['phase'] not in ('copy-verified','relocated'):raise ValueError('complete verified copy map required')
        for item in report['roots']:
            if item['name'] not in NAMES:raise ValueError('source outside generated allowlist')
            source=ROOT/item['name'];target=DEST/item['name']
            if source.resolve()==target:
                item['junctionVerified']=True;save(map_path,report);continue
            if source.resolve()!=source or not source.is_relative_to(ROOT) or not target.resolve().is_relative_to(PRIVATE):raise ValueError('unsafe retirement path')
            if not source.exists():
                if not item.get('availableBeforeRetirementBytes') or scan(target)!=item['entries']:raise ValueError('missing source without a verified retirement checkpoint')
                junction(source,target);item['junctionVerified']=True;item['availableAfterRetirementBytes']=shutil.disk_usage(ROOT).free;save(map_path,report);continue
            if scan(source)!=item['entries'] or scan(target)!=item['entries']:raise ValueError('source/destination changed after verification')
            item['availableBeforeRetirementBytes']=shutil.disk_usage(ROOT).free;save(map_path,report)
            # Remove only the fully copied, enumerated generated members.
            for row in sorted(item['entries'],key=lambda x:len(Path(x['path']).parts),reverse=True):
                member=source/row['path']
                if not member.resolve(strict=True).is_relative_to(source):raise ValueError('retirement member escaped source')
                observed=member.lstat()
                if getattr(observed,'st_reparse_tag',0):raise ValueError('retirement member became a link')
                if row['directory']:
                    if not observed.st_mode&stat.S_IWRITE:member.chmod(observed.st_mode|stat.S_IWRITE)
                    member.rmdir()
                else:
                    if (observed.st_size,observed.st_mtime_ns,stat.S_IMODE(observed.st_mode))!=(row['bytes'],row['mtimeNs'],row['mode']):raise ValueError('file changed immediately before retirement')
                    if not member.stat().st_mode&stat.S_IWRITE:member.chmod(member.stat().st_mode|stat.S_IWRITE)
                    member.unlink()
            source.rmdir()
            junction(source,target)
            item['junctionVerified']=True;item['availableAfterRetirementBytes']=shutil.disk_usage(ROOT).free;save(map_path,report)
        report['phase']='relocated';save(map_path,report)
    else:
        if map_path.exists() and not args.resume_copy:raise ValueError('copy map already exists; inspect before repeating')
        report=json.loads(map_path.read_text(encoding='utf-8')) if map_path.exists() else dict(format='melodiajest-local-artifact-map-v1',phase='copying',roots=[])
        for name in NAMES:
            source=ROOT/name
            if not source.exists():continue
            if any(x['name']==name for x in report['roots']):continue
            if source.resolve()!=source:raise ValueError('source already redirected')
            target=DEST/name
            if target.exists() and not args.resume_copy:raise ValueError('destination already exists')
            entries=scan(source);size=sum(x['bytes'] for x in entries)
            if shutil.disk_usage(PRIVATE).free<size+2*1024**3:raise ValueError('insufficient D: headroom')
            target.mkdir(parents=True,exist_ok=args.resume_copy)
            if args.resume_copy:
                expected={x['path']:x for x in entries}
                for row in scan(target):
                    if row['path'] not in expected or (row['directory'],row['sha256'])!=(expected[row['path']]['directory'],expected[row['path']]['sha256']):raise ValueError('unexpected resumed destination member')
            for row in sorted(entries,key=lambda x:len(Path(x['path']).parts)):
                member=target/row['path']
                if row['directory']:member.mkdir(exist_ok=True)
                elif member.exists():shutil.copystat(source/row['path'],member)
                else:shutil.copy2(source/row['path'],member)
            for row in sorted(entries,key=lambda x:len(Path(x['path']).parts),reverse=True):
                if row['directory']:shutil.copystat(source/row['path'],target/row['path'])
            if scan(target)!=entries or scan(source)!=entries:raise ValueError('full copy verification failed')
            report['roots'].append(dict(name=name,source=str(source),destination=str(target),logicalBytes=size,entries=entries,fullSha256ReadbackVerified=True))
            save(map_path,report);print(json.dumps(dict(copied=name,files=sum(not x['directory'] for x in entries),bytes=size)),flush=True)
        report['phase']='copy-verified';save(map_path,report)
    print(json.dumps(dict(phase=report['phase'],roots=len(report['roots']),bytes=sum(x['logicalBytes'] for x in report['roots']))))


if __name__=='__main__':main()
