'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{makeWebServer}=require('../tools/serve-web.cjs');
const port=Number(process.argv[2]),guest=process.argv.includes('--guest');if(![63410,63411].includes(port))throw Error('Only phase57 loopback ports allowed');
const course=JSON.parse(fs.readFileSync('service/course-registry.json','utf8')),objects=new Map([['preferences',{revision:0,raw:null}],['catalog',{revision:0,raw:null}]]),staticServer=makeWebServer({root:path.resolve('dist/web')});
const account={id:'00000000-0000-4000-8000-000000000057',username:'local_status_qa',displayName:'Изолированная проверка'};let rejected=false;
const server=http.createServer(async(req,res)=>{
 if(!req.url.startsWith('/api/service/v1/'))return staticServer.emit('request',req,res);
 const route=new URL(req.url,'http://127.0.0.1').pathname.slice('/api/service/v1'.length),send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method==='GET'&&route==='/session')return send(200,{user:guest?null:account,csrfToken:'loopback-fixture-only'});
 if(req.method==='GET'&&route==='/course')return send(200,course);
 if(req.method==='GET'&&route==='/learning/state')return send(200,{courseSha256:course.contentSha256,preferences:{courseMode:'free',ratingSystem:'ten',revision:0},nextLessonId:course.route[0],completed:0,total:course.route.length,progress:[],experience:{musicXp:0,portal:{status:'awaiting-sso-link',totalXp:null,level:null,checkedAt:null}}});
 if(objects.has(route.slice(1))){const kind=route.slice(1),old=objects.get(kind);if(req.method==='GET')return send(200,old);if(req.method==='PUT'){
  if(guest)return send(401,{error:{code:'SIGN_IN_REQUIRED',message:'Войди, чтобы сохранить личные изменения.'}});
  let body='';for await(const part of req)body+=part;if(body.length>2000000)return send(413,{error:{code:'FIXTURE_LIMIT',message:'Fixture limit'}});const input=JSON.parse(body);
  await new Promise(resolve=>setTimeout(resolve,3500));
  const preference=kind==='preferences'&&typeof input.raw==='string'?JSON.parse(input.raw):null;
  if(preference?.learningMaterialMode==='hidden'&&!rejected){rejected=true;console.log(JSON.stringify({qa:'synthetic-preferences-error',status:503,trigger:'explicit-hidden-selection',productionDataUsed:false}));return send(503,{error:{code:'QA_TEMPORARY_FAILURE',message:'Не удалось сохранить настройки. Попробуй ещё раз.'}});}
  if(input.expectedRevision!==old.revision)return send(409,{error:{code:'REVISION_CONFLICT',message:'Fixture conflict'}});const saved={revision:old.revision+1,raw:input.raw};objects.set(kind,saved);console.log(JSON.stringify({qa:'synthetic-save-confirmed',kind,revision:saved.revision,productionDataUsed:false}));return send(200,saved);
 }}
 if(req.method==='GET'&&route==='/comments')return send(200,{items:[],nextCursor:null});
 return send(501,{error:{code:'QA_FIXTURE_ONLY',message:'Only local message/settings QA; no performance is accepted.'}});
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port,guest,syntheticAccount:true,productionDataUsed:false,exactStaticBuild:true})));
