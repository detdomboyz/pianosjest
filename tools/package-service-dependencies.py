"""Bounded, reproducible runtime dependency kit, separate from public assets."""
import gzip,hashlib,io,json,os
from pathlib import Path,PurePosixPath
import re,tarfile

ROOT=Path(__file__).resolve().parent.parent
MAX_FILES=1200;MAX_BYTES=12*1024*1024
def require(value,message):
    if not value:raise ValueError(message)
def descriptor(data):return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
def name_ok(name):
    p=PurePosixPath(name)
    require(not p.is_absolute() and p.as_posix()==name and all(x not in {'','..','.','.git','.aws','.env'} for x in p.parts) and '\\' not in name and ':' not in name,'Unsafe dependency member')
    require(name.startswith('node_modules/'),'Dependency outside modules')
    return name
def collect(root=ROOT):
    root=Path(root);package=json.loads((root/'service/package.json').read_text());lock=json.loads((root/'service/package-lock.json').read_text())
    require(package['dependencies']=={'pg':'8.23.1'} and lock['packages']['']['dependencies']==package['dependencies'],'Only pinned PostgreSQL driver is permitted')
    require(all(k=='' or k.startswith('node_modules/') for k in lock['packages']),'Unexpected local dependency reference')
    require(lock['packages']['node_modules/pg']['version']=='8.23.1','Unpinned pg')
    for key,info in lock['packages'].items():
        if not key:continue
        require(info.get('resolved','').startswith('https://registry.npmjs.org/') and info.get('integrity','').startswith('sha512-') and not info.get('link'),'Unverified dependency registry or link')
        actual=json.loads((root/'service'/key/'package.json').read_text());require(actual['version']==info['version'],'Installed dependency differs from lock')
    files={}
    for p in (root/'service/node_modules').rglob('*'):
        require(not p.is_symlink() and not getattr(p,'is_junction',lambda:False)(),'Dependency links are forbidden')
        if not p.is_file():continue
        name=name_ok(p.relative_to(root/'service').as_posix());data=p.read_bytes();require(len(data)<=2*1024*1024,'Oversized dependency file');files[name]=data
    require(len(files)<=MAX_FILES and sum(map(len,files.values()))<=MAX_BYTES,'Dependency kit exceeds bounds')
    return files,{'kind':'melodiajest-pg-dependencies','version':1,'pgVersion':'8.23.1','packageLockSha256':hashlib.sha256((root/'service/package-lock.json').read_bytes()).hexdigest(),'files':{n:descriptor(v) for n,v in sorted(files.items())}}
def pack(output,root=ROOT):
    output=Path(output);require(not output.exists() and not output.is_symlink(),'Dependency archive already exists');files,manifest=collect(root)
    files['dependencies.json']=(json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode()
    with output.open('xb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',mtime=0) as compressed,tarfile.open(fileobj=compressed,mode='w|',format=tarfile.USTAR_FORMAT) as archive:
        for name,data in sorted(files.items()):
            info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;info.mtime=0;archive.addfile(info,io.BytesIO(data))
    return {'archive':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'files':len(manifest['files']),'packageLockSha256':manifest['packageLockSha256']}
def restore(archive,target,sha):
    archive=Path(archive);require(re.fullmatch(r'[a-f0-9]{64}',sha or '') and hashlib.sha256(archive.read_bytes()).hexdigest()==sha,'Dependency archive SHA differs')
    files={}
    with tarfile.open(archive,'r:gz') as tar:
        for item in tar:
            require(item.isfile() and not item.issparse() and item.size<=2*1024*1024 and item.name not in files,'Invalid dependency archive member')
            if item.name!='dependencies.json':name_ok(item.name)
            data=tar.extractfile(item).read(item.size+1);require(len(data)==item.size,'Truncated dependency member');files[item.name]=data
            require(len(files)<=MAX_FILES+1 and sum(map(len,files.values()))<=MAX_BYTES+256*1024,'Dependency restore exceeds bounds')
    manifest=json.loads(files.pop('dependencies.json'));require(manifest['kind']=='melodiajest-pg-dependencies' and manifest['version']==1 and manifest['pgVersion']=='8.23.1' and manifest['files']=={n:descriptor(v) for n,v in files.items()},'Dependency manifest differs')
    target=Path(target).absolute();require(target.parent.resolve()==target.parent and not target.exists() and not target.is_symlink(),'Dependency restore must be new');target.mkdir(mode=0o755);target.chmod(0o755)
    for name,data in files.items():
        p=target/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o755);p.write_bytes(data);p.chmod(0o644)
    for p in target.rglob('*'):
        if p.is_dir():p.chmod(0o755)
    (target/'dependencies.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n');return manifest
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('command',choices=['pack','restore']);p.add_argument('archive');p.add_argument('--target');p.add_argument('--sha256');a=p.parse_args()
    print(json.dumps(pack(a.archive) if a.command=='pack' else {'restored':True,'files':len(restore(a.archive,a.target,a.sha256)['files'])}))
