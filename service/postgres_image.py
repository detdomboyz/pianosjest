"""Read/verify the complete pinned OCI image archive without extracting paths."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent.parent
PIN=json.loads((ROOT/'service/postgres-runtime.json').read_text(encoding='utf-8'))
LIMIT=512*1024*1024


def descriptor(path,limit=LIMIT):
    path=Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>limit:raise ValueError('Invalid own archive file')
    digest=hashlib.sha256();size=0
    with path.open('rb') as stream:
        while chunk:=stream.read(1024*1024):size+=len(chunk);digest.update(chunk)
    if size!=path.stat().st_size:raise ValueError('Archive changed while reading')
    return {'bytes':size,'sha256':digest.hexdigest()}


def verify(path):
    info=descriptor(path);names=set();documents={};sizes={};total=0;blob_count=0
    with tarfile.open(path,'r|gz') as archive:
        for member in archive:
            name=member.name.rstrip('/')
            if member.isdir():
                if name not in {'blobs','blobs/sha256'}:raise ValueError('Unexpected image directory')
                continue
            if not member.isfile() or member.issparse() or name in names:raise ValueError('Invalid image member')
            names.add(name)
            sizes[name]=member.size
            blob=re.fullmatch(r'blobs/sha256/([a-f0-9]{64})',name)
            if not blob and name not in {'index.json','manifest.json','oci-layout','repositories'}:raise ValueError('Unknown image archive format')
            total+=member.size
            if len(names)>160 or total>1024*1024*1024 or member.size>768*1024*1024:raise ValueError('Image archive exceeds limits')
            digest=hashlib.sha256();small=bytearray() if member.size<=1024*1024 else None;read=0
            stream=archive.extractfile(member)
            while chunk:=stream.read(1024*1024):
                read+=len(chunk);digest.update(chunk)
                if small is not None:small.extend(chunk)
            if read!=member.size:raise ValueError('Truncated image member')
            if blob:
                if digest.hexdigest()!=blob.group(1):raise ValueError('OCI blob digest differs')
                blob_count+=1
            if small is not None:
                try:documents[name]=json.loads(small)
                except (UnicodeDecodeError,ValueError):pass
    index=documents.get('index.json');manifest=documents.get('manifest.json')
    if not isinstance(index,dict) or not isinstance(manifest,list) or len(manifest)!=1:raise ValueError('Expected one pinned OCI image')
    for item in manifest:
        if any(tag!='postgres:18-bookworm' for tag in (item.get('RepoTags') or [])):raise ValueError('Image would retag another repository')
    def referenced(value):
        digest=value.get('digest') if isinstance(value,dict) else None
        if not isinstance(digest,str) or not re.fullmatch(r'sha256:[a-f0-9]{64}',digest):raise ValueError('Invalid OCI descriptor')
        name='blobs/sha256/'+digest[7:]
        if name not in names or value.get('size')!=sizes[name]:raise ValueError('Missing or changed referenced image blob')
        return name
    # Docker retains the signed multi-platform index while exporting only the
    # locally installed platform. Require the complete native chain; another
    # architecture or its absent attestation is not a restore dependency.
    roots=index.get('manifests')
    if not isinstance(roots,list) or len(roots)!=1 or roots[0].get('digest')!=PIN['imageId']:raise ValueError('Wrong pinned OCI root')
    pinned=documents.get(referenced(roots[0]))
    platforms=pinned.get('manifests') if isinstance(pinned,dict) else None
    if not isinstance(platforms,list):raise ValueError('Pinned platform index missing')
    native=[value for value in platforms if value.get('platform')=={'architecture':'amd64','os':'linux'}]
    if len(native)!=1:raise ValueError('Expected exactly one native PostgreSQL image')
    image=documents.get(referenced(native[0]))
    if not isinstance(image,dict) or not isinstance(image.get('layers'),list):raise ValueError('Native OCI manifest missing')
    config_name=referenced(image.get('config'));config=documents.get(config_name)
    if not isinstance(config,dict) or config.get('architecture')!='amd64' or config.get('os')!='linux':raise ValueError('Wrong native image configuration')
    layers=[referenced(value) for value in image['layers']]
    if manifest[0].get('Config')!=config_name or manifest[0].get('Layers')!=layers:raise ValueError('Docker and OCI native manifests differ')
    return {**info,'imageId':PIN['imageId'],'nativeManifestSha256':native[0]['digest'],'architecture':'linux/amd64','blobsVerified':blob_count,'uncompressedBytes':total,'pathsExtracted':False}


def ensure(directory):
    directory=Path(directory)
    if directory!=Path('/opt/melodiajest/ops/postgres-runtime') or directory.resolve()!=directory:raise ValueError('Own immutable image directory required')
    directory.mkdir(mode=0o700,exist_ok=True);directory.chmod(0o700)
    target=directory/('postgres-18-'+PIN['imageId'][7:19]+'.tar.gz');receipt=target.with_suffix('.json')
    if target.exists():
        observed=verify(target)
        if receipt.exists():
            if observed!=json.loads(receipt.read_text()):raise ValueError('Existing image copy changed')
        else:receipt.write_text(json.dumps(observed,sort_keys=True,indent=2)+'\n');receipt.chmod(0o600)
        return target,observed
    process=subprocess.Popen(['docker','image','save',PIN['imageId']],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        with target.open('xb') as raw:
            os.chmod(target,0o600)
            with gzip.GzipFile(filename='',mode='wb',compresslevel=3,fileobj=raw,mtime=0) as output:
                while chunk:=process.stdout.read(1024*1024):output.write(chunk)
            raw.flush();os.fsync(raw.fileno())
        if process.wait(timeout=60)!=0:raise RuntimeError('Own image export failed')
        observed=verify(target);receipt.write_text(json.dumps(observed,sort_keys=True,indent=2)+'\n');receipt.chmod(0o600);return target,observed
    finally:
        if process.poll() is None:process.terminate();process.wait(timeout=10)


def load(path):
    proof=verify(path)
    result=subprocess.run(['docker','image','load','-i',str(path)],capture_output=True,text=True,timeout=150)
    if result.returncode:raise RuntimeError('Restored own image did not load')
    image=json.loads(subprocess.check_output(['docker','image','inspect',PIN['imageId']],text=True,timeout=10))[0]
    if image['Id']!=PIN['imageId'] or image['Architecture']!='amd64':raise ValueError('Loaded image identity differs')
    return {**proof,'dockerLoadVerified':True,'daemonLayerReusePossible':True}
