// Regression: actual recorder stop/submit, honest battery states, confirmed reset,
// and responsive layouts. Recognition/review are deterministic test responses.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
const origin = process.env.REWIND_UI_TEST_URL;
const token = process.env.REWIND_UI_TEST_TOKEN;
assert(new URL(origin).hostname === '127.0.0.1' && token.startsWith('ui-test-'));
const out = path.resolve('data/ui-integration/orb-memory-' + Date.now());
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],
});
const report = {cases:[], errors:[]};
const admin = async (url, init={}) => {
  const response = await fetch(origin + '/api' + url, {...init, headers:{Authorization:`Bearer ${token}`, ...init.headers}});
  assert(response.ok, `${url}: ${response.status}`);
  return response.json();
};
const respond = (route, body) => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(body)});
async function until(fn, message, timeout=15000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { if(await fn())return; await new Promise(resolve=>setTimeout(resolve,100)); }
  throw new Error(message);
}
const context = await browser.newContext({viewport:{width:1440,height:900}, permissions:['microphone']});
const page = await context.newPage();
page.on('pageerror', e=>report.errors.push(e.message));
let heard=0, asked=0;
const fixtureAnswer={id:'77777777-7777-4777-8777-777777777777', question:'Where are my glasses?', answer:'Your glasses were on the table.', evidence:[], created_at:Date.now()/1000, mode:'verified', grounded:true, verification:{receipt:{claims_reviewed:true}}};
try {
  const status=await admin('/status');assert.equal(status.provider,'disabled');
  const invite=await admin('/pairing',{method:'POST'});
  await page.goto(origin+'/#connect='+invite.ticket);
  await page.getByRole('button',{name:'Ask by voice',exact:true}).waitFor();
  // Avoid invoking speakers during layout/capture tests.
  await page.getByRole('button',{name:'Spoken answers',exact:true}).click();
  await page.route('**/api/voice/hear?wake=false', async route=>{
    heard++; assert(route.request().postDataBuffer().length>100,'Recorder submitted real encoded audio');
    return respond(route,{question:fixtureAnswer.question, transcript:fixtureAnswer.question,directed:true});
  });
  await page.route('**/api/ask', route=>{asked++;return respond(route,fixtureAnswer);});
  await page.getByRole('button',{name:'Ask by voice',exact:true}).click();
  await page.getByRole('button',{name:'Finish and send question'}).first().waitFor();
  await page.waitForTimeout(650);
  await page.getByRole('button',{name:'Finish and send question'}).first().click();
  await page.locator('.answer-copy').filter({hasText:fixtureAnswer.answer}).waitFor();
  assert.equal(heard,1);assert.equal(asked,1);
  assert.equal(await page.getByRole('button',{name:'Ask by voice',exact:true}).isEnabled(),true);
  report.cases.push('Second orb tap submits real encoded audio and shows the answer exactly once');
  await page.unroute('**/api/voice/hear?wake=false');
  await page.route('**/api/voice/hear?wake=false', route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Speech recognition is unavailable right now.'})}));
  await page.getByRole('button',{name:'Ask by voice',exact:true}).click();await page.waitForTimeout(600);
  await page.getByRole('button',{name:'Finish and send question'}).first().click();
  await page.getByRole('alert').filter({hasText:'Speech recognition is unavailable'}).waitFor();
  assert(await page.getByRole('button',{name:'Ask by voice',exact:true}).isEnabled());
  report.cases.push('Recognition failure is visible and microphone can retry');
  for (const width of [1440,1280,1024,768,390,320]) {
    await page.setViewportSize({width,height:900});
    for (const view of ['Rose','Caretaker']) {
      await page.getByRole('tab',{name:view,exact:true}).click();
      await page.waitForTimeout(1100);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${view} ${width} overflow`);
      const layout = await page.locator('.mail-widgets').evaluate(el=>({top:el.getBoundingClientRect().top, children:el.children.length}));
      assert.equal(layout.children,2);
      if(width>=1024) assert(layout.top<900,`${view} calendar must be near the first screen: ${layout.top}`);
      await page.screenshot({path:path.join(out,`${view}-${width}.png`),fullPage:true});
    }
  }
  report.cases.push('Rose and Caretaker fit six widths; Calendar and Notes follow the main controls');
  await page.getByRole('tab',{name:'Rose',exact:true}).click();
  await page.getByRole('button',{name:'Clear all memory',exact:true}).click();
  await page.getByRole('alertdialog',{name:'Clear all memory?'}).waitFor();
  await until(()=>page.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement),'Cancel receives initial focus');
  await until(()=>page.getByRole('alertdialog').evaluate(el=>getComputedStyle(el).opacity==='1'),'Popup entrance completes');
  await page.screenshot({path:path.join(out,'memory-confirmation.png')});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal((await admin('/status')).history_cleared_before,0);
  await page.getByRole('button',{name:'Clear all memory',exact:true}).click();
  await page.getByRole('button',{name:'OK',exact:true}).click();
  await until(async()=>(await admin('/status')).history_cleared_before>0,'Confirmed reset reached API');
  await page.getByRole('button',{name:'Ask by voice',exact:true}).waitFor();
  report.cases.push('Memory popup traps focus; Cancel preserves history, OK clears and refreshes the workspace');
  // iPhone Safari has no Battery Status API: never invent a percentage.
  const phoneContext = await browser.newContext({viewport:{width:390,height:844}});
  await phoneContext.addCookies(await context.cookies());
  await phoneContext.addInitScript(()=>Object.defineProperty(navigator,'getBattery',{value:undefined,configurable:true}));
  const phone=await phoneContext.newPage();phone.on('pageerror',e=>report.errors.push(e.message));
  await phone.goto(origin+'/phone/');await phone.getByRole('button',{name:'Record',exact:true}).waitFor();
  await phone.getByText('Battery —',{exact:true}).waitFor();
  for(const width of [320,375,390,430,768]) {
    await phone.setViewportSize({width,height:844});
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`phone ${width} overflow`);
    await phone.getByRole('button',{name:'Record',exact:true}).scrollIntoViewIfNeeded();
    const record=await phone.getByRole('button',{name:'Record',exact:true}).boundingBox();
    assert(record.y+record.height<844,`Record visible at ${width}`);
    await phone.screenshot({path:path.join(out,`phone-${width}.png`),fullPage:true});
  }
  const batteryContext=await browser.newContext({viewport:{width:390,height:844}});
  await batteryContext.addCookies(await context.cookies());
  await batteryContext.addInitScript(()=>{
    const battery=new EventTarget();battery.level=.38;battery.charging=true;
    Object.defineProperty(navigator,'getBattery',{value:async()=>battery, configurable:true});
  });
  const batteryPhone=await batteryContext.newPage();await batteryPhone.goto(origin+'/phone/');
  await batteryPhone.getByText('38%',{exact:true}).waitFor();
  await until(async()=>((await admin('/status')).phone?.battery===38 && (await admin('/status')).phone?.charging),'Battery telemetry reaches dashboard');
  const reloaded = phone.waitForEvent('load');
  await admin('/memory', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({confirm:true})});
  await reloaded;
  await phone.getByRole('button',{name:'Record',exact:true}).waitFor();
  report.cases.push('Clearing from another view refreshes the phone so old answers and capture state cannot linger');
  report.cases.push('Phone fits five widths with Record reachable; unsupported battery shows —, supported telemetry shows actual charge');
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error) { report.failure=String(error);report.passed=false;await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error; }
finally {await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:out}));await browser.close();}
