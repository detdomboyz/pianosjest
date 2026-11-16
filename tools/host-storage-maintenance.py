"""Manual private-PC archive transport for deploy/shared-host/host_storage.py.

No scheduler, dependency installation, image build, or application deployment.
Run --help; the SSH helper must return a strict-host-key ssh_command list.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import runpy
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import zlib

ROOT=Path(__file__).resolve().parents[1]
PRIVATE=Path(r'D:\MelodiaJest-private\host-maintenance')


def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024**2),b''):h.update(chunk)
    return h.hexdigest()


def write(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n',encoding='utf-8')


def remote(ssh,code,output=None):
    if output:
        with output.open('xb') as target,output.with_suffix('.stderr').open('xb') as errors:
            result=subprocess.run(ssh+['python3','-B','-'],input=code.encode(),stdout=target,stderr=errors)
    else:
        result=subprocess.run(ssh+['python3','-B','-'],input=code.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('remote failed: '+('see private stderr' if output else result.stderr.decode(errors='replace')[-2500:]))
    return None if output else json.loads(result.stdout)


def module_code():
    data=(ROOT/'deploy/shared-host/host_storage.py').read_bytes()
    return 'import base64\nns={"__name__":"storage_module"}\nexec(compile(base64.b64decode('+repr(base64.b64encode(data).decode())+'),"host_storage.py","exec"),ns)\n'


def call(ssh,request,output=None):
    compressed=base64.b64encode(zlib.compress(json.dumps(request).encode(),level=1)).decode()
    code=module_code()+'import json,zlib\nns["execute"](json.loads(zlib.decompress(base64.b64decode('+repr(compressed)+'))))\n'
    return remote(ssh,code,output)


def readback(archive,manifest):
    """Read every compressed byte and every tar member; never extract on Windows."""
    expected={x['path']:x for x in manifest['entries']};seen={};count=0
    archive_sha=sha(archive)
    with tarfile.open(archive,'r|gz') as tar:
        for member in tar:
            name=member.name.rstrip('/')
            if name not in expected or name in seen:raise ValueError('unexpected/duplicate archive member')
            row=expected[name]
            if (member.mode,member.uid,member.gid)!=(row['mode'],row['uid'],row['gid']):raise ValueError('archive permissions differ: '+name)
            if row['type']=='directory':
                if not member.isdir():raise ValueError('directory type differs')
            elif row['type']=='symlink':
                if not member.issym() or member.linkname!=row['target']:raise ValueError('symlink differs')
            else:
                if member.islnk():
                    target=member.linkname.rstrip('/')
                    if target not in seen or seen[target]!=row['sha256']:raise ValueError('unverified hardlink target')
                else:
                    if not member.isfile() or member.size!=row['bytes']:raise ValueError('file type/size differs')
                    h=hashlib.sha256();source=tar.extractfile(member)
                    for chunk in iter(lambda:source.read(1024**2),b''):h.update(chunk)
                    if h.hexdigest()!=row['sha256']:raise ValueError('member hash differs: '+name)
            seen[name]=row.get('sha256');count+=1
    if set(seen)!=set(expected):raise ValueError('missing archive members')
    return dict(privateArchive=str(archive),archiveSha256=archive_sha,archiveBytes=archive.stat().st_size,
                manifestSha256=hashlib.sha256((json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest(),
                fullArchiveReadbackVerified=True,allMembersVerified=True,linuxRestoreVerified=False,members=count)


def content_pack(archive,manifest,target):
    expected={x['path']:x for x in manifest['entries']};wanted={x['sha256']:x['bytes'] for x in manifest['entries'] if x['type']=='file'};seen=set()
    if target.exists():raise ValueError('content transport already exists')
    with tarfile.open(str(archive),'r|gz') as source,tarfile.open(str(target),'w|gz',compresslevel=3) as output:
        for member in source:
            row=expected[member.name.rstrip('/')]
            if row['type']!='file' or not member.isfile() or row['sha256'] in seen:continue
            entry=tarfile.TarInfo('blobs/'+row['sha256']);entry.size=row['bytes'];entry.mode=0o600;entry.mtime=0
            output.addfile(entry,source.extractfile(member));seen.add(row['sha256'])
    if seen!=set(wanted):raise ValueError('missing transport content')
    observed=set()
    with tarfile.open(target,'r|gz') as source:
        for member in source:
            key=member.name.removeprefix('blobs/')
            if not member.isfile() or member.name!='blobs/'+key or key not in wanted or key in observed or member.size!=wanted[key]:raise ValueError('invalid content pack')
            h=hashlib.sha256()
            data=source.extractfile(member)
            for block in iter(lambda:data.read(1024**2),b''):h.update(block)
            if h.hexdigest()!=key:raise ValueError('content pack hash differs')
            observed.add(key)
    if observed!=set(wanted):raise ValueError('content pack incomplete')
    return dict(sha256=sha(target),bytes=target.stat().st_size,uniqueContents=len(wanted),uniqueContentBytes=sum(wanted.values()),fullReadbackVerified=True)


def restore_pack(ssh,work,manifest,transport):
    token=hashlib.sha256(str(work).encode()).hexdigest()[:32];scratch='/opt/melodiajest/ops/storage-restore-'+token
    target=work/'archives/content-transport.tar.gz'
    if sha(target)!=transport['sha256']:raise ValueError('content transport changed')
    request=dict(module=(ROOT/'deploy/shared-host/host_storage.py').read_text(encoding='utf-8'),manifest=manifest,scratch=scratch)
    body=zlib.compress(json.dumps(request).encode(),level=1)
    bootstrap='''import sys,json,zlib,pathlib,shutil,os,resource
os.nice(15)
resource.setrlimit(resource.RLIMIT_AS,(768*1024**2,768*1024**2))
s=sys.stdin.buffer
header=s.read(8);assert len(header)==8
length=int.from_bytes(header,'big');assert 0<length<32*1024**2
raw=s.read(length);assert len(raw)==length
request=json.loads(zlib.decompress(raw));ns={'__name__':'storage_module'}
exec(compile(request['module'],'host_storage.py','exec'),ns)
p=pathlib.Path(request['scratch']);assert p.parent==ns['BASE']/'ops' and p.name.startswith('storage-restore-') and not p.exists()
assert shutil.disk_usage(p.parent).free>request['manifest']['uniqueFileBytes']+2*1024**3
p.mkdir(mode=0o700)
result=ns['restore_content'](p,request['manifest'],s)
result['workerPeakRssBytes']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
result['workerLimits']={'memoryMaxBytes':640*1024**2,'cpuQuotaPercent':65,'pidsMax':32,'addressSpaceBytes':768*1024**2}
print(json.dumps(result))
'''
    with target.open('rb') as source,(work/'logs/restore-content.stderr').open('wb') as errors:
        command=ssh+['systemd-run','--scope','--collect','--quiet','--unit=melodiajest-storage-restore-'+token[:12],'--property=MemoryMax=640M','--property=CPUQuota=65%','--property=TasksMax=32','python3','-B','-c',shlex.quote(bootstrap)]
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors)
        try:
            process.stdin.write(len(body).to_bytes(8,'big'));process.stdin.write(body);shutil.copyfileobj(source,process.stdin,1024**2);process.stdin.close()
            result=process.stdout.read();status=process.wait()
        except BaseException:
            process.stdin.close();process.wait();raise
    if status:raise RuntimeError('content restoration failed; inspect private stderr and preserve scratch')
    return scratch,json.loads(result)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('manifest','export','readback','pack-content','restore-content','restore','quarantine','rollback','commit','cleanup-transaction'))
    parser.add_argument('--run',type=Path,required=True)
    parser.add_argument('--ssh-helper',type=Path)
    parser.add_argument('--keep-restored',action='store_true',help='Keep a verified isolated snapshot for an explicit recovery exercise')
    args=parser.parse_args();work=args.run
    if not work.is_absolute() or not work.resolve().is_relative_to(PRIVATE.resolve()):raise ValueError('private D: task directory required')
    manifest_path=work/'manifest.json';archive=work/'archives/retired-files.tar.gz';receipt_path=work/'receipt.json'
    ssh=runpy.run_path(str(args.ssh_helper))['ssh_command']() if args.ssh_helper else None
    if args.action=='manifest':
        plan=json.loads((work/'plan.json').read_text(encoding='utf-8'))
        result=call(ssh,dict(action='manifest',**plan));write(manifest_path,result)
        print(json.dumps(dict(entries=result['files'],uniqueBytes=result['uniqueFileBytes'])))
        return
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if args.action=='export':
        call(ssh,dict(action='export',manifest=manifest),archive);print(json.dumps(dict(bytes=archive.stat().st_size)));return
    if args.action=='readback':
        receipt=readback(archive,manifest);write(receipt_path,receipt);print(json.dumps(receipt));return
    receipt=json.loads(receipt_path.read_text(encoding='utf-8'))
    token=hashlib.sha256(str(work).encode()).hexdigest()[:32]
    if args.action=='cleanup-transaction':
        journal=json.loads((work/'commit-result.json').read_text(encoding='utf-8'))
        hashes={}
        for label,value in (('manifest',manifest),('journal',journal)):
            raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
            copy=work/(label+'.canonical.json');copy.write_bytes(raw);hashes[label]=sha(copy)
            if hashes[label]!=hashlib.sha256(raw).hexdigest():raise ValueError('private metadata readback failed')
        result=call(ssh,dict(action='cleanup-transaction',token=token,manifestSha256=hashes['manifest'],journalSha256=hashes['journal']))
        write(work/'cleanup-transaction-result.json',result);print(json.dumps(result));return
    if args.action=='pack-content':
        if not receipt.get('allMembersVerified') or sha(archive)!=receipt['archiveSha256']:raise ValueError('original archive must pass full readback first')
        result=content_pack(archive,manifest,work/'archives/content-transport.tar.gz');write(work/'content-transport.json',result);print(json.dumps(result));return
    if args.action=='restore-content':
        transport=json.loads((work/'content-transport.json').read_text(encoding='utf-8'))
        if not transport.get('fullReadbackVerified'):raise ValueError('unverified content transport')
        scratch,result=restore_pack(ssh,work,manifest,transport)
        receipt.update(linuxRestoreVerified=True,linuxRestore=result,linuxScratch=scratch,transport=transport)
        write(receipt_path,receipt);write(work/'restore-map.json',dict(format='melodiajest-private-restore-map-v1',receipt=receipt,manifest=str(manifest_path),originalBase='/opt/melodiajest',instructions='The original private GNU-tar archive is authoritative. The optional content transport stores each SHA once. restore_content recreates distinct original inodes, hardlinks, symlinks, UID/GID, modes, xattrs and times. Verify every original member before use. Acquire existing shared/own locks and stop only affected own services before restoring original paths; never overwrite live data.'))
        if not args.keep_restored:result.update(call(ssh,dict(action='cleanup-restored',scratch=scratch,manifest=manifest)))
        print(json.dumps(result));return
    if args.action=='restore':
        if sha(archive)!=receipt['archiveSha256']:raise ValueError('private archive changed')
        scratch='/opt/melodiajest/ops/storage-restore-'+token
        # Member set and types already validated on the PC. GNU tar preserves
        # Linux UID/GID, modes, links, nanosecond times, ACLs and xattrs.
        code='import pathlib,subprocess,shutil,json\np=pathlib.Path('+repr(scratch)+')\nassert not p.exists()\nassert shutil.disk_usage(p.parent).free>'+str(manifest['uniqueFileBytes']+2*1024**3)+'\np.mkdir(mode=0o700)\nr=subprocess.run(["nice","-n","15","ionice","-c","3","tar","-xz","--numeric-owner","--same-permissions","--acls","--xattrs","--keep-old-files","-C",str(p)])\nassert r.returncode==0\n'
        command=ssh+['python3','-B','-c',shlex.quote(code)]
        with archive.open('rb') as source,(work/'logs/restore.stderr').open('wb') as errors:
            result=subprocess.run(command,stdin=source,stdout=subprocess.PIPE,stderr=errors)
        if result.returncode:raise RuntimeError('isolated extraction failed; preserve scratch for inspection')
        result=call(ssh,dict(action='verify-restored',scratch=scratch,manifest=manifest))
        receipt.update(linuxRestoreVerified=True,linuxRestore=result,linuxScratch=scratch)
        write(receipt_path,receipt);write(work/'restore-map.json',dict(format='melodiajest-private-restore-map-v1',receipt=receipt,originalBase='/opt/melodiajest',manifest=str(manifest_path),instructions='Verify archive SHA and manifest. Restore with GNU tar preserving numeric owners, ACLs, xattrs and links into an empty isolated Linux directory. Compare every member with host_storage.verify_tree(relocated=True). Stop own affected services and acquire existing shared/own locks before restoring exact selected paths. Never overwrite current data.'))
        if not args.keep_restored:result.update(call(ssh,dict(action='cleanup-restored',scratch=scratch,manifest=manifest)))
        print(json.dumps(result));return
    request=dict(action=args.action,token=token,receipt=receipt)
    if args.action=='quarantine':request['manifest']=manifest
    result=call(ssh,request);write(work/(args.action+'-result.json'),result)
    print(json.dumps({k:result[k] for k in ('token','phase','deletedEntries') if k in result}))


if __name__=='__main__':main()
