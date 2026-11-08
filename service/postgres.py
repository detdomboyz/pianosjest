"""Own PostgreSQL configuration and bounded maintenance. No foreign DB access."""
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent.parent
PIN=json.loads((ROOT/'service/postgres-runtime.json').read_text(encoding='utf-8'))
BASE=Path('/opt/melodiajest')
CONTAINER='melodiajest-postgres-1'
SOCKET='/run/melodiajest-postgres'


def compose():
    mounts=[{'type':'bind','source':(BASE/'postgres-data').as_posix(),'target':'/var/lib/postgresql'},
            {'type':'bind','source':SOCKET,'target':SOCKET},
            {'type':'bind','source':(BASE/'deploy/postgres-config').as_posix(),'target':'/etc/melodiajest-postgres','read_only':True},
            {'type':'bind','source':(BASE/'ops/secrets/postgres-bootstrap').as_posix(),'target':'/run/secrets/melodiajest-bootstrap','read_only':True}]
    service={'image':PIN['imageId'],'container_name':CONTAINER,'labels':{'com.melodiajest.role':'postgres'},'network_mode':'none','restart':'unless-stopped',
             'user':'999:999','read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'mem_limit':'512m','cpus':0.5,'pids_limit':128,'shm_size':'64m','stop_grace_period':'30s',
             'tmpfs':['/tmp:rw,mode=1777,size=16m','/var/run/postgresql:rw,uid=999,gid=999,mode=2775,size=4m'],
             'environment':{'POSTGRES_USER':'melodiajest_admin','POSTGRES_DB':'melodiajest','POSTGRES_PASSWORD_FILE':'/run/secrets/melodiajest-bootstrap','POSTGRES_INITDB_ARGS':'--locale=C.UTF-8 --encoding=UTF8 --auth-local=peer --auth-host=scram-sha-256'},
             'volumes':mounts,'command':['postgres','-c','config_file=/etc/melodiajest-postgres/postgresql.conf']}
    return json.dumps({'name':'melodiajest-data','services':{'melodiajest-postgres':service}},sort_keys=True,indent=2)+'\n'


def configuration():
    return {'postgresql.conf':"""data_directory = '/var/lib/postgresql/18/docker'
hba_file = '/etc/melodiajest-postgres/pg_hba.conf'
ident_file = '/etc/melodiajest-postgres/pg_ident.conf'
listen_addresses = ''
unix_socket_directories = '/var/run/postgresql,/run/melodiajest-postgres'
unix_socket_permissions = 0777
password_encryption = 'scram-sha-256'
max_connections = 24
shared_buffers = '64MB'
work_mem = '2MB'
maintenance_work_mem = '32MB'
max_wal_size = '128MB'
min_wal_size = '32MB'
statement_timeout = '20s'
idle_in_transaction_session_timeout = '5min'
log_statement = 'none'
log_min_error_statement = 'panic'
log_connections = 'off'
log_disconnections = 'off'
log_line_prefix = '%m [%p] '
fsync = on
full_page_writes = on
synchronous_commit = on
""",'pg_hba.conf':"""# No TCP listener. Maintenance identities apply only inside our own cluster.
local all melodiajest_admin peer map=melodiajest_maintenance
local melodiajest melodiajest_owner peer map=melodiajest_owner
local melodiajest melodiajest_api scram-sha-256
local all all reject
host all all 0.0.0.0/0 reject
host all all ::/0 reject
""",'pg_ident.conf':"""melodiajest_maintenance postgres melodiajest_admin
melodiajest_maintenance root melodiajest_admin
melodiajest_owner postgres melodiajest_owner
melodiajest_owner root melodiajest_owner
"""}


def client_configuration():
    return {'kind':'melodiajest-postgres-v1','host':SOCKET,'port':5432,'database':'melodiajest','user':'melodiajest_api','passwordFile':(BASE/'account-data/postgres-password').as_posix()}


