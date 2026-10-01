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
        if (resource.pathname === '/socket.io/socket.io.js') return route.fulfill({contentType: 'text/javascript', body: 'window.io=()=>({on(){},emit(){},connect(){}})'});
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
          return [team.id, {answers:[0,1,2,3].map(q=>q<correctCount), correctCount, steps, position:27840 + steps*config.quizStages.rewardUnitPx}];
        }));
        const now = Date.now();
        window.fixtureState = {runId:'fixture',stateVersion:(window.fixtureState?.stateVersion||0)+1,serverNow:now,paused,pausedAt:now,config,
          quizStage:{phase:'summary',stageNumber:1,stageCount:4,questionNumber:4,flowRevision:1,
            summary:{teamResults,...SummaryMotion.timeline(teamResults,now-elapsed,config)}}};
        fixtureDisplay.sync(fixtureState, mode === 'guest' ? 'red' : undefined);
        document.body.classList.toggle('stage-summary-active', mode === 'host');
      }, {config,mode,count,elapsed,paused});
    }
    for (const [width,height] of [[1280,720],[1920,1080],[1366,768],[1134,855]]) {
      const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
      await page.setViewportSize({width,height}); await page.goto(url+'/host/');
      await fixture(page,'host',null,0,true);
      const start=await page.locator('.stage-host').last().locator('img').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().x));
      await page.screenshot({path:'reports/stages/host-start-'+width+'.png'});
      // Keep the same DOM and move only the authority clock to the midpoint.
      await page.evaluate(()=>{window.runnerNode=fixtureDisplay.runners[1].runner; window.mutations=0;
        new MutationObserver(rs=>{mutations+=rs.length}).observe(fixtureDisplay.summary,{childList:true,subtree:true});});
      await fixture(page,'host',null,2000,true);
      await page.screenshot({path:'reports/stages/host-moving-'+width+'.png'});
      await fixture(page,'host',null,4800,true);
      assert.equal(await page.evaluate(()=>runnerNode===fixtureDisplay.runners[1].runner),true);
      assert.equal(await page.evaluate(()=>mutations),0,'no DOM reconstruction');
      const end=await page.locator('.stage-host').last().locator('img').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().x));
      assert.equal(end[0],start[0]); assert(end[1]-start[1]>100,'100m is clearly displaced');
      for(let i=1;i<5;i++) assert(Math.abs((end[i]-start[i])/(end[4]-start[4])-[0,1/6,2/6,4/6,1][i])<.01);
      await checkBounds(page,'.stage-host:not([hidden])');
      assert.deepEqual(await page.locator('.stage-host').last().locator('.stage-reward').allTextContents(),[0,1,2,4,6].map(n=>'前進 '+require('../shared/distance-display').reward(n)));
      assert.equal(await page.locator('.stage-confetti,.stage-perfect-seal').count(),0);
      await page.screenshot({path:'reports/stages/host-rewards-'+width+'.png'});
      // A fresh display (reload recovery) starts at the authority midpoint, not zero.
      await page.reload();
      await fixture(page,'host',null,2000,true);
      const recovered=await page.evaluate(()=>fixtureDisplay.runners[4].runner.style.transform);
      assert.match(recovered,/35.2/);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>fixtureDisplay.runners[4].runner.style.transform),recovered,'pause freezes');
      // Actual local animation: all teams start together and finish without DOM replacement.
      await fixture(page,'host',null,0,false);
      const frames = await page.evaluate(() => new Promise(resolve => {
        const samples=[]; let previous=performance.now(); const start=previous;
        const frame=now=>{samples.push(now-previous);previous=now;
          if(now-start<1100) requestAnimationFrame(frame); else resolve(samples.slice(1));}; requestAnimationFrame(frame);
      }));
      fs.writeFileSync('reports/stages/frames-'+width+'.json',JSON.stringify(frames));
      assert(frames.filter(ms=>ms<50).length/frames.length>.9,'five-team movement remains responsive');
      assert.equal(await page.locator('.stage-host').last().locator('.is-moving').count(),4);
      await page.screenshot({path:'reports/stages/host-running-'+width+'.png'});
      await page.waitForTimeout(2900);
      assert.equal(await page.locator('.stage-host').last().locator('.is-moving').count(),0);
      await page.evaluate(()=>{
        fixtureState.config.TEAMS=fixtureState.config.TEAMS.map(t=>({...t,name:'永遠幸福快樂相親相愛親友應援隊'}));
        fixtureDisplay.sync({...fixtureState,quizStage:null});
        fixtureDisplay.sync(fixtureState);
      });
      await checkBounds(page,'.stage-host:not([hidden])');
      assert.equal(await page.evaluate(()=>[...fixtureDisplay.summary.querySelectorAll('h3')].every(e=>e.getBoundingClientRect().bottom<=e.parentNode.querySelector('.stage-stars').getBoundingClientRect().top)),true,'long names do not overlap answers');
      await page.screenshot({path:'reports/stages/host-long-'+width+'.png'});
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
    assert.deepEqual(errors,[]);
    console.log('PASS authority movement, all reward tiers, privacy, reduced motion, stable DOM and six viewport sizes');

  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
