const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const GameManager = require('../server/game/GameManager');
const config = require('../shared/game-config');
const map = require('../data/maps/wedding-final-showdown.json');
const url = process.env.SERVER_URL || 'http://127.0.0.1:3000';
const out = path.resolve(process.env.AUDIT_OUTPUT || 'reports/art-audit');
const gm = new GameManager({emit(){}});
for(let i=0;i<150;i++) {
  gm.teamManager.addPlayer(`qa${i}`,i===0?'今天特別來祝福阿平小聶的好朋友':`婚禮賓客${String(i+1).padStart(3,'0')}`,'🥳');
  gm.teamManager.chooseTeam(`qa${i}`,config.TEAMS[i%5].id);
  const s=gm.getOrCreatePlayerStats(`qa${i}`);
  Object.assign(s,{tapCount:1200-i,correctCount:18-i%19,wrongCount:i%15,answeredCount:18,answerTimedCount:18,answerTimeTotalMs:18000+i*100});
}
config.TEAMS.forEach((t,i)=>{gm.teamManager.teams[t.id].position=14000+i*1700;});
const base=gm.getGameState();
gm.roundManager.recordRoundWinner('purple');
const finished={...gm.getGameState(),state:'MATCH_FINISHED',finalWinner:'purple',finalAwards:gm.buildFinalAwardsPayload()};
gm.stopGameLoop();
const quizzes=['wedding-couples','fun-trivia','wedding-party'].flatMap(name=>{
  const candidate=path.resolve(`data/quizzes/${name}.json`);
  return fs.existsSync(candidate)?JSON.parse(fs.readFileSync(candidate)).quizzes:[];
});
const results=Object.fromEntries(config.TEAMS.map((t,i)=>[t.id,{answers:[true,i>0,i>2],correctCount:i>2?3:i>0?2:1,steps:i>2?4:i>0?2:1,
  beforePosition:14000,position:14000+(i>2?6000:i>0?3000:1500),isCorrect:i>1,teamAnswer:i>1?'A':'B',voteCounts:{A:18,B:12},effect:'stage_pending',val:0}]));
