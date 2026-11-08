"""Versioned account source/runtime staging. No implicit config or DB migration.

Pure functions accept fixture directories. Production orchestration must hold
the established shared + own operation locks and keep registration closed until
an independent account-data restore succeeds.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tarfile
import uuid

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'deploy/shared-host'))
import release_artifact as artifact

V1_FILES=frozenset({'service/server.cjs','service/security.cjs','service/store.cjs','service/validation.cjs','service/backup.cjs','service/package.json','service/runtime.json','service/socket-clean.cjs',
                 'catalog-transfer.js','catalog-personalization.js','music-document.js','piano-catalog-adapter.js','practice-assessment.js'})
FILES=frozenset(json.loads((ROOT/'service/implementation-files.json').read_text(encoding='utf-8')))
PROFILES={1:V1_FILES,2:FILES}
require=artifact.require


def sync_directory(path):
    if os.name != 'posix':return
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def directory(path,mode=0o755):
    path=Path(path).absolute()
    require(not path.is_symlink() and path.resolve()==path,'Linked service directory')
    path.mkdir(parents=True,exist_ok=True,mode=mode)
    require(path.is_dir() and path.resolve()==path,'Unsafe service directory')
    path.chmod(mode)
    return path


def source_plan(archive,sha):
    entries,bundle=artifact.read_bundle(archive,sha)
    package=json.loads(entries['source/service/package.json']);schema=package.get('dataSchemaVersion')
    require(package.get('name')=='melodiajest-account-service' and package.get('apiVersion')==1 and schema in PROFILES,'Unsupported account API/schema')
    selected={name:entries['source/'+name] for name in PROFILES[schema]}
    if schema==2:
        require(set(json.loads(selected['service/implementation-files.json']))==FILES and package.get('dependencies')=={'pg':'8.23.1'},'Unknown database implementation/dependencies')
    runtime=json.loads(selected['service/runtime.json'])
    require(runtime['version']=='v24.22.2' and runtime['linuxArchiveSha256']=='48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75','Unexpected service runtime')
    files={name:artifact.descriptor(data) for name,data in selected.items()}
    digest=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    manifest={'kind':'melodiajest-account-source','version':1,'releaseVersion':bundle['version'],'serviceVersion':package['version'],'apiVersion':1,'dataSchemaVersion':schema,'archiveSha256':sha,'sourceSha256':digest,'files':files}
    return selected,manifest


def stage_sources(base,archive,sha):
    base=directory(base)
    releases=directory(base/'releases')
    selected,manifest=source_plan(archive,sha)
    # An artifact can update its own recovery tools/configs without changing
    # API bytes. Keep both immutable copies; code identity remains separate.
    name=manifest['releaseVersion']+'-'+manifest['archiveSha256'][:16]
    target=releases/name
    if target.exists():
        require(verify_sources(target)==manifest,'Existing backend differs')
        return {'directory':str(target),'manifest':manifest,'reused':True}
    target.mkdir(mode=0o755)
    for name,data in selected.items():
        path=target/name;path.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
        with path.open('xb') as output:output.write(data);output.flush();os.fsync(output.fileno())
        path.chmod(0o644)
    save(target/'backend.json',manifest)
    (target/'backend.json').chmod(0o644)
    target.chmod(0o755)
    for folder in target.rglob('*'):
        if folder.is_dir():folder.chmod(0o755)
    for folder in sorted({p.parent for p in target.rglob('*')},key=lambda p:len(p.parts),reverse=True):sync_directory(folder)
    sync_directory(releases)
    require(verify_sources(target)==manifest,'Backend source readback differs')
    return {'directory':str(target),'manifest':manifest,'reused':False}


def verify_sources(target):
    target=Path(target).absolute()
    require(target.resolve()==target and target.is_dir() and not target.is_symlink(),'Unsafe backend release')
    manifest=json.loads(artifact.regular_bytes(target,'backend.json'))
    expected=PROFILES.get(manifest.get('dataSchemaVersion'))
    require(manifest.get('kind')=='melodiajest-account-source' and manifest.get('version')==1 and expected is not None and set(manifest.get('files',{}))==expected,'Invalid backend manifest')
    actual={p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file() or p.is_symlink()}
    require(actual==expected|{'backend.json'},'Unexpected backend files')
    for name,info in manifest['files'].items():require(artifact.descriptor(artifact.regular_bytes(target,name))==info,'Backend source checksum differs')
    digest=hashlib.sha256(json.dumps(manifest['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    require(digest==manifest['sourceSha256'],'Backend source identity differs')
    return manifest


def pointer(base,name='current',optional=False):
    base=Path(base);link=base/name
    if optional and not link.exists() and not link.is_symlink():return None
    require(link.is_symlink(),'Expected backend symlink')
    target=os.readlink(link)
    require(re.fullmatch(r'releases/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16}',target or ''),'Invalid backend pointer')
    verify_sources(base/target)
    return target


def select(base,target,expected):
    base=directory(base)
    require(pointer(base,optional=True)==expected,'Backend changed since plan')
    require(re.fullmatch(r'releases/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16}',target or ''),'Invalid selected backend')
    manifest=verify_sources(base/target)
    temporary=base/('.current-'+uuid.uuid4().hex)
    os.symlink(target,temporary,target_is_directory=True)
    os.replace(temporary,base/'current')
    sync_directory(base)
    require(pointer(base)==target,'Backend pointer readback differs')
    return manifest


def unpack_node(archive,destination):
    pin=json.loads((ROOT/'service/runtime.json').read_text(encoding='utf-8'))
    archive=Path(archive);data=archive.read_bytes()
    require(hashlib.sha256(data).hexdigest()==pin['linuxArchiveSha256'],'Node archive checksum differs')
    destination=Path(destination).absolute()
    require(not destination.exists() and not destination.is_symlink() and destination.parent.resolve()==destination.parent,'Runtime destination must be new')
    destination.mkdir(mode=0o755)
    destination.chmod(0o755)
    prefix='node-v24.22.2-linux-x64/'
    result={}
    with tarfile.open(archive,'r:xz') as source:
        for name,output in [('bin/node','node'),('LICENSE','LICENSE')]:
            member=source.getmember(prefix+name)
            require(member.isfile() and not member.issparse() and member.size<=150*1024*1024,'Invalid official runtime member')
            value=source.extractfile(member).read(member.size+1)
            require(len(value)==member.size,'Truncated official runtime')
            if output=='node':require(value.startswith(b'\x7fELF'),'Expected Linux executable')
            if output=='node':require(hashlib.sha256(value).hexdigest()==pin['linuxBinarySha256'],'Node ELF hash differs')
            (destination/output).write_bytes(value);(destination/output).chmod(0o755 if output=='node' else 0o644)
            result[output]=artifact.descriptor(value)
    manifest={'kind':'melodiajest-node-runtime','version':1,'nodeVersion':pin['version'],'archiveSha256':pin['linuxArchiveSha256'],'files':result,'signatureVerificationClaimed':False}
    (destination/'runtime.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n',encoding='utf-8')
    return manifest


def verify_node(destination):
    destination=Path(destination).absolute()
    require(destination.resolve()==destination and destination.is_dir() and not destination.is_symlink(),'Unsafe runtime directory')
    pin=json.loads((ROOT/'service/runtime.json').read_text(encoding='utf-8'))
    manifest=json.loads(artifact.regular_bytes(destination,'runtime.json'))
    require(manifest.get('kind')=='melodiajest-node-runtime' and manifest.get('version')==1 and manifest.get('nodeVersion')==pin['version'] and manifest.get('archiveSha256')==pin['linuxArchiveSha256'] and set(manifest.get('files',{}))=={'node','LICENSE'},'Runtime identity differs')
    require({p.name for p in destination.iterdir()}=={'node','LICENSE','runtime.json'},'Unexpected runtime files')
    for name,info in manifest['files'].items():
        path=destination/name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size<=150*1024*1024,'Invalid runtime file')
        require(artifact.descriptor(path.read_bytes())==info,'Runtime checksum differs')
    require(manifest['files']['node']['sha256']==pin['linuxBinarySha256'],'Unpinned runtime ELF')
    return manifest


def save(path,value):
    path=Path(path);require(path.parent.resolve()==path.parent and not path.is_symlink(),'Unsafe transaction receipt')
    temporary=path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    with temporary.open('xb') as output:
        output.write((json.dumps(value,sort_keys=True,indent=2)+'\n').encode());output.flush();os.fsync(output.fileno())
    temporary.chmod(0o600);os.replace(temporary,path);sync_directory(path.parent)


def apply_backend(base,target,expected,runtime,receipt,schema_preparation=None):
    """Called under established locks; runtime is production or an isolated fixture.

    The only pointer changed is this backend's current. A failed initial start
    stops only the new API and retains its database; a later failure restarts the
    verified previous API. No data restore or schema downgrade is performed.
    """
    base=directory(base);require(pointer(base,optional=True)==expected,'Backend changed since plan')
    require(target!=expected,'An unchanged backend needs no restart')
    manifest=verify_sources(base/target)
    minimum=getattr(runtime,'minimum_schema',lambda:1)()
    require(manifest['dataSchemaVersion']>=minimum,'Backend cannot read the active database; data downgrade is prohibited')
    if expected is not None:require(verify_sources(base/expected)['dataSchemaVersion']>=minimum,'Previous backend cannot read the active database')
    if manifest['dataSchemaVersion']==2:
        ready=getattr(runtime,'schema_ready',lambda value:False)(manifest)
        proof=schema_preparation or {}
        require(ready or (proof.get('kind')=='melodiajest-schema-preparation' and proof.get('status')=='verified' and proof.get('dataSchemaVersion')==2 and proof.get('schemaSha256')==manifest['files']['service/schema.pg.sql']['sha256'] and all(proof.get(key) is True for key in ['sourceCopyVerified','isolatedImportVerified','isolatedRecoveryVerified'])),'Schema migration requires a verified source copy, isolated import and recovery')
    state={'kind':'melodiajest-account-update','version':1,'id':uuid.uuid4().hex,'old':expected,'new':target,'sourceSha256':manifest['sourceSha256'],'status':'planned','dataRestorePerformed':False}
    save(receipt,state);runtime.neighbors()
    try:
        select(base,target,expected);state['status']='switched';save(receipt,state)
        runtime.activate(base/target)
        observed=runtime.verify(base/target,manifest)
        require(observed.get('implementationSha256')==manifest['sourceSha256'],'Running API does not match staged source')
        runtime.neighbors()
    except Exception:
        state['status']='rolling-back'
        try:save(receipt,state)
        except OSError:pass # A broken receipt disk must not prevent rollback.
        try:
            actual=pointer(base,optional=True)
            if actual==expected:
                pass # Switching failed before changing the pointer.
            elif expected is not None:
                select(base,expected,target);old=verify_sources(base/expected);runtime.activate(base/expected);runtime.verify(base/expected,old)
            else:
                require(pointer(base)==target,'Refuse to remove a changed backend pointer');runtime.stop();(base/'current').unlink()
                sync_directory(base)
            runtime.neighbors();state['status']='rolled-back'
            try:save(receipt,state)
            except OSError:pass
        except Exception:
            state['status']='rollback-failed'
            try:save(receipt,state)
            except OSError:pass
            raise
        raise
    if expected is not None:
        previous=base/('.previous-'+state['id']);os.symlink(expected,previous,target_is_directory=True);os.replace(previous,base/'previous');sync_directory(base)
    state['status']='committed';state['health']=observed;save(receipt,state)
    return state
