"""Exercise the real pinned Nginx config against a disposable Unix-socket upstream.

Linux-only explicit integration check; no production sockets, networks or data.
"""
import hashlib,http.client,http.server,json,os,pathlib,re,socket,socketserver,subprocess,tempfile,threading,time,unittest,urllib.parse,uuid


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=5)
        self.path=str(path)

    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout);self.sock.connect(self.path)


class Upstream(socketserver.UnixStreamServer):
    allow_reuse_address = False


class Response(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        scenario = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get('scenario', ['public'])[0]
        if scenario == 'disconnect':
            self.close_connection = True
            return
        status = 304 if scenario == 'not-modified' else 503 if scenario == 'public-error' else 200
        body = b'' if status == 304 else b'{"testFixture":"public-only"}\n'
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if scenario != 'missing-cache':
            cache = 'private, no-store' if scenario == 'private' else 'public, max-age=3600' if scenario == 'other-cache' else 'public, no-cache'
            self.send_header('Cache-Control', cache)
        self.send_header('ETag', 'W/"test-public-body"')
        self.send_header('Vary', 'Accept-Encoding')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class NginxCourseCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.name != 'posix':
            raise RuntimeError('This explicit integration test requires Linux Docker; do not silently skip it.')
        cls.image = os.environ['MELODIAJEST_NGINX_IMAGE']
        assert re.fullmatch(r'sha256:[0-9a-f]{64}', cls.image)
        cls.config = pathlib.Path(os.environ['MELODIAJEST_NGINX_CONFIG']).resolve(strict=True)
        assert cls.config.is_file() and cls.config.stat().st_size < 65536
        # Linux AF_UNIX paths are short; keep the disposable socket out of the
        # long immutable release path without touching the production socket.
        cls.tmp = tempfile.TemporaryDirectory(prefix='mj-nginx-128-')
        cls.home = pathlib.Path(cls.tmp.name).resolve();assert cls.home.parent == pathlib.Path(tempfile.gettempdir()).resolve() and cls.home.name.startswith('mj-nginx-128-')
        cls.sockets = cls.home / 'sockets';cls.sockets.mkdir(mode=0o755)
        cls.http = cls.home / 'http';cls.http.mkdir();cls.http.chmod(0o777)
        # Expose only an extra fixture Unix listener for the host HTTP client.
        # All production directives, including 8080 and cache policy, stay exact.
        raw=cls.config.read_bytes();needle=b'        listen 8080;';assert raw.count(needle)==1
        cls.test_config=cls.home/'test-nginx.conf';cls.test_config.write_bytes(raw.replace(needle,needle+b'\n        listen unix:/run/melodiajest-cache-test/http.sock;',1));cls.test_config.chmod(0o644)
        cls.server = Upstream(str(cls.sockets / 'api.sock'), Response);os.chmod(cls.sockets / 'api.sock', 0o666)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True);cls.thread.start()
        cls.name = 'melodiajest-nginx-cache-test-' + uuid.uuid4().hex[:12]
        try:
            args = ['docker','run','--detach','--name',cls.name,'--label','com.melodiajest.role=isolated-nginx-cache-test','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','101:101','--memory','64m','--cpus','0.25','--pids-limit','64','--tmpfs','/tmp:rw,noexec,nosuid,size=16m,mode=1777','--mount','type=bind,src='+str(cls.test_config)+',dst=/etc/nginx/nginx.conf,readonly','--mount','type=bind,src='+str(cls.sockets)+',dst=/run/melodiajest-account,readonly','--mount','type=bind,src='+str(cls.http)+',dst=/run/melodiajest-cache-test','--entrypoint','nginx',cls.image,'-g','daemon off;']
            subprocess.run(args, check=True, capture_output=True, text=True, timeout=20)
            state = json.loads(subprocess.check_output(['docker','inspect',cls.name], text=True))[0]
            assert state['HostConfig']['NetworkMode']=='none' and state['HostConfig']['ReadonlyRootfs'] and state['Config']['User']=='101:101'
            assert state['HostConfig']['Memory']==64*1024*1024 and state['HostConfig']['PidsLimit']==64 and state['HostConfig']['NanoCpus']==250000000
            assert not state['HostConfig']['PortBindings']
            assert {x['Source'] for x in state['Mounts'] if x['Type']=='bind'}=={str(cls.test_config),str(cls.sockets),str(cls.http)}
            for _ in range(20):
                connection=UnixConnection(cls.http/'http.sock')
                try:
                    connection.request('GET','/healthz');response=connection.getresponse();response.read()
                    if response.status==200:break
                except OSError:pass
                finally:connection.close()
                time.sleep(0.1)
            else:raise AssertionError('Isolated Nginx did not become ready')
            print('NGINX_FIXTURE '+json.dumps({'image':cls.image,'configSha256':hashlib.sha256(cls.config.read_bytes()).hexdigest(),'transport':'extra-fixture-Unix-listener-only;all-production-directives-exact','network':'none','memoryMiB':64,'cpus':0.25,'pids':64,'readOnly':True,'productionSocketMounted':False}),flush=True)
        except BaseException:
            cls.cleanup()
            raise

    @classmethod
    def cleanup(cls):
        info = subprocess.run(['docker','inspect',cls.name], capture_output=True, text=True, timeout=10)
        if info.returncode == 0:
            state = json.loads(info.stdout)[0];assert state['Config']['Labels'].get('com.melodiajest.role')=='isolated-nginx-cache-test'
            subprocess.run(['docker','stop','--time','3',cls.name], check=True, capture_output=True, timeout=10)
            subprocess.run(['docker','rm',cls.name], check=True, capture_output=True, timeout=10)
        cls.server.shutdown();cls.server.server_close();cls.thread.join(timeout=2)
        cls.tmp.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()

    def request(self, path, post=False):
        connection=UnixConnection(self.http/'http.sock')
        try:
            connection.request('POST' if post else 'GET',path,body=b'x' if post else None,headers={'Connection':'close'})
            response=connection.getresponse();body=response.read(65537);self.assertLessEqual(len(body),65536)
            values=[v for k,v in response.getheaders() if k.lower()=='cache-control'];self.assertEqual(len(values),1,response.getheaders())
            return response.status,values[0].strip(),body
        finally:connection.close()

    def check(self, path, status, cache='private, no-store', post=False):
        observed, policy, body = self.request(path, post=post)
        self.assertEqual(observed,status);self.assertEqual(policy,cache)
        return body

    def test_public_course_200(self):
        self.check('/api/service/v1/course',200,'public, no-cache')

    def test_public_course_304(self):
        self.assertEqual(self.check('/api/service/v1/course?scenario=not-modified',304,'public, no-cache'),b'')

    def test_public_course_query_preserves_public_contract(self):
        self.check('/api/service/v1/course?unrelated=value',200,'public, no-cache')

    def test_upstream_error_with_public_header_fails_closed(self):
        self.check('/api/service/v1/course?scenario=public-error',503)

    def test_missing_upstream_policy_fails_closed(self):
        self.check('/api/service/v1/course?scenario=missing-cache',200)

    def test_private_upstream_stays_private(self):
        self.check('/api/service/v1/course?scenario=private',200)

    def test_unexpected_public_policy_fails_closed(self):
        self.check('/api/service/v1/course?scenario=other-cache',200)

    def test_post_course_stays_private_even_with_public_upstream(self):
        self.check('/api/service/v1/course',200,post=True)

    def test_private_route_stays_private_even_with_public_upstream(self):
        self.check('/api/service/v1/learning/state',200)

    def test_case_changed_path_stays_private(self):
        self.check('/api/service/v1/COURSE',200)

    def test_trailing_slash_path_stays_private(self):
        self.check('/api/service/v1/course/',200)

    def test_real_upstream_disconnect_is_private_502(self):
        self.check('/api/service/v1/course?scenario=disconnect',502)

    def test_existing_health_cache_policy_unchanged(self):
        self.check('/healthz',200,'no-cache')


if __name__ == '__main__':
    unittest.main(verbosity=2)
