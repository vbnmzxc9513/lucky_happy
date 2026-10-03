const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const config = require('../shared/game-config');
const fixturesOnly = process.argv.includes('--fixturesOnly');
const url = fixturesOnly ? 'http://lucky.test' : process.env.SERVER_URL || 'http://127.0.0.1:3000';

async function checkBounds(page, selector) {
  const issues = await page.locator(selector).evaluate(el => {
    const box = el.getBoundingClientRect();
    const issues = [];
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) issues.push('summary outside viewport');
    for (const node of el.querySelectorAll('h2, h3, .stage-stars, .stage-score, .stage-reward, .stage-next, .stage-next-label, .stage-next-countdown, .stage-next-seconds, img')) {
      const rect = node.getBoundingClientRect();
      if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) issues.push(node.className || node.tagName);
      if (node.tagName === 'IMG' && (!node.complete || !node.naturalWidth)) issues.push('broken image');
    }
    if (document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight) issues.push('scrolling');
    return issues;
  });
  assert.deepEqual(issues, []);
}

async function main() {
  fs.mkdirSync('reports/stages', { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}) });
  try {
    const context = await browser.newContext();
    if (fixturesOnly) {
      await context.route('**/*', route => {
        const resource = new URL(route.request().url());
        if (resource.hostname !== 'lucky.test') return route.abort();
        if (resource.pathname === '/socket.io/socket.io.js') return route.fulfill({contentType: 'text/javascript', body: 'window.handlers={};window.receive=(n,d)=>(handlers[n]||[]).forEach(f=>f(d));window.io=()=>({on(n,f){(handlers[n]||=[]).push(f)},emit(){},connect(){}})'});
        if (resource.pathname === '/api/join-info') return route.fulfill({contentType: 'application/json', body: '{}'});
        const name = resource.pathname.endsWith('/') ? resource.pathname + 'index.html' : resource.pathname;
        const file = path.resolve('.' + (name.startsWith('/assets/') ? '/host' + name : name));
        if (!file.startsWith(process.cwd() + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
        return route.fulfill({contentType: {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'}[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
      });
    } else {
    const login = await context.request.post(`${url}/staff-login`, {
      form: { code: process.env.STAFF_ACCESS_CODE || '1009', next: '/host/' }, maxRedirects: 0
    });
    assert.equal(login.status(), 302);
    }
    const pages = [];
    const errors = [];
    if (!process.argv.includes('--fixturesOnly')) {
    for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1134, height: 855 }]) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize(size);
      await page.goto(`${url}/host/`, { waitUntil: 'domcontentloaded' });
      pages.push(page);
    }
    await pages[0].locator('.stage-summary:not([hidden])').waitFor({ timeout: 75000 });
    // Capture a complete reveal after the star and reward animations have played.
    await pages[0].waitForTimeout(5700);
    for (const page of pages) {
      await checkBounds(page, '.stage-host');
      await page.screenshot({ path: `reports/stages/live-host-${page.viewportSize().width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log('PASS live host summary, all five images, no clipping or scrolling at three desktop sizes');
    }


    async function fixture(page, mode, count, elapsed = 0, paused = true) {
      await page.evaluate(({config,mode,count,elapsed,paused}) => {
        window.fixtureDisplay ||= new window.StageDisplay(mode);
        const teamResults = Object.fromEntries(config.TEAMS.map((team, i) => {
          const correctCount = count ?? i, steps = config.quizStages.rewardSteps[correctCount];
          return [team.id, {answers:[0,1,2,3].map(q=>q<correctCount), correctCount, steps, beforePosition:27840, position:27840 + steps*config.quizStages.rewardUnitPx}];
        }));
        const now = Date.now();
        window.fixtureState = {runId:'fixture',stateVersion:(window.fixtureState?.stateVersion||0)+1,serverNow:now,paused,pausedAt:now,config,
          quizStage:{phase:'summary',stageNumber:1,stageCount:4,questionNumber:4,flowRevision:1,
            summary:{teamResults,...SummaryMotion.timeline(teamResults,now-elapsed,config)}}};
        if (mode === 'host') {
          fixtureState.state='QUIZ'; fixtureState.currentMap={trackLength:76000}; fixtureState.activeItems={};
          fixtureState.teams=config.TEAMS.map(t=>({...t,position:teamResults[t.id].position,speed:0}));
          receive('game:state_sync',fixtureState);
        } else fixtureDisplay.sync(fixtureState, 'red');
      }, {config,mode,count,elapsed,paused});
    }
    for (const [width,height] of [[1280,720],[1920,1080],[1366,768]]) {
      const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
      await page.setViewportSize({width,height}); await page.goto(url+'/host/');
      await fixture(page,'host',null,0,false);
      await checkBounds(page,'.stage-host:not([hidden])');
      assert.equal(await page.locator('.stage-host .stage-runner').count(),0,'summary does not replace main runners');
      await page.screenshot({path:'reports/stages/main-summary-'+width+'.png'});
      const horsePositions = () => page.locator('.horse-unit').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().x));
      const start=await horsePositions();
      await page.evaluate(()=>window.originalHorse=document.getElementById('horse-red'));
      for(const elapsed of [800,1400,2000,2800,3800,4800]) {
        await fixture(page,'host',null,elapsed,false);
        assert.equal(await page.locator('.stage-host:not([hidden])').count(),0,'main race is unobstructed throughout movement');
        await page.screenshot({path:`reports/stages/main-${width}-${elapsed}.png`});
      }
      const end=await horsePositions();
      assert.equal(end[0],start[0]); assert(end[1]-start[1]>70,'100m visibly advances the actual main runner');
      for(let i=1;i<5;i++) assert(Math.abs((end[i]-start[i])/(end[4]-start[4])-[0,1/6,2/6,4/6,1][i])<.01);
      assert.equal(await page.evaluate(()=>originalHorse===document.getElementById('horse-red')),true);
      assert.equal(await page.locator('#red-progress-text').textContent(),'1,856 m');
      await page.emulateMedia({reducedMotion:'reduce'});
      await fixture(page,'host',null,900,false);
      assert.deepEqual(await horsePositions(),end,'reduced motion displays the same authoritative result');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.reload(); await fixture(page,'host',null,2000,true);
      const midpoint=await horsePositions(); await page.waitForTimeout(250);
      assert.deepEqual(await horsePositions(),midpoint,'paused reload retains authority midpoint');
      assert(midpoint[4]>start[4] && midpoint[4]<end[4]);
      await fixture(page,'host',null,0,false); await page.waitForTimeout(1700);
      assert.equal(await page.locator('.horse-unit.is-running').count(),4,'real main runners use stride during rewards');
      assert.equal(await page.locator('#horse-purple .horse-emoji').evaluate(el=>getComputedStyle(el).animationPlayState),'running');
      await page.evaluate(()=>receive('game:state_sync',{...fixtureState,stateVersion:++fixtureState.stateVersion,state:'LOBBY',quizStage:null}));
      // Cross the old turnaround with one obstacle in the red lane.
      for(const [position,stunned] of [[800,false],[1480,false],[1499,false],[1500,true]]) {
        await page.evaluate(({config,position,stunned})=>{
          const now=Date.now();
          receive('game:state_sync',{runId:'fixture',stateVersion:++fixtureState.stateVersion,state:'RACING',config,
            currentMap:{trackLength:76000},serverNow:now,paused:false,pausedAt:null,
            teams:config.TEAMS.map(t=>({...t,position:t.id==='red'?position:1300,speed:0,isStunned:t.id==='red'&&stunned})),
            activeItems:{red:[{id:'visible-rock',x:1500,type:'obstacle',triggered:stunned}]},
            quizStage:{phase:'tap',stageNumber:2,stageCount:4,questionNumber:0,flowRevision:2,endsAt:now+8000}});
        },{config,position,stunned});
        if (await page.locator('.item-dom').count() !== (stunned?0:1)) {
          await page.screenshot({path:'reports/stages/obstacle-failure.png'});
          console.log(await page.evaluate(()=>({active:document.querySelector('.screen.active')?.id,horse:document.getElementById('horse-red').style.transform,version:fixtureState.stateVersion})));
        }
        assert.equal(await page.locator('.item-dom').count(),stunned?0:1);
        if(!stunned) {
          assert.equal(await page.locator('.item-dom').evaluate(el=>{
            const r=el.getBoundingClientRect(); el.style.pointerEvents='auto';
            const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); el.style.pointerEvents='';
            return el.complete&&el.naturalWidth>0 && top===el;
          }),true,'rock is visibly above horse and track, with working asset');
        }
        assert.equal(await page.locator('#horse-red.is-stunned').count(),stunned?1:0);
        await page.screenshot({path:`reports/stages/obstacle-${width}-${position}.png`});
      }
      // Large gaps stay comparable and distances beyond trackLength remain distinct.
      await page.evaluate(({config})=>{
        const now=Date.now();receive('game:state_sync',{...fixtureState,stateVersion:++fixtureState.stateVersion,state:'QUIZ',paused:false,pausedAt:null,serverNow:now,
          teams:config.TEAMS.map((t,i)=>({...t,position:100000+i*10000,speed:0})),
          quizStage:{phase:'summary',stageNumber:3,stageCount:4,questionNumber:4,flowRevision:3,
            summary:{...SummaryMotion.timeline({},now-5000,config),teamResults:Object.fromEntries(config.TEAMS.map((t,i)=>[t.id,{steps:0,beforePosition:100000+i*10000,position:100000+i*10000,answers:[]}]))}}});
      },{config});
      const gap=await horsePositions(); for(let i=1;i<5;i++) assert(gap[i]>gap[i-1]);
      await page.screenshot({path:'reports/stages/main-large-gap-'+width+'.png'});
      if(width===1280) {
        await page.evaluate(()=>{
          receive('game:state_sync',{...fixtureState,stateVersion:++fixtureState.stateVersion,state:'LOBBY',quizStage:null});
          document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));
          document.getElementById('screen-racing').classList.add('active');
          window.zoomRenderer=new RaceRenderer();zoomRenderer.initTrack(76000,{red:[{id:'zoom-rock',x:11500,type:'obstacle'}]});
          const teams=position=>Object.fromEntries(GameConfig.TEAMS.map(t=>[t.id,{position:t.id==='red'?position:1000,speed:0}]));
          zoomRenderer.paint(teams(0));zoomRenderer.paint(teams(11250));
          const x=()=>parseFloat(document.getElementById('horse-red').style.transform.slice(12));
          const before=x();zoomRenderer.paint(teams(11251));
          window.zoomFrames=[{at:0,x:x(),delta:x()-before}];window.zoomStartedAt=performance.now();
          const step=now=>{
            const previous=x();zoomRenderer.paint(teams(11251));
            zoomFrames.push({at:now-zoomStartedAt,x:x(),delta:x()-previous});
            if(zoomRenderer.cameraTransition) requestAnimationFrame(step);else window.zoomDone=true;
          };requestAnimationFrame(step);
        });
        let previousZoomTime=0;
        for(const elapsed of [0,500,1200,2400,4000]) {
          if(elapsed) await page.waitForTimeout(elapsed-previousZoomTime);
          await page.screenshot({path:`reports/stages/review-camera-${elapsed}.png`});
          previousZoomTime=elapsed;
        }
        await page.waitForFunction(()=>window.zoomDone);
        const frames=await page.evaluate(()=>zoomFrames);
        assert(frames[0].delta>=0,'boundary +1 does not snap backwards');
        assert(frames.every(frame=>Math.abs(frame.delta)<15),'camera has no large frame discontinuity');
        fs.writeFileSync('reports/stages/review-camera-frames.json',JSON.stringify(frames,null,2));
      }
      await page.close();
    }
    for(const [width,height] of [[390,844],[320,568]]) {
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});
      await page.goto(url+'/guest/');
      for(const count of [0,1,2,3,4]) {
        // A different revision represents a new fixture settlement.
        await page.evaluate(()=>{if(window.fixtureDisplay){fixtureDisplay.sync({...fixtureState,quizStage:null},'red');}});
        await fixture(page,'guest',count,0,true);
        const start=await page.locator('.stage-guest').last().locator('img').evaluate(e=>e.getBoundingClientRect().x);
        await fixture(page,'guest',count,4800,true);
        const end=await page.locator('.stage-guest').last().locator('img').evaluate(e=>e.getBoundingClientRect().x);
        if(count===0) assert.equal(end,start); else assert(end-start>30,'phone 100m displacement');
        assert.equal(await page.locator('.stage-guest').last().locator('.stage-team').count(),1);
        await checkBounds(page,'.stage-guest:not([hidden])');
        await page.screenshot({path:'reports/stages/guest-'+width+'-'+count+'.png'});
      }
      await page.emulateMedia({reducedMotion:'reduce'});await fixture(page,'guest',4,0,false);
      assert.equal(await page.evaluate(()=>fixtureDisplay.runners[0].runner.style.transform),'translate3d(100%, 0px, 0px)');
      await page.evaluate(()=>fixtureDisplay.sync({...fixtureState,quizStage:null},'red'));
      assert.equal(await page.locator('.stage-guest').last().isHidden(),true);
      await page.close();
    }
    for(const [width,height] of [[320,568],[390,844],[844,390]]) {
      const page=await context.newPage(); await page.setViewportSize({width,height});
      page.on('pageerror',e=>errors.push(e.message)); await page.goto(url+'/guest/');
      // Isolated CSS fixture has no transport; live network status is tested separately.
      await page.addStyleTag({content:'#network-status { display:none !important; }'});
      await page.evaluate(()=>{
        document.querySelectorAll('.screen').forEach(el=>el.classList.remove('active'));
        document.getElementById('screen-quiz').classList.add('active');
        window.fixtureQuiz=new QuizUI(()=>true); fixtureQuiz.beginQuestion('fixture:1:1');
        fixtureQuiz.showOptions({A:'',B:'',C:'',D:''},10,()=>3);fixtureQuiz.disableAll();
        const msg=document.getElementById('quiz-lock-msg');msg.style.display='block';msg.textContent='閱讀中';
      });
      for(const phase of ['reading','answer','submitted','reveal']) {
        await page.evaluate(phase=>{
          if(phase==='answer') {
            fixtureQuiz.showOptions({},10,()=>10);document.querySelectorAll('.opt-btn').forEach(el=>el.disabled=false);
          }
          if(phase==='submitted') {
            fixtureQuiz.selectOption('B',document.querySelector('[data-opt="B"]'));fixtureQuiz.showAnswerAck({success:true,isCorrect:true});
          }
          if(phase==='reveal') fixtureQuiz.showTeamResult({correctCount:5,totalCount:10,correctRate:.5,isCorrect:false},{correctAnswer:'A',correctAnswerText:'正解'});
        },phase);
        const issues=await page.evaluate(()=>{
          const nodes=document.querySelectorAll('.quiz-top,.opt-btn,#quiz-lock-msg');
          return [...nodes].filter(el=>getComputedStyle(el).display!=='none').filter(el=>{
            const r=el.getBoundingClientRect();return r.x<0||r.right>innerWidth+1||r.y<0||r.bottom>innerHeight+1||el.scrollWidth>el.clientWidth+1;
          }).map(el=>el.className);
        });
        assert.deepEqual(issues,[],`Guest ${phase} fits ${width}x${height}`);
        assert.equal(await page.locator('.opt-btn').evaluateAll(els=>els.every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44})),true);
        await page.screenshot({path:`reports/stages/controller-${phase}-${width}x${height}.png`});
      }
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS authority movement, all reward tiers, privacy, reduced motion, stable DOM and six viewport sizes');

  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
