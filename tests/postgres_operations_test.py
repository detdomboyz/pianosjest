"""Security boundaries of the executed PostgreSQL packaging and configs."""
import gzip
import hashlib
import io
import json
import sys
import tarfile
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'service'))
import postgres
import postgres_image as image
import postgres_backup as backup
import deployment
import units


class PostgresOperations(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'tmp');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def test_no_network_no_foreign_paths_and_password_file_only(self):
        value=json.loads(postgres.compose());self.assertEqual(set(value['services']),{'melodiajest-postgres'});service=value['services']['melodiajest-postgres'];self.assertEqual(service['network_mode'],'none');self.assertNotIn('ports',service);self.assertTrue(service['read_only']);self.assertEqual(service['cap_drop'],['ALL'])
        self.assertNotIn('POSTGRES_PASSWORD',service['environment']);self.assertIn('POSTGRES_PASSWORD_FILE',service['environment'])
        for mount in service['volumes']:self.assertTrue(mount['source'].startswith(('/opt/melodiajest/','/run/melodiajest-')))
        config=postgres.configuration();self.assertIn("listen_addresses = ''",config['postgresql.conf']);self.assertIn('fsync = on',config['postgresql.conf']);self.assertIn('melodiajest_api scram-sha-256',config['pg_hba.conf']);self.assertNotIn('trust',config['pg_hba.conf'])
    def test_unit_preserves_unix_only_api_and_uses_pinned_optional_dependencies(self):
        node='/opt/melodiajest/runtime/node-v24.22.2-48cc0e21e048/node';tooling='/opt/melodiajest/ops/tooling/account-'+'a'*16;deps='/opt/melodiajest/runtime/pg-8.23.1-'+'b'*12+'/node_modules'
        result=units.render(node,tooling,postgres=True,dependencies=deps);self.assertIn('PrivateNetwork=yes',result['melodiajest-account.service']);self.assertIn('RestrictAddressFamilies=AF_UNIX',result['melodiajest-account.service']);self.assertIn('NODE_PATH='+deps,result['melodiajest-account.service']);self.assertIn('Requires=melodiajest-postgres.service',result['melodiajest-account.service']);self.assertIn('MELODIA_POSTGRES_CONFIG=',units.environment(True,postgres=True,maintenance=True));self.assertIn('MELODIA_MAINTENANCE_READ_ONLY=1',units.environment(True,postgres=True,maintenance=True))
        with self.assertRaises(ValueError):units.render(node,tooling,postgres=True,dependencies='/tmp/unverified')
    def test_readiness_rejects_the_initdb_temporary_server(self):
        from subprocess import CompletedProcess
        values=[CompletedProcess([],0,'/usr/bin/bash',''),CompletedProcess([],0,'/usr/lib/postgresql/18/bin/postgres',''),CompletedProcess([],2,'','not yet ready'),CompletedProcess([],0,'/usr/lib/postgresql/18/bin/postgres',''),CompletedProcess([],0,'1\n','')]
        with patch.object(postgres,'verify_container'),patch.object(postgres.subprocess,'run',side_effect=values) as run,patch.object(postgres.time,'sleep'):
            self.assertTrue(postgres.wait()['finalPostmasterAuthenticated']);self.assertEqual(run.call_count,5)
    def test_scheduled_neighbor_probe_needs_no_host_network_or_private_mounts(self):
        from subprocess import CompletedProcess
        statuses={host:200 for host in ['libreta.ru','praicer.ru','grigorova.libreta.ru']}
        with patch.object(backup.subprocess,'run',return_value=CompletedProcess([],0,json.dumps(statuses),'')) as run,patch.object(backup,'stop_owned'):
            self.assertEqual(backup.neighbors(),statuses);command=run.call_args.args[0];self.assertNotIn('--mount',command);self.assertNotIn('--env',command);self.assertEqual(command[command.index('--network')+1],'bridge');self.assertIn('--read-only',command)
    def archive(self,*,corrupt=False,unsafe=False,missing_layer=False):
        files={}
        def blob(data):
            digest=hashlib.sha256(data).hexdigest();files['blobs/sha256/'+digest]=data;return {'digest':'sha256:'+digest,'size':len(data)}
        config=blob(b'{"rootfs":{"diff_ids":[]},"architecture":"amd64","os":"linux"}');layer=blob(b'isolated complete native layer')
        native=blob(json.dumps({'config':config,'layers':[layer]}).encode());native['platform']={'architecture':'amd64','os':'linux'}
        foreign={'digest':'sha256:'+'a'*64,'size':123,'platform':{'architecture':'arm64','os':'linux'}}
        pinned=blob(json.dumps({'manifests':[native,foreign]}).encode());index={'schemaVersion':2,'manifests':[pinned]}
        files.update({'index.json':json.dumps(index).encode(),'manifest.json':json.dumps([{'RepoTags':None,'Config':'blobs/sha256/'+config['digest'][7:],'Layers':['blobs/sha256/'+layer['digest'][7:]]}]).encode(),'oci-layout':b'{"imageLayoutVersion":"1.0.0"}'})
        if corrupt:files['blobs/sha256/'+config['digest'][7:]]=b'changed'
        if missing_layer:files.pop('blobs/sha256/'+layer['digest'][7:])
        if unsafe:files['../outside']=b'never extract'
        target=self.root/('image-'+str(corrupt)+str(unsafe)+'.tar.gz')
        with tarfile.open(target,'w:gz') as tar:
            for name,data in files.items():member=tarfile.TarInfo(name);member.size=len(data);tar.addfile(member,io.BytesIO(data))
        return target,pinned['digest']
    def test_complete_image_blobs_are_read_and_checked_without_extracting_tar_paths(self):
        archive,digest=self.archive()
        with patch.dict(image.PIN,{'imageId':digest}):proof=image.verify(archive)
        self.assertEqual(proof['blobsVerified'],4);self.assertEqual(proof['architecture'],'linux/amd64');self.assertFalse(proof['pathsExtracted']);self.assertFalse((self.root/'blobs').exists())
        archive,digest=self.archive(corrupt=True)
        with patch.dict(image.PIN,{'imageId':digest}),self.assertRaises(ValueError):image.verify(archive)
        archive,digest=self.archive(unsafe=True)
        with patch.dict(image.PIN,{'imageId':digest}),self.assertRaises(ValueError):image.verify(archive)
        archive,digest=self.archive(missing_layer=True)
        with patch.dict(image.PIN,{'imageId':digest}),self.assertRaises(ValueError):image.verify(archive)
    def test_postgres_payload_is_closed_and_detects_changed_private_dump(self):
        payload=self.root/'payload';payload.mkdir()
        for name in backup.CORE:path=payload/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixture')
        (payload/'data/postgres.json').write_text(json.dumps(postgres.client_configuration()))
        digest='a'*64;snapshot={'consistentSnapshot':True,'restoredUsersMustSignIn':True,'digest':digest,'exported':image.descriptor(payload/'data/postgres.dump')};(payload/'data/snapshot.json').write_text(json.dumps(snapshot))
        metadata={'kind':'melodiajest-postgres-payload','version':2,'dataDigest':digest,'files':backup.tree(payload)};deployment.save(payload/'account-payload.json',metadata);self.assertEqual(backup.verify_payload(payload),metadata)
        (payload/'unexpected.key').write_bytes(b'not accepted')
        with self.assertRaises(ValueError):backup.verify_payload(payload)
        (payload/'unexpected.key').unlink();(payload/'data/postgres.dump').write_bytes(b'changed')
        with self.assertRaises(ValueError):backup.verify_payload(payload)


if __name__=='__main__':unittest.main(verbosity=2)