const reveal={correctAnswer:'A',correctAnswerText:'一起祝福新人，留下今天最開心的回憶',teamResults:results};
const metrics=[], errors=[];
async function send(page,name,data){await page.evaluate(({name,data})=>window.qaReceive(name,data),{name,data});}
async function snap(page,label,wait=200){
  await page.waitForTimeout(wait);
  await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,4000))]));
  const data=await page.evaluate(()=>{
    const leaves=[...document.querySelectorAll('h1,h2,h3,h4,p,span,strong,button,label,small,a,input,.effect-badge')].filter(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none'&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;
    }).map(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      let p=el,bg='',complex=false;
      while(p){const cs=getComputedStyle(p);if(cs.backgroundImage!=='none')complex=true;
        if(cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent'){bg=cs.backgroundColor;break;}p=p.parentElement;}
      return {id:el.id,cls:typeof el.className==='string'?el.className:'',text:(el.value||el.innerText||'').slice(0,160),font:parseFloat(s.fontSize),color:s.color,bg,complex,
        rect:{x:r.x,y:r.y,w:r.width,h:r.height},scale:el.offsetHeight?r.height/el.offsetHeight:1,
        overflow:el.scrollWidth>el.clientWidth+2};
    });
    const images=[...document.images].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.top<innerHeight&&r.bottom>0;})
      .map(el=>({src:el.getAttribute('src'),loaded:el.complete&&el.naturalWidth>0}));
    return {width:innerWidth,height:innerHeight,fonts:document.fonts.status,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,leaves,images};
  });
  data.failures = await page.evaluate(label => {
    const failures = [];
    const checkBounds = selector => document.querySelectorAll(selector).forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1)
        failures.push(`outside viewport: ${el.id || el.className}`);
      if (el.scrollWidth > el.clientWidth + 2) failures.push(`text overflow: ${el.id || el.className}`);
    });
    if (/guest-(login|name-error)-/.test(label)) checkBounds('#screen-login h1, #input-nickname, .avatar-opt, #btn-join, #login-error');
    if (/guest-(question|correct|team-answer)-/.test(label)) checkBounds('.quiz-top, .opt-btn, #quiz-lock-msg');
    if (/host-award-/.test(label)) {
      checkBounds('#award-congrats, #award-description, #award-winner-identity');
      const congrats = document.querySelector('#award-congrats').getBoundingClientRect();
      const description = document.querySelector('#award-description').getBoundingClientRect();
      const card = document.querySelector('#award-current-card').getBoundingClientRect();
      if (congrats.bottom > description.top + 1 || description.bottom > card.bottom) failures.push('award text collision');
    }
    if (/host-question-/.test(label)) {
      checkBounds('.quiz-option-card-v2, #quiz-question-box, #quiz-countdown-circle');
      const bar = document.querySelector('#quiz-team-bar').getBoundingClientRect();
      const clock = document.querySelector('.stage-clock').getBoundingClientRect();
      if (clock.bottom > bar.top) failures.push('stage clock covers teams');
    }
    if (label.startsWith('admin-')) {
      for (const el of document.querySelectorAll('.tab-pane.active input, .tab-pane.active select, .tab-pane.active textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.left < -1 || r.right > innerWidth + 1)) failures.push(`admin horizontal crop: ${el.id}`);
      }
      if (label.includes('quiz') && document.querySelector('#quizTriggerFrequency').value !== '8') failures.push('tap time differs from config');
    }
    return failures;
  }, label);
  await page.screenshot({path:path.join(out,`${label}.png`)});
  metrics.push({label,...data});
  console.log('Captured',label);
}
async function mock(page){
  await page.route('**/socket.io/socket.io.js',r=>r.fulfill({contentType:'text/javascript',body:`
    window.qaHandlers={};window.qaSent=[];window.qaReceive=(n,d)=>(qaHandlers[n]||[]).forEach(f=>f(d));
    window.io=()=>({id:'qa0',connected:true,on(n,f){(qaHandlers[n]||=[]).push(f);},emit(n,d){qaSent.push({n,d});},connect(){setTimeout(()=>qaReceive('connect'),0);}});
  `}));
  page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));
}
async function host(context,size){
  const page=await context.newPage();await mock(page);await page.setViewportSize(size);
  await page.goto(`${url}/host/`);await page.waitForFunction(()=>window.qaHandlers?.['game:state_sync']);
  const suffix=size.width;
  for(const stage of ['lobby','rules','team-select']){
    await send(page,'game:state_sync',{...base,state:'LOBBY',presentation:{stage},serverNow:Date.now()});
    await snap(page,`host-${stage}-${suffix}`,500);
  }
  const racing={...base,state:'RACING',quizStage:{phase:'tap',stageNumber:4,stageCount:6,questionNumber:1,endsAt:Date.now()+8000}};
  await send(page,'game:state_sync',{...racing,serverNow:Date.now()});await snap(page,`host-race-${suffix}`);
  await send(page,'game:state_sync',{...racing,paused:true,serverNow:Date.now()});await snap(page,`host-pause-${suffix}`);
  const quiz={...base,state:'QUIZ',quizStage:{phase:'answer',stageNumber:4,stageCount:6,questionNumber:2,endsAt:Date.now()+10000}};
  await send(page,'game:state_sync',{...quiz,serverNow:Date.now()});
  await send(page,'game:quiz_start',{question:'阿平和小聶第一次一起旅行，是去了哪一個地方？',options:['日本京都與奈良','台灣花蓮與台東','泰國曼谷與清邁','韓國首爾與釜山'],timeLimit:10});
  await snap(page,`host-question-${suffix}`,1200);
  await send(page,'game:quiz_result',reveal);await snap(page,`host-answer-${suffix}`,1200);
  await send(page,'game:state_sync',{...quiz,serverNow:Date.now(),quizStage:{...quiz.quizStage,phase:'summary',endsAt:Date.now()+8000,summary:{teamResults:results}}});
  await snap(page,`host-summary-${suffix}`,5400);
  await send(page,'game:state_sync',{...racing,serverNow:Date.now(),quizStage:{...racing.quizStage,phase:'sprint',endsAt:Date.now()+10000}});
  await send(page,'game:final_sprint',{active:true,remainingSeconds:10,durationSeconds:10});await snap(page,`host-sprint-${suffix}`,400);
  for(const index of [-1,0,1,2,3]){
    await send(page,'game:state_sync',{...finished,serverNow:Date.now(),presentation:{stage:'awards',awardIndex:Math.max(0,index),revealedAwardIndexes:index<0?[]:[index]}});
    await snap(page,`host-award-${index<0?'hidden':index}-${suffix}`,400);
  }
  await page.close();
}
async function guest(context,size){
  const page=await context.newPage();await mock(page);await page.setViewportSize(size);
  await page.goto(`${url}/guest/`);
  await page.evaluate(()=>localStorage.removeItem('luckyHorseGuestSessionV1'));
  await page.reload();await page.waitForFunction(()=>window.qaHandlers?.['game:state_sync']);
  await send(page,'game:state_sync',base);await snap(page,`guest-login-${size.width}`);
  await send(page,'guest:join_ack',{success:false,reason:'DUPLICATE_NICKNAME',nickname:'小明'});
  await snap(page,`guest-name-error-${size.width}`);
  await page.evaluate(()=>localStorage.setItem('luckyHorseGuestSessionV1',JSON.stringify({sessionId:'qa-art-review-guest-session',nickname:'今天特別來祝福阿平小聶的好朋友',teamId:'red',isJoined:true,avatar:'🥳'})));
  await page.reload();await page.waitForFunction(()=>window.qaHandlers?.['game:state_sync']);
  await send(page,'game:state_sync',{...base,teams:base.teams.map((t,i)=>({...t,memberCount:i===1?50:30,isFull:i===1}))});
  await snap(page,`guest-team-${size.width}`);
  await send(page,'game:state_sync',{...base,state:'RACING',serverNow:Date.now(),quizStage:{phase:'tap',stageNumber:1,stageCount:6,questionNumber:1,endsAt:Date.now()+8000}});
  await send(page,'game:player_status',{tapCount:1234,teamRank:2,teamShuttle:{laps:12,progress:89},nextCriticalIn:6});
  await snap(page,`guest-race-${size.width}`);
  await send(page,'game:state_sync',{...base,state:'RACING',paused:true});await snap(page,`guest-pause-${size.width}`);
  await send(page,'game:state_sync',{...base,state:'QUIZ'});
  await send(page,'game:quiz_options',{quizId:'qa',options:{A:'日本京都與奈良',B:'台灣花蓮與台東',C:'泰國曼谷與清邁',D:'韓國首爾與釜山'},timeLimit:10});await snap(page,`guest-question-${size.width}`);
  await page.locator('.opt-btn').first().click();
  await send(page,'game:quiz_answer_ack',{success:true,isCorrect:true});await snap(page,`guest-correct-${size.width}`,500);
  await send(page,'game:quiz_result',reveal);await snap(page,`guest-team-answer-${size.width}`);
  await send(page,'game:state_sync',{...base,state:'QUIZ',serverNow:Date.now(),quizStage:{phase:'summary',stageNumber:1,stageCount:6,questionNumber:3,endsAt:Date.now()+8000,summary:{teamResults:results}}});
  await snap(page,`guest-summary-${size.width}`,5400);
  await send(page,'game:state_sync',{...base,state:'MATCH_FINISHED'});await snap(page,`guest-wait-${size.width}`);
  await page.close();
}
async function staff(context){
  for(const route of ['/manage','/control/','/admin/']){
    const page=await context.newPage();await mock(page);await page.setViewportSize({width:1366,height:900});
    await page.goto(url+route);await page.waitForTimeout(200);
    if(route.includes('control')){
      await send(page,'game:state_sync',base);await send(page,'game:map_list',[map]);
    }
    if(route.includes('admin')){
      await send(page,'admin:config_updated',config);await send(page,'admin:map_list',[map]);await send(page,'admin:quiz_list',quizzes);
      for(const tab of ['config','map','quiz','rehearsal']){
        await page.evaluate(tab=>window.switchTab(`tab-${tab}`),tab);await snap(page,`admin-${tab}-1366`);
        if(tab==='quiz'){await page.locator('#quizFrequencyHint').scrollIntoViewIfNeeded();await snap(page,'admin-quiz-pacing-1366');}
      }
    } else await snap(page,`${route.includes('control')?'control':'manage'}-1366`);
    if(route.includes('control')){await page.setViewportSize({width:390,height:844});await snap(page,'control-390');}
    await page.close();
  }
}
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext();
  let sockets=0;context.on('page',p=>p.on('websocket',()=>sockets++));
  try {
    const login=await context.newPage();await login.setViewportSize({width:390,height:844});await login.goto(`${url}/staff-login`);await snap(login,'staff-login-390');await login.close();
    await context.request.post(`${url}/staff-login`,{form:{code:process.env.STAFF_ACCESS_CODE||'1009',next:'/host/'}});
    await host(context,{width:1920,height:1080});await host(context,{width:1280,height:720});await host(context,{width:1134,height:855});
    await guest(context,{width:390,height:844});await guest(context,{width:320,height:568});
    await staff(context);
  } finally {
    fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({generatedAt:new Date().toISOString(),metrics,errors,sockets},null,2));
    fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>美術與可讀性驗收截圖</title><style>body{margin:24px;font:16px system-ui;background:#f5f7f7;color:#20383b}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}figure{margin:0}img{width:100%;height:260px;object-fit:contain;background:white}figcaption{padding:8px;overflow-wrap:anywhere}</style><h1>美術與可讀性驗收 · ${metrics.length} 張截圖</h1><p>隔離模擬資料；未連線或操作正式賽事。點圖查看原尺寸。</p><main>${metrics.map(p=>`<figure><a href="${p.label}.png"><img loading="lazy" src="${p.label}.png" alt="${p.label}"></a><figcaption>${p.label} · ${p.width}×${p.height}</figcaption></figure>`).join('')}</main></html>`);
    await context.close();await browser.close();
  }
  console.log(JSON.stringify({screens:metrics.length,errors,sockets}));
  const failures = metrics.filter(m => m.failures.length).map(m => ({label:m.label, failures:m.failures}));
  if (failures.length || errors.length || sockets) throw new Error(JSON.stringify({failures,errors,sockets}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
