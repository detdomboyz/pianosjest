import datetime,gzip,hashlib,http.client,json,runpy,ssl,time
from pathlib import Path
ROOT=Path.cwd();manifest_raw=(ROOT/'dist/web/web-release.json').read_bytes();manifest=json.loads(manifest_raw)
assert manifest['version']=='23.5.38'
assert hashlib.sha256(manifest_raw).hexdigest()=='6a4a36d988c0ca9d716fe03b859d7a2363427562cc5ba76422ed86dfc78cd9cd'
helper=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py');ssh=helper['ssh_command']()
binding=(ssh[ssh.index('-b')+1],0) if '-b' in ssh else None
ctx=ssl.create_default_context();assert ctx.check_hostname and ctx.verify_mode==ssl.CERT_REQUIRED
HOST='melodiajest.ru';ASSETS={'/index.html':'index.html','/piano-lesson-development.js':'piano-lesson-development.js','/curriculum-plan.js':'curriculum-plan.js'}
REQUEST_CAP=16;BODY_CAP=4*1024*1024;request_count=0;wire_bytes=0;rows=[]
def request(path,method='GET',encoding='gzip',etag=None):
 global request_count,wire_bytes
 assert path in set(ASSETS)|{'/web-release.json'} and method in ['GET','HEAD'] and encoding in ['gzip','identity']
 assert request_count<REQUEST_CAP
 request_count+=1
 conn=http.client.HTTPSConnection(HOST,443,timeout=12,context=ctx,source_address=binding)
 headers={'Accept-Encoding':encoding,'User-Agent':'MelodiaJest-controlled-baseline/1','Connection':'close'}
 if etag:headers['If-None-Match']=etag
 try:
  start=time.perf_counter();conn.connect();connected=time.perf_counter();peer=conn.sock.getpeername()[0]
  conn.request(method,path,headers=headers);response=conn.getresponse();received=time.perf_counter()
  body=response.read(min(2*1024*1024,BODY_CAP-wire_bytes)+1);done=time.perf_counter();wire_bytes+=len(body);assert wire_bytes<=BODY_CAP
  h={key:response.getheader(key) for key in ['Content-Type','Content-Encoding','Content-Length','ETag','Last-Modified','Cache-Control','Vary','Date']}
  assert response.status in [200,304],(path,response.status)
  if method=='HEAD' or response.status==304:assert not body;decoded=b''
  else:
   assert h['Content-Encoding'] in [None,'gzip'];decoded=gzip.decompress(body) if h['Content-Encoding']=='gzip' else body
   expected=manifest_raw if path=='/web-release.json' else (ROOT/'dist/web'/ASSETS[path]).read_bytes()
   assert hashlib.sha256(decoded).digest()==hashlib.sha256(expected).digest(),path
  row={'path':path,'method':method,'acceptEncoding':encoding,'conditional':etag is not None,'status':response.status,'httpVersion':response.version,'connectDnsTcpTlsMs':(connected-start)*1000,'responseHeadersAfterConnectMs':(received-connected)*1000,'bodyReadMs':(done-received)*1000,'totalMs':(done-start)*1000,'responseBodyBytes':len(body),'decodedBytes':len(decoded),'peerAddress':peer,'headers':h,'decodedSha256':hashlib.sha256(decoded).hexdigest() if decoded else None}
  rows.append(row);return row
 finally:conn.close()
request('/web-release.json',encoding='identity')
for path,name in ASSETS.items():
 head=request(path,method='HEAD',encoding='identity')
 assert int(head['headers']['Content-Length'])==manifest['files'][name]['bytes'],path
 first=request(path)
 if first['headers']['ETag']:request(path,etag=first['headers']['ETag'])
 if path!='/curriculum-plan.js':
  request(path);request(path)
assert request_count<=REQUEST_CAP
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'version':manifest['version'],'manifestSha256':hashlib.sha256(manifest_raw).hexdigest(),'origin':'Windows desktop; fresh HTTPS HTTP/1.1 connections bound to the established Ethernet source','scope':'Three selected public assets and one manifest only; no full asset sweep, no archives, no S3 or browser storage','tlsCertificateVerified':True,'redirectsFollowed':False,'requests':request_count,'requestCap':REQUEST_CAP,'responseBodyBytes':wire_bytes,'responseBodyByteCap':BODY_CAP,'rows':rows,'s3RequestsInProbe':0,'providerBillRetrieved':False,'unitCosts':None,'costCountersExcludeHeadersTlsTcpAndOtherChats':True,'realBrowserPageTiming':False,'serverOrDnsChanged':False}
out=ROOT/'tmp/melodiajest-11-network.json'
with out.open('x',encoding='utf-8') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'output':str(out),'requests':request_count,'responseBodyBytes':wire_bytes,'gzipBodies':sum(x['headers']['Content-Encoding']=='gzip' and x['status']==200 and x['method']=='GET' for x in rows),'conditional304':sum(x['status']==304 for x in rows)}))