def verify_container(name=CONTAINER):
    if not (name==CONTAINER or re.fullmatch(r'melodiajest-pg-restore-[a-f0-9]{12}',name)):
        raise ValueError('Unexpected own PostgreSQL container')
    observed=json.loads(subprocess.check_output(['docker','inspect',name],text=True,timeout=10))[0]
    expected='postgres' if name==CONTAINER else 'postgres-restore'
    if observed['Image']!=PIN['imageId'] or observed['Config']['Labels'].get('com.melodiajest.role')!=expected or observed['HostConfig']['NetworkMode']!='none':
        raise ValueError('Own PostgreSQL identity/network differs')
    if name==CONTAINER:
        if not any(item['Source']==(BASE/'postgres-data').as_posix() and item['Destination']=='/var/lib/postgresql' for item in observed['Mounts']):raise ValueError('Own data binding differs')
    else:
        for item in observed['Mounts']:
            source=Path(item['Source'])
            if item['Type']=='bind' and (not source.is_relative_to(BASE/'account-restore-work') or source.resolve()!=source):raise ValueError('Restore container mounts production/outside paths')
    return observed


def sql(text,*,role='melodiajest_admin',database='postgres',container=CONTAINER):
    verify_container(container)
    if role not in {'melodiajest_admin','melodiajest_owner'} or database not in {'postgres','melodiajest'}:raise ValueError('Unexpected own maintenance target')
    result=subprocess.run(['docker','exec','--user','postgres','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-h',SOCKET,'-U',role,'-d',database],input=text,text=True,capture_output=True,timeout=120)
    if result.returncode:raise RuntimeError('Own PostgreSQL maintenance failed; exit '+str(result.returncode))
    return result.stdout


def prepare_roles(password,*,container=CONTAINER):
    if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}',password):raise ValueError('Invalid own database password')
    # Password never appears in process arguments, receipts or logs.
    sql("BEGIN;\nCREATE ROLE melodiajest_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n"
        "CREATE ROLE melodiajest_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 8 PASSWORD '"+password+"';\n"
        "ALTER DATABASE melodiajest OWNER TO melodiajest_owner;\nREVOKE ALL ON DATABASE melodiajest FROM PUBLIC;\nGRANT CONNECT ON DATABASE melodiajest TO melodiajest_api;\nCOMMIT;\n",container=container)


def grants(*,container=CONTAINER):
    return sql("REVOKE ALL ON SCHEMA public FROM PUBLIC;\nGRANT USAGE ON SCHEMA public TO melodiajest_api;\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO melodiajest_api;\nALTER DEFAULT PRIVILEGES FOR ROLE melodiajest_owner IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO melodiajest_api;\n",role='melodiajest_owner',database='melodiajest',container=container)


def wait(container=CONTAINER):
    verify_container(container)
    for attempt in range(150):
        # initdb's temporary postmaster also answers pg_isready. Wait for the
        # entrypoint to exec the final server, then authenticate maintenance.
        process=subprocess.run(['docker','exec','--user','postgres',container,'readlink','/proc/1/exe'],capture_output=True,text=True,timeout=5)
        if process.returncode==0 and process.stdout.strip().endswith('/bin/postgres'):
            result=subprocess.run(['docker','exec','--user','postgres',container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-h',SOCKET,'-U','melodiajest_admin','-d','postgres','-c','SELECT 1'],capture_output=True,text=True,timeout=5)
            if result.returncode==0 and result.stdout.strip()=='1':return {'ready':True,'network':'none','tcpListening':False,'finalPostmasterAuthenticated':True}
        time.sleep(.2)
    raise RuntimeError('Own PostgreSQL did not become ready')


def unit(tooling):
    if not re.fullmatch(r'/opt/melodiajest/ops/tooling/account-[a-f0-9]{16}',str(tooling)):raise ValueError('Own versioned tooling required')
    return f'''[Unit]
Description=MelodiaJest isolated PostgreSQL
Requires=docker.service
After=docker.service local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=DOCKER_HOST=unix:///var/run/docker.sock DOCKER_CONFIG=/opt/melodiajest/ops/docker-client PYTHONDONTWRITEBYTECODE=1
ExecStartPre=/usr/bin/install -d -o 999 -g 999 -m 0755 {SOCKET}
ExecStart=/usr/bin/docker compose --project-name melodiajest-data -f /opt/melodiajest/deploy/postgres.compose.yaml up -d --no-deps --no-build --pull never melodiajest-postgres
ExecStartPost=/usr/bin/python3 -B {tooling}/service/postgres.py wait
ExecStop=/usr/bin/docker compose --project-name melodiajest-data -f /opt/melodiajest/deploy/postgres.compose.yaml stop melodiajest-postgres
TimeoutStartSec=90s
TimeoutStopSec=45s

[Install]
WantedBy=multi-user.target
'''


if __name__=='__main__':
    if sys.argv[1:]!=['wait']:raise SystemExit('Usage: postgres.py wait')
    print(json.dumps(wait()))
