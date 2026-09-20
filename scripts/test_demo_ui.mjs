// Isolated, code-free hackathon UI: true camera uploads, repeated deliveries, precise layout checks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const origin=process.env.REWIND_UI_TEST_URL;
assert(origin && new URL(origin).hostname==='127.0.0.1' && process.env.REWIND_UI_TEST_TOKEN?.startsWith('ui-test-'));
const out=path.resolve('data/ui-integration/demo-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={cases:[],errors:[]};
const api=async(url)=>{const r=await fetch(origin+'/api'+url);assert(r.ok);return r.json();};
const initial=await api('/status');assert.equal(initial.browser_open_access,true);assert.equal(initial.received,0);assert.equal(initial.provider,'disabled');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const options={viewport:{width:1440,height:1000},permissions:['camera','microphone']};
const desk=await browser.newContext(options),mobile=await browser.newContext({...options,viewport:{width:390,height:844}});
const dashboard=await desk.newPage(),phone=await mobile.newPage();
for(const p of [dashboard,phone])p.on('pageerror',e=>report.errors.push(e.message));
async function waitFor(fn,label,timeout=20000){const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(label);}
async function settled(page){await waitFor(()=>page.locator('.cell').last().evaluate(el=>Number(getComputedStyle(el).opacity)===1),'Widgets finish entrance');}
async function fits(page){
 const data=await page.locator('.card-ask').evaluate(card=>{
  const bounds=card.getBoundingClientRect(),bar=card.querySelector('.ask-bar').getBoundingClientRect(),send=card.querySelector('.send').getBoundingClientRect(),input=card.querySelector('input').getBoundingClientRect();
  return {card:{left:bounds.left,right:bounds.right},bar:{left:bar.left,right:bar.right},send:{left:send.left,right:send.right,width:send.width},input:input.width,viewport:innerWidth,document:document.documentElement.scrollWidth};
 });
 assert(data.send.right<=data.card.right-10 && data.bar.right<=data.card.right-10 && data.send.left>=data.card.left+10,JSON.stringify(data));
 assert(data.input>30 && data.send.width>=24,JSON.stringify(data));assert(data.document<=data.viewport+2,JSON.stringify(data));
}
try{
 await dashboard.goto(origin);await dashboard.getByRole('tab',{name:'Rose',exact:true}).waitFor();await settled(dashboard);
 assert.equal(await dashboard.locator('#pairing-code').count(),0);assert.equal(await dashboard.getByText('Demo widgets',{exact:true}).count(),0);assert.equal(await dashboard.locator('.grid .cell').count(),13);
 await dashboard.screenshot({path:path.join(out,'dashboard.png'),fullPage:true});
 for(const width of [1440,1280,1024,768,390,320]){
  await dashboard.setViewportSize({width,height:1000});await fits(dashboard);
 }
 await dashboard.setViewportSize({width:1440,height:1000});
 await dashboard.evaluate(()=>document.body.style.zoom='2');await fits(dashboard);await dashboard.evaluate(()=>document.body.style.zoom='');
 await dashboard.getByRole('textbox',{name:'Ask about your recordings'}).fill('When is my doctor bill due?');assert(await dashboard.getByRole('button',{name:'Send question',exact:true}).isEnabled());
 await dashboard.locator('.card-ask').screenshot({path:path.join(out,'ask-fixed.png')});
 await dashboard.getByRole('tab',{name:'Caretaker',exact:true}).click();await settled(dashboard);await fits(dashboard);
 await dashboard.getByRole('tab',{name:'Rose',exact:true}).click();await settled(dashboard);
 await phone.goto(origin+'/phone/');await phone.getByRole('button',{name:'Record',exact:true}).waitFor();await settled(phone);
 assert.equal(await phone.locator('#pairing-code').count(),0);await fits(phone);
 await phone.setViewportSize({width:320,height:740});await fits(phone);await phone.setViewportSize({width:390,height:844});
 report.cases.push('Fresh desktop and separate phone browser open without sign-in; Ask controls fit at six widths and 200% zoom');
 // Each repeat must animate newly saved document IDs, then retain exactly two fixed documents.
 let previous=[];
 for(let run=0;run<2;run++){
  if(run)await dashboard.getByRole('button',{name:'Next month',exact:true}).click();
  await phone.bringToFront();await phone.getByRole('button',{name:'Scan',exact:true}).click();
  await phone.locator('.letter-layer').waitFor({state:'visible'});
  if(!run)await phone.screenshot({path:path.join(out,'phone-sending.png')});
  await dashboard.bringToFront();
  await dashboard.locator('.letter-layer').waitFor({state:'visible'});
  assert.equal(await dashboard.locator('[data-card="calendar"] .cal-event').count(),0,'Bill waits for its own envelope');
  await dashboard.locator('.letter-doc.kind-postcard').waitFor({state:'visible',timeout:10000});
  assert(await dashboard.locator('[data-card="notes"] .postcard').evaluate(el=>getComputedStyle(el).opacity==='0'),'Destination stays empty while postcard flies');
  await dashboard.screenshot({path:path.join(out,`postcard-flight-${run}.png`)});
  await dashboard.locator('.letter-doc.kind-bill').waitFor({state:'visible',timeout:12000});
  assert.equal(await dashboard.locator('[data-card="calendar"] .cal-event').count(),0);
  await dashboard.screenshot({path:path.join(out,`bill-flight-${run}.png`)});
  await dashboard.locator('.letter-layer').waitFor({state:'detached',timeout:15000});
  assert.equal(await dashboard.locator('[data-day="2026-09-30"].has-bill').count(),1);
  assert.equal(await dashboard.locator('[data-card="calendar"] .cal-event').count(),1);
  assert(await dashboard.locator('[data-card="notes"] .postcard').evaluate(el=>getComputedStyle(el).opacity==='1'));
  const scans=await api('/scans');assert.equal(scans.length,2);assert(scans.every(s=>s.source==='template' && !previous.includes(s.id)));previous=scans.map(s=>s.id);
  await phone.locator('.letter-layer').waitFor({state:'detached',timeout:10000});
 }
 await dashboard.screenshot({path:path.join(out,'mail-filed.png'),fullPage:true});
 report.cases.push('Two consecutive phone scans send real JPEGs; postcard and bill visibly fly and only appear on landing; correct calendar month and no duplicates');
 await dashboard.getByRole('button',{name:'Show the picture side',exact:true}).click();assert.equal(await dashboard.locator('.postcard.is-flipped').count(),1);
 await dashboard.getByRole('button',{name:'Open the scanned original',exact:true}).click();
 await waitFor(()=>dashboard.getByRole('img',{name:'The scan Rose took',exact:true}).evaluate(img=>img.complete&&img.naturalWidth>0),'Retained scan image opens');
 await dashboard.getByRole('button',{name:'Close',exact:true}).click();await dashboard.reload();await settled(dashboard);
 assert.equal(await dashboard.locator('[data-day="2026-09-30"].has-bill').count(),1);assert.equal(await dashboard.locator('.letter-layer').count(),0);
 report.cases.push('Postcard flips, original JPEG opens, and filed documents survive refresh without replay');
 const workspace=await desk.newPage();await workspace.goto(origin+'/workspace/#usage');
 await workspace.getByRole('button',{name:'Create phone QR code',exact:true}).click();
 assert.equal(await workspace.getByRole('button',{name:'Sign out',exact:true}).count(),0);
 await workspace.getByRole('img',{name:'Scan to securely connect your phone',exact:true}).waitFor();
 await workspace.getByText('Opens directly · no sign-in or code needed',{exact:true}).waitFor();
 assert.equal(await workspace.locator('#pairing-code').count(),0);
 report.cases.push('Workspace generates a permanent direct phone QR, with no pairing code');
 assert.equal(report.errors.length,0);report.passed=true;
}catch(e){report.passed=false;report.failure=String(e);await dashboard.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e;}
finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,artifacts:out}));await browser.close();}
