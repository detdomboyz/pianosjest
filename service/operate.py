"""Permanent own API updater. Caller supplies a verified release and runtime.

No database migration, foreign-service restart, Caddy change, package install,
or production restore is implemented here.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'deploy/shared-host'))
sys.path.insert(0,str(ROOT/'service'))
import release_update as web
import deployment
from account_backup import request

BASE=Path('/opt/melodiajest')


class Runtime:
    def minimum_schema(self):return 2 if (BASE/'account-data/postgres.json').exists() else 1
    def schema_ready(self,manifest):
        try:
            current=deployment.verify_sources(BASE/'account-service'/deployment.pointer(BASE/'account-service'))
            status,health=request('/run/melodiajest-account/api.sock','/health')
            return status==200 and health.get('databaseSchemaVersion')==2 and current['dataSchemaVersion']==2 and current['files']['service/schema.pg.sql']==manifest['files']['service/schema.pg.sql']
        except (OSError,ValueError,KeyError):return False
    def neighbors(self):return web.ProductionRuntime(BASE).neighbors()
    def activate(self,target):
        subprocess.run(['systemctl','restart','melodiajest-account.service'],check=True,capture_output=True,timeout=35)
    def stop(self):subprocess.run(['systemctl','stop','melodiajest-account.service'],check=True,capture_output=True,timeout=35)
    def verify(self,target,manifest):
        error=None
        for attempt in range(100):
            try:
                status,health=request('/run/melodiajest-account/api.sock','/health')
                deployment.require(status==200 and health.get('status')=='ok' and health.get('schemaVersion')==1 and health.get('implementationSha256')==manifest['sourceSha256'],'Staged account implementation is not running')
                return health
            except (OSError,ValueError) as observed:error=observed;time.sleep(0.1)
        raise RuntimeError('Account startup verification failed') from error


def apply(archive,sha,expected,schema_receipt=None):
    deployment.require(os.name=='posix' and os.geteuid()==0,'Own production root context required')
    with web.operation_locks(BASE):
        web.ensure_idle(BASE)
        staged=deployment.stage_sources(BASE/'account-service',archive,sha)
        target='releases/'+Path(staged['directory']).name
        proof=None
        if schema_receipt is not None:
            schema_receipt=Path(schema_receipt)
            deployment.require(schema_receipt.is_relative_to(BASE/'ops') and schema_receipt.resolve()==schema_receipt and not schema_receipt.is_symlink(),'Expected own schema preparation receipt')
            proof=json.loads(schema_receipt.read_text())
        return deployment.apply_backend(BASE/'account-service',target,expected,Runtime(),BASE/'ops/account-update.json',schema_preparation=proof)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['plan','apply'])
    parser.add_argument('archive',type=Path);parser.add_argument('--sha256',required=True)
    parser.add_argument('--expected-source',required=True,help='Current relative backend pointer or none for the first start')
    parser.add_argument('--prepared-schema-receipt',type=Path)
    args=parser.parse_args()
    try:
        expected=None if args.expected_source=='none' else args.expected_source
        if args.command=='plan':
            _,manifest=deployment.source_plan(args.archive,args.sha256)
            deployment.require(deployment.pointer(BASE/'account-service',optional=True)==expected,'Backend changed since plan')
            result={'kind':'melodiajest-account-plan','manifest':manifest,'expected':expected,'dataMigration':False}
        else:result=apply(args.archive,args.sha256,expected,args.prepared_schema_receipt)
        print(json.dumps(result,sort_keys=True))
    except Exception as error:
        print(json.dumps({'status':'failed','errorType':type(error).__name__,'message':str(error)[:500]}),file=sys.stderr);sys.exit(1)
