// Real ASUS recognition, with separate ordinary / letter / bill camera inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {scanFixtures,installScanCamera} from './scan_fixtures.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const origin=process.env.REWIND_UI_TEST_URL;
assert(origin && new URL(origin).hostname==='127.0.0.1' && process.env.REWIND_UI_TEST_TOKEN?.startsWith('live-test-'));
const out=path.resolve(process.env.REWIND_TEST_ARTIFACTS);await fs.mkdir(out,{recursive:true});
const report={cases:[],errors:[]};
async function api(url,init={}) {const r=await fetch(origin+'/api'+url,init);assert(r.ok,`${url}: ${r.status}`);return r.json();}
async function until(fn,label,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,150));}throw Error(label);}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera','microphone']});
 const fixtures=await scanFixtures(context,origin,out);
 const dashboard=await context.newPage(), phone=await context.newPage();
 await installScanCamera(phone,fixtures.ordinary);
 for(const page of [dashboard,phone])page.on('pageerror',e=>report.errors.push(e.message));
 await dashboard.goto(origin);await dashboard.getByText('iPhone',{exact:true}).waitFor();
 await phone.setViewportSize({width:390,height:844});await phone.goto(origin+'/phone/');
 await phone.getByRole('button',{name:'Record',exact:true}).waitFor();
 for(const [fixture,expected,notice] of [
   ['ordinary',[],'Added to Moments.'],
   ['letter',['postcard'],'Added to Notes.'],
   ['bill',['bill'],'Added to Calendar.'],
   ['both',['bill','postcard'],'Added to Notes and Calendar.'],
   ['receipt',[],'Added to Moments.'],
   ['blank',[],'Added to Moments.'],
 ]) {
   for(const doc of await api('/scans')) await api('/scans/'+doc.id,{method:'DELETE'});
   await until(async()=>await dashboard.locator('[data-card="notes"] .postcard').count()===0 && await dashboard.locator('[data-card="calendar"] .cal-event').count()===0,'Clear previous fixture cards');
   await phone.evaluate(image=>window.__setScanFixture(image),fixtures[fixture]);
   const known=new Set((await api('/recordings?limit=200')).map(r=>r.id));
   await phone.getByRole('button',{name:'Scan',exact:true}).click();
   let job;
   await until(async()=>{job=(await api('/scans/jobs')).find(j=>!known.has(j.media_id));return job && job.status!=='reading';},'Recognize '+fixture);
   assert.equal(job.status,'done',JSON.stringify(job));
   const docs=await api('/scans');assert.deepEqual(docs.map(d=>d.kind).sort(),expected);
   assert(docs.every(d=>d.source==='model+template'));
   await phone.getByText(notice,{exact:true}).waitFor();
   await dashboard.bringToFront();
   if(expected.length) {
     await dashboard.locator('.letter-layer').waitFor({state:'visible',timeout:15000});
     await dashboard.locator(expected.includes('bill') ? '.letter-doc.kind-bill' : '.letter-doc.kind-postcard').waitFor({state:'visible',timeout:20000});
     await dashboard.locator('.letter-layer').waitFor({state:'detached',timeout:25000});
   } else {
     await until(async()=>await dashboard.locator(`[data-frame="${job.media_id}"]`).count()>0,'Ordinary scan appears in Moments');
     assert.equal(await dashboard.locator('.letter-layer').count(),0);
   }
   assert.equal(await dashboard.locator('[data-card="notes"] .postcard').count(),expected.includes('postcard')?1:0);
   assert.equal(await dashboard.locator('[data-card="calendar"] .cal-event').count(),expected.includes('bill')?1:0);
   await phone.locator('.letter-layer').waitFor({state:'detached',timeout:15000});
   await phone.getByRole('button',{name:'Close camera',exact:true}).click();
   await phone.screenshot({path:path.join(out,fixture+'-filed.png'),fullPage:true});
   report.cases.push({fixture,kinds:docs.map(d=>d.kind),destinations:job.destinations,passed:true});
   console.log(JSON.stringify(report.cases.at(-1)));
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.passed=false;report.failure=String(e);throw e;}
finally{await fs.writeFile(path.join(out,'routing-report.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));}
