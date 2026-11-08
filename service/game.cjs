'use strict';
const {randomUUID}=require('node:crypto');
const S=require('./security.cjs'),V=require('./validation.cjs'),{hash}=require('./canonical.cjs');
const Ratings=require('../lesson-rating.js'),Experience=require('../portal-experience.js');
const {loadCourse}=require('./course.cjs'),{eventsInput,grade}=require('./game-grade.cjs');
const {check}=S;
function createGame(store,registry=loadCourse()){
  const q=store.statement,atomic=store.atomic,{course,byId,lesson,publicLesson}=registry;
  async function preferences(owner){const row=await q('SELECT * FROM learning_preferences WHERE user_id=?').get(owner);return row?{courseMode:row.course_mode,ratingSystem:row.rating_system,revision:row.revision}:{courseMode:'sequential',ratingSystem:'ten',revision:0};}
  async function operation(owner,kind,input,now,fn){
    V.operationId(input.operationId);const digest=hash({kind,input});
    return atomic(async()=>{
      const previous=await q('SELECT * FROM game_operation_receipts WHERE owner_id=? AND operation_id=?').get(owner,input.operationId);
      if(previous){check(previous.kind===kind&&previous.digest===digest,409,'OPERATION_CONFLICT','Операция уже выполнена с другим содержимым.');return JSON.parse(previous.response_raw);}
      check((await q('SELECT count(*) AS n FROM game_operation_receipts WHERE owner_id=?').get(owner)).n<30000,409,'HISTORY_LIMIT','Лимит истории операций достигнут. История сохранена; обратись в поддержку.');
      await gameQuota(owner);
      const response=await fn();await q('INSERT INTO game_operation_receipts VALUES(?,?,?,?,?,?)').run(owner,input.operationId,kind,digest,JSON.stringify(response),now);return response;
    },owner);
  }
  async function gameQuota(owner){
    const parts=[['learning_attempts','owner_id','result_raw'],['game_operation_receipts','owner_id','response_raw'],['discussion_comments','owner_id','body'],['discussion_comment_revisions','owner_id','body'],['lesson_rating_revisions','owner_id','raw_value']];let size=0;
    for(const [table,key,column]of parts){const row=await q('SELECT COALESCE(SUM(length(CAST('+column+' AS BLOB))),0) AS n FROM '+table+' WHERE '+key+'=?').get(owner);size+=Number(row.n);}
    check(size+32768<=25*1024*1024,409,'GAME_STORAGE_LIMIT','История обучения и обсуждений достигла 25 МБ. Она сохранена; обратись в поддержку для расширения.');
  }
  async function savePreferences(owner,input,now){
    S.exactFields(input,['courseMode','ratingSystem','expectedRevision','operationId']);V.revision(input.expectedRevision);
    check(['sequential','free'].includes(input.courseMode)&&Ratings.SYSTEMS.includes(input.ratingSystem),400,'LEARNING_PREFERENCES','Неизвестный режим курса или шкала оценок.');
    return operation(owner,'learning-preferences',input,now,async()=>{
      const old=await preferences(owner);check(old.revision===input.expectedRevision,409,'REVISION_CONFLICT','Настройки уже изменились. Обнови страницу.');
      await q('INSERT INTO learning_preferences VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET course_mode=excluded.course_mode,rating_system=excluded.rating_system,revision=excluded.revision,updated_at=excluded.updated_at').run(owner,input.courseMode,input.ratingSystem,old.revision+1,now);
      return preferences(owner);
    });
  }
  async function state(owner){
    const rows=await q('SELECT * FROM lesson_progress WHERE owner_id=? ORDER BY lesson_id,music_version').all(owner),passed=new Set(rows.filter(row=>byId.get(row.lesson_id)?.musicVersion===row.music_version).map(row=>row.lesson_id));
    const next=course.route.find(id=>!passed.has(id))||null;
    // A mutation calls state inside its transaction, which owns one pg client.
    // Queries on that client must be awaited, rather than dispatched together.
    const total=await q('SELECT COALESCE(SUM(delta),0) AS xp FROM experience_events WHERE owner_id=?').get(owner),prefs=await preferences(owner),cache=await q('SELECT * FROM portal_level_cache WHERE owner_id=?').get(owner);
    const xp=Number(total.xp);check(Number.isSafeInteger(xp)&&xp>=0,500,'EXPERIENCE_DATA','Не удалось подтвердить сумму опыта.');
    return {courseSha256:course.contentSha256,preferences:prefs,nextLessonId:next,completed:course.route.filter(id=>passed.has(id)).length,total:course.route.length,
      progress:rows.map(row=>({lessonId:row.lesson_id,musicVersion:row.music_version,firstPassedAt:row.first_passed_at,bestQuality:row.best_quality,cleanAttempts:row.clean_attempts,memoryPassedAt:row.memory_passed_at,updatedAt:row.updated_at})),
      experience:{musicXp:xp,musicLevel:Experience.level(xp),portal:cache?{status:'cached',totalXp:cache.total_xp,level:cache.level,checkedAt:cache.checked_at}:{status:'awaiting-sso-link',totalXp:null,level:null}}};
  }
  async function ratingsSummary(){const rows=await q('SELECT lesson_id,edition_version,SUM(canonical_units) AS total,count(*) AS n FROM lesson_ratings WHERE active=1 GROUP BY lesson_id,edition_version').all();return new Map(rows.filter(row=>byId.get(row.lesson_id)?.editionVersion===row.edition_version).map(row=>[row.lesson_id,Ratings.average(Number(row.total),row.n)]));}
  async function publicCourse(){const ratings=await ratingsSummary();return {version:1,policyVersion:1,sha256:course.contentSha256,counts:course.counts,route:course.route,lessons:course.lessons.map(row=>({...publicLesson(row),rating:ratings.get(row.id)||null}))};}
  function checkVersion(row,input){check(input.musicVersion===row.musicVersion&&input.editionVersion===row.editionVersion,409,'LESSON_CHANGED','Урок обновился. Перезагрузи его перед новой попыткой.');}
  async function start(owner,input,now){
    S.exactFields(input,['lessonId','musicVersion','editionVersion','mode','nonce','operationId']);
    const row=lesson(input.lessonId);check(row.challengeReady,409,'PRACTICE_ONLY','Этот материал пока доступен для практики без автоматического зачёта.');checkVersion(row,input);
    check(['challenge','memory'].includes(input.mode)&&typeof input.nonce==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.nonce),400,'ATTEMPT','Не указан режим или ключ попытки.');
    return operation(owner,'attempt-start',input,now,async()=>{
      const current=await state(owner),passed=new Set(current.progress.filter(x=>byId.get(x.lessonId)?.musicVersion===x.musicVersion).map(x=>x.lessonId));
      if(current.preferences.courseMode==='sequential'){
        const index=course.route.indexOf(row.id);check(index>=0&&course.route.slice(0,index).every(id=>passed.has(id))&&row.requires.every(id=>passed.has(id)),409,'LESSON_LOCKED','Сначала пройди предыдущий шаг и его подготовку.');
      }
      check((await q("SELECT count(*) AS n FROM learning_attempts WHERE owner_id=? AND status='issued' AND expires_at>?").get(owner,now)).n<3,409,'ATTEMPT_ACTIVE','Уже открыто три попытки. Закончи их или дождись окончания.');
      check((await q('SELECT count(*) AS n FROM learning_attempts WHERE owner_id=?').get(owner)).n<10000,409,'HISTORY_LIMIT','История попыток заполнена; она не удаляется автоматически.');
      await q('INSERT INTO course_editions VALUES(?,?,?,?) ON CONFLICT(lesson_id,music_version,edition_version) DO NOTHING').run(row.id,row.musicVersion,row.editionVersion,JSON.stringify(row));
      const id=randomUUID(),expiresAt=now+30*60000;
      await q("INSERT INTO learning_attempts(id,owner_id,lesson_id,music_version,edition_version,goal_key,policy_version,mode,bpm,nonce_hash,started_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'issued')").run(id,owner,row.id,row.musicVersion,row.editionVersion,row.goalKey,1,input.mode,row.bpm,S.sha(input.nonce),now,expiresAt);
      return {id,lessonId:row.id,musicVersion:row.musicVersion,editionVersion:row.editionVersion,bpm:row.bpm,mode:input.mode,startedAt:now,expiresAt,gradeFingerprint:row.gradeFingerprint};
    });
  }
  async function attempt(owner,id,now=Date.now()){const row=await q('SELECT * FROM learning_attempts WHERE id=? AND owner_id=?').get(id,owner);check(row,404,'ATTEMPT_NOT_FOUND','Попытка не найдена.');return {id:row.id,status:row.status,lessonId:row.lesson_id,musicVersion:row.music_version,editionVersion:row.edition_version,startedAt:row.started_at,expiresAt:row.expires_at,serverTime:now,result:row.result_raw?JSON.parse(row.result_raw):null};}
  async function submit(owner,id,input,now){
    S.exactFields(input,['nonce','events','observedUntil','observationInterrupted']);
    check(typeof input.observationInterrupted==='boolean',400,'OBSERVATION','Не указан статус наблюдения MIDI.');
    const events=eventsInput(input.events,input.observedUntil),digest=hash(input);
    return atomic(async()=>{
      const row=await q('SELECT * FROM learning_attempts WHERE id=? AND owner_id=?').get(id,owner);check(row,404,'ATTEMPT_NOT_FOUND','Попытка не найдена.');
      check(S.constantEqual(S.sha(typeof input.nonce==='string'?input.nonce:''),row.nonce_hash),403,'ATTEMPT_KEY','Не совпал ключ попытки.');
      if(row.status!=='issued'){check(row.request_digest===digest,409,'ATTEMPT_SUBMITTED','Эта попытка уже отправлена с другой записью.');return JSON.parse(row.result_raw);}
      await gameQuota(owner);
      check(now<=row.expires_at&&now>=row.started_at&&input.observedUntil<=now-row.started_at+1500,409,'ATTEMPT_TIME','Попытка истекла или запись длиннее доступного времени.');
      const saved=await q('SELECT plan_raw FROM course_editions WHERE lesson_id=? AND music_version=? AND edition_version=?').get(row.lesson_id,row.music_version,row.edition_version);check(saved,500,'EDITION_MISSING','Не найдена редакция попытки.');
      const plan=JSON.parse(saved.plan_raw),graded=grade(plan,events,row.mode,input.observedUntil,input.observationInterrupted),clean=graded.assessment.clean;
      const wanted=Experience.award({clean,quality:graded.quality}),oldGoal=await q('SELECT MAX(best_xp) AS best FROM goal_experience WHERE owner_id=? AND goal_key=?').get(owner,row.goal_key),reward=Experience.improvement(oldGoal?.best||0,wanted);
      if(clean){
        await q('INSERT INTO lesson_progress VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,lesson_id,music_version) DO UPDATE SET best_quality=CASE WHEN lesson_progress.best_quality>excluded.best_quality THEN lesson_progress.best_quality ELSE excluded.best_quality END,clean_attempts=lesson_progress.clean_attempts+1,memory_passed_at=COALESCE(lesson_progress.memory_passed_at,excluded.memory_passed_at),updated_at=excluded.updated_at').run(owner,row.lesson_id,row.music_version,now,graded.quality,1,row.mode==='memory'?now:null,now);
        await q('INSERT INTO goal_experience VALUES(?,?,?,?,?) ON CONFLICT(owner_id,goal_key,policy_version) DO UPDATE SET best_xp=excluded.best_xp,updated_at=excluded.updated_at').run(owner,row.goal_key,row.policy_version,reward.best,now);
      }
      if(reward.delta>0){
        await q('INSERT INTO experience_events VALUES(?,?,?,?,?,?)').run(randomUUID(),owner,id,row.goal_key,reward.delta,now);
        await q('INSERT INTO portal_experience_outbox(owner_id,goal_key,policy_version,best_xp,revision,updated_at) VALUES(?,?,?,?,1,?) ON CONFLICT(owner_id,goal_key,policy_version) DO UPDATE SET best_xp=excluded.best_xp,revision=portal_experience_outbox.revision+1,updated_at=excluded.updated_at').run(owner,row.goal_key,row.policy_version,reward.best,now);
      }
      const current=await state(owner),result={attemptId:id,lessonId:row.lesson_id,musicVersion:row.music_version,editionVersion:row.edition_version,passed:clean,assessment:graded.assessment,metrics:graded.metrics,quality:graded.quality,xp:{earned:reward.delta,bestForGoal:reward.best,musicTotal:current.experience.musicXp,musicLevel:current.experience.musicLevel,levelUp:current.experience.musicLevel.level>Experience.level(current.experience.musicXp-reward.delta).level,portalStatus:current.experience.portal.status},nextLessonId:current.nextLessonId,savedAt:now};
      // Retain the immutable edition, result, digest and bounded diagnostics;
      // raw MIDI is private and not accumulated in every historical attempt.
      await q('UPDATE learning_attempts SET submitted_at=?,request_digest=?,result_raw=?,events_raw=?,status=?,awarded_xp=? WHERE id=? AND owner_id=?').run(now,digest,JSON.stringify(result),JSON.stringify({sha256:hash(events),count:events.length,observedUntil:input.observedUntil,interrupted:input.observationInterrupted}),clean?'passed':'failed',reward.delta,id,owner);
      return result;
    },owner);
  }
  async function cancel(owner,id,input,now){
    S.exactFields(input,['nonce']);return atomic(async()=>{
      const row=await q('SELECT * FROM learning_attempts WHERE id=? AND owner_id=?').get(id,owner);check(row,404,'ATTEMPT_NOT_FOUND','Попытка не найдена.');check(S.constantEqual(S.sha(typeof input.nonce==='string'?input.nonce:''),row.nonce_hash),403,'ATTEMPT_KEY','Не совпал ключ попытки.');
      if(row.status!=='issued')return attempt(owner,id);
      const result={attemptId:id,lessonId:row.lesson_id,musicVersion:row.music_version,editionVersion:row.edition_version,passed:false,cancelled:true,xp:{earned:0},savedAt:now};
      await q("UPDATE learning_attempts SET status='failed',submitted_at=?,request_digest=?,result_raw=? WHERE id=? AND owner_id=?").run(now,hash({cancelled:true}),JSON.stringify(result),id,owner);return attempt(owner,id);
    },owner);
  }
  async function rating(owner,id){const row=lesson(id),saved=await q('SELECT * FROM lesson_ratings WHERE owner_id=? AND lesson_id=? AND edition_version=?').get(owner,id,row.editionVersion);return {lessonId:id,editionVersion:row.editionVersion,revision:saved?.revision||0,rating:saved?.active?{system:saved.system,value:JSON.parse(saved.raw_value),canonicalUnits:saved.canonical_units}:null};}
  async function saveRating(owner,id,input,now){
    const row=lesson(id);S.exactFields(input,['editionVersion','system','value','expectedRevision','operationId']);V.revision(input.expectedRevision);check(input.editionVersion===row.editionVersion,409,'LESSON_CHANGED','Редакция урока изменилась. Обнови её перед оценкой.');
    const record=input.value===null?null:Ratings.record(input.system,input.value);
    check(Ratings.SYSTEMS.includes(input.system)&&(input.value===null||record!==null),400,'RATING','Оценка не соответствует выбранной шкале.');
    return operation(owner,'rating:'+id,input,now,async()=>{
      const old=await rating(owner,id);check(old.revision===input.expectedRevision,409,'REVISION_CONFLICT','Оценка уже изменилась в другой вкладке.');const revision=old.revision+1;
      await q('INSERT INTO lesson_ratings VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,lesson_id,edition_version) DO UPDATE SET system=excluded.system,raw_value=excluded.raw_value,canonical_units=excluded.canonical_units,revision=excluded.revision,updated_at=excluded.updated_at,active=excluded.active').run(owner,id,row.editionVersion,input.system,JSON.stringify(record?.value??null),record?.canonicalUnits??0,revision,now,now,record?1:0);
      await q('INSERT INTO lesson_rating_revisions VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),owner,id,row.editionVersion,record?JSON.stringify(record):null,record?.canonicalUnits??null,revision,now);
      return {...await rating(owner,id),average:(await ratingsSummary()).get(id)||null};
    });
  }
  function scopeInput(scope,lessonId){check(scope==='global'||scope==='lesson',400,'COMMENT_SCOPE','Неизвестное обсуждение.');if(scope==='global'){check(!lessonId,400,'COMMENT_SCOPE','Общее обсуждение не относится к уроку.');return '';}lesson(lessonId);return lessonId;}
  function commentDto(row,owner){return {id:row.id,scope:row.scope,lessonId:row.lesson_id||null,editionVersion:row.edition_version,parentId:row.parent_id,author:row.display_name,body:row.deleted?'Комментарий удалён автором.':row.body,deleted:Boolean(row.deleted),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,mine:row.owner_id===owner};}
  async function comments(scope,id,cursor,owner){
    id=scopeInput(scope,id);let after={at:0,id:''};
    if(cursor){try{after=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{check(false,400,'PAGE','Некорректная страница обсуждения.');}check(Number.isSafeInteger(after.at)&&after.at>=0&&typeof after.id==='string'&&after.id.length<=36,400,'PAGE','Некорректная страница.');}
    const rows=await q('SELECT c.*,u.display_name FROM discussion_comments c JOIN users u ON u.id=c.owner_id WHERE c.scope=? AND c.lesson_id=? AND (c.created_at>? OR (c.created_at=? AND c.id>?)) ORDER BY c.created_at,c.id LIMIT 21').all(scope,id,after.at,after.at,after.id),items=rows.slice(0,20),last=items.at(-1);
    return {items:items.map(row=>commentDto(row,owner)),nextCursor:rows.length>20?Buffer.from(JSON.stringify({at:last.created_at,id:last.id})).toString('base64url'):null};
  }
  function commentBody(value){V.text(value,4000,1);check(value.trim().length>0&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),400,'COMMENT_BODY','Напиши текст комментария.');return value.trim();}
  async function createComment(owner,input,now){
    S.exactFields(input,['scope','lessonId','parentId','body','operationId']);const id=scopeInput(input.scope,input.lessonId),body=commentBody(input.body);if(input.parentId!==null)V.operationId(input.parentId);
    return operation(owner,'comment-create',input,now,async()=>{
      check((await q('SELECT count(*) AS n FROM discussion_comments WHERE owner_id=?').get(owner)).n<500,409,'COMMENT_LIMIT','Достигнут лимит комментариев первой версии.');
      if(input.parentId){const parent=await q('SELECT scope,lesson_id FROM discussion_comments WHERE id=?').get(input.parentId);check(parent&&parent.scope===input.scope&&parent.lesson_id===id,400,'COMMENT_PARENT','Ответ относится к другому обсуждению.');}
      const commentId=randomUUID(),edition=id?lesson(id).editionVersion:null;
      await q('INSERT INTO discussion_comments VALUES(?,?,?,?,?,?,?,1,?,?,0)').run(commentId,owner,input.scope,id,edition,input.parentId,body,now,now);
      await q('INSERT INTO discussion_comment_revisions VALUES(?,?,?,?,1,0,?)').run(randomUUID(),commentId,owner,body,now);
      const row=await q('SELECT c.*,u.display_name FROM discussion_comments c JOIN users u ON u.id=c.owner_id WHERE c.id=?').get(commentId);return commentDto(row,owner);
    });
  }
  async function updateComment(owner,id,input,now){
    S.exactFields(input,['body','deleted','expectedRevision','operationId']);V.revision(input.expectedRevision);check(typeof input.deleted==='boolean',400,'COMMENT_BODY','Не указан статус комментария.');const body=input.deleted?'':commentBody(input.body);
    return operation(owner,'comment-update:'+id,input,now,async()=>{
      const row=await q('SELECT c.*,u.display_name FROM discussion_comments c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.owner_id=?').get(id,owner);check(row,404,'COMMENT_NOT_FOUND','Комментарий не найден.');check(row.revision===input.expectedRevision,409,'REVISION_CONFLICT','Комментарий уже изменился.');check(!row.deleted,409,'COMMENT_DELETED','Удалённый комментарий остаётся в истории.');
      const revision=row.revision+1;await q('UPDATE discussion_comments SET body=?,revision=?,updated_at=?,deleted=? WHERE id=? AND owner_id=?').run(body,revision,now,input.deleted?1:0,id,owner);
      await q('INSERT INTO discussion_comment_revisions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,owner,body,revision,input.deleted?1:0,now);
      return commentDto({...row,body,revision,updated_at:now,deleted:input.deleted?1:0},owner);
    });
  }
  async function history(owner){const rows=await q('SELECT id,lesson_id,music_version,edition_version,status,started_at,submitted_at,result_raw FROM learning_attempts WHERE owner_id=? ORDER BY started_at DESC,id LIMIT 50').all(owner);return {items:rows.map(row=>({id:row.id,lessonId:row.lesson_id,musicVersion:row.music_version,editionVersion:row.edition_version,status:row.status,startedAt:row.started_at,submittedAt:row.submitted_at,result:row.result_raw?JSON.parse(row.result_raw):null}))};}
  return {course,registry,preferences,savePreferences,publicCourse,state,start,submit,cancel,attempt,rating,saveRating,comments,createComment,updateComment,history};
}
module.exports={createGame};
