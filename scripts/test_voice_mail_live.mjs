// Explicit live E2E: real Deepgram STT/TTS, real local model and Codex evidence review.
// Only run against the isolated live-test API. Camera is synthetic; mail is the authorized fixed demo.
import assert from 'node:assert/strict';
import {scanFixtures,installScanCamera} from './scan_fixtures.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const origin=process.env.REWIND_UI_TEST_URL;
const token=process.env.REWIND_UI_TEST_TOKEN;
assert(origin && new URL(origin).hostname==='127.0.0.1' && token?.startsWith('live-test-'));
const out=path.resolve(process.env.REWIND_TEST_ARTIFACTS || 'data/voice-mail-live/browser');await fs.mkdir(out,{recursive:true});
const headers={Authorization:`Bearer ${token}`};
async function api(url,init={}){
 const r=await fetch(origin+'/api'+url,{...init,headers:{...headers,...init.headers}});
 assert(r.ok,`${url}: ${r.status}`);return r.json();
}
async function until(fn,label,timeout=90000){
 console.log('Checking:',label);
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,250));}
 throw Error('Timed out: '+label);
}
const report={cases:[],errors:[],audio:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:[
 '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
 '--use-file-for-fake-audio-capture='+path.resolve(process.env.REWIND_TEST_AUDIO || 'data/voice-mail-live/question.wav'),
]});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['camera','microphone']});
// Observe native playback events; never substitute success callbacks or speech responses.
await context.addInitScript(()=>{
 window.__actualAudio=[];
 const NativeAudio=window.Audio;
 window.Audio=function(...args){
  const player=new NativeAudio(...args);
  for(const kind of ['playing','ended','error']) player.addEventListener(kind,()=>window.__actualAudio.push({kind,duration:player.duration,time:Date.now()}));
  return player;
 };
 window.Audio.prototype=NativeAudio.prototype;
 const AudioCtx=window.AudioContext||window.webkitAudioContext;
 const createSource=AudioCtx.prototype.createBufferSource;
 AudioCtx.prototype.createBufferSource=function(){
  const source=createSource.call(this),start=source.start;
  source.start=function(...args){
   window.__actualAudio.push({kind:'playing',duration:source.buffer?.duration,time:Date.now()});
   source.addEventListener('ended',()=>window.__actualAudio.push({kind:'ended',duration:source.buffer?.duration,time:Date.now()}));
   return start.apply(source,args);
  };
  return source;
 };
});
let dashboard,phone;
try{
 const initial=await api('/status');assert.equal(initial.workers,0);
 report.backend={host:initial.processing_host,model:initial.model,ready:initial.analysis_ready};
 assert.equal(initial.analysis_ready,true);
 if(process.env.REWIND_TEST_BACKEND==='asus') assert.equal(initial.processing_host,'ASUS via Tailscale');
 assert.equal((await api('/voice/status')).deepgram,true);
 assert.equal(initial.browser_open_access,true);
 const phoneLink=await api('/pairing',{method:'POST'});assert.equal(phoneLink.direct,true);assert.equal(phoneLink.expires_at,null);assert.equal(phoneLink.ticket,undefined);
 dashboard=await context.newPage();dashboard.on('pageerror',e=>report.errors.push(e.message));
 await dashboard.goto(origin+'/');
 await dashboard.getByText('iPhone',{exact:true}).waitFor();
 await dashboard.getByText('On the way',{exact:true}).waitFor();
 await dashboard.getByRole('heading',{name:'Ask',exact:true}).waitFor();
 assert.equal(await dashboard.locator('.grid .cell').count(),15);
 assert.equal(await dashboard.locator('[data-card="calendar"]').count(),1);
 assert.equal(await dashboard.locator('[data-card="notes"]').count(),1);
 assert.equal(await dashboard.getByText('Demo widgets',{exact:true}).count(),0);
 assert.equal(await dashboard.locator('#pairing-code').count(),0);
 await until(async()=>await dashboard.locator('.cell').last().evaluate(el=>Number(getComputedStyle(el).opacity)===1),'all dashboard widgets visible',5000);
 await dashboard.screenshot({path:path.join(out,'restored-dashboard.png'),fullPage:true});
 await dashboard.getByRole('tab',{name:'Caretaker',exact:true}).click();
 await dashboard.getByRole('heading',{name:'Rose’s day',exact:true}).waitFor();
 await dashboard.screenshot({path:path.join(out,'restored-caretaker.png'),fullPage:true});
 await dashboard.getByRole('tab',{name:'Rose',exact:true}).click();
 const fixtures=await scanFixtures(context,origin,out);
 phone=await context.newPage();await installScanCamera(phone,fixtures.both);await phone.setViewportSize({width:390,height:844});
 phone.on('pageerror',e=>report.errors.push(e.message));
 await phone.goto(origin+'/phone');await phone.getByRole('button',{name:'Record',exact:true}).waitFor();
 await until(async()=>await phone.locator('.cell').first().evaluate(el=>Number(getComputedStyle(el).opacity)===1),'phone widgets visible',5000);
 await phone.screenshot({path:path.join(out,'restored-phone.png'),fullPage:true});
 // Open the camera and scan through the real phone UI; keep the dashboard foreground for animation.
 await phone.getByRole('button',{name:'Camera',exact:true}).click();
 await until(async()=> (await api('/scans/jobs')).some(j=>j.status==='done'),'scan completed');
 await dashboard.bringToFront();
 await dashboard.locator('.letter-layer').waitFor({state:'visible',timeout:15000});
 assert.equal(await dashboard.locator('[data-card="calendar"] .cal-event').count(),0,'Bill is not filed before landing');
 await dashboard.locator('.letter-doc.kind-postcard').waitFor({state:'visible',timeout:10000});
 await dashboard.screenshot({path:path.join(out,'postcard-arriving.png')});
 await dashboard.locator('.letter-doc.kind-bill').waitFor({state:'visible',timeout:12000});
 await dashboard.screenshot({path:path.join(out,'bill-in-flight.png')});
 await until(async()=>await dashboard.locator('[data-card="calendar"] .is-landing').count()>0,'bill flies to calendar',20000);
 await dashboard.screenshot({path:path.join(out,'bill-arriving.png')});
 await until(async()=>await dashboard.locator('.letter-layer').count()===0,'both animations complete',20000);
 const scans=await api('/scans');assert.equal(scans.length,2);assert(scans.every(d=>d.source==='model+template'));
 assert.equal(scans.find(d=>d.kind==='bill').due_date,'2026-09-30');
 assert.match(await dashboard.locator('[data-card="notes"]').innerText(),/Emma/);
 assert.equal(await dashboard.locator('[data-day="2026-09-30"].has-bill').count(),1);
 await dashboard.screenshot({path:path.join(out,'mail-filed.png'),fullPage:true});
 console.log('Completed stage',report.cases.length+1);
 report.cases.push({name:'Phone camera scan → fixed postcard in Notes and bill on September 30, both animated',passed:true});
 // Real microphone capture of the synthesized test utterance, live recognition, model review and real MP3 playback.
 await dashboard.getByRole('button',{name:'Ask by voice',exact:true}).click();
 await until(async()=>await dashboard.locator('.ask-body').innerText().catch(()=>'' ).then(t=>/September 30(?:,? 2026)?/.test(t)),'spoken question answered');
 await until(async()=>await dashboard.evaluate(()=>window.__actualAudio.some(a=>a.kind==='ended'&&a.duration>2)),'actual answer audio ended');
 const latest=(await api('/answers'))[0];assert(['verified','insufficient'].includes(latest.mode));
 assert.equal(latest.verification.receipt.claims_reviewed,true);
 console.log('Completed stage',report.cases.length+1);
 report.cases.push({name:'Dashboard microphone → Deepgram → model → evidence review → Deepgram audio completion',passed:true,answer:latest.answer});
 await dashboard.screenshot({path:path.join(out,'voice-answer.png'),fullPage:true});
 for (const source of latest.evidence.filter(e=>e.kind==='context')) {
   const document=await api('/context/documents/'+encodeURIComponent(source.id));
   assert(document.text && document.source==='scan');
 }
 assert.equal(await dashboard.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // A separate postcard question uses the same live model/review/speech path.
 const beforePostcard=await dashboard.evaluate(()=>window.__actualAudio.filter(a=>a.kind==='ended'&&a.duration>2).length);
 await dashboard.getByRole('textbox',{name:'Ask a question or request a computer action',exact:true}).fill('What did Emma write to me?');
 await dashboard.getByRole('button',{name:'Send question',exact:true}).click();
 await until(async()=>{
   const answers=await api('/answers');
   return answers[0]?.question==='What did Emma write to me?' && answers[0]?.verification?.receipt?.claims_reviewed===true;
 },'postcard answer reviewed');
 const postcardAnswer=(await api('/answers'))[0];
 assert.match(postcardAnswer.answer,/Portland|Thanksgiving|apples|pie/i);
 await until(async()=>await dashboard.evaluate(()=>window.__actualAudio.filter(a=>a.kind==='ended'&&a.duration>2).length)>beforePostcard,'postcard answer audio ended');
 report.cases.push({name:'Postcard recall from Notes produces a reviewed spoken answer',passed:true,answer:postcardAnswer.answer});
 await dashboard.screenshot({path:path.join(out,'postcard-answer.png'),fullPage:true});
 // Hands-free path uses the durable conversation endpoint and the same reviewed answer UI.
 await phone.bringToFront();
 await phone.getByRole('button',{name:'Record',exact:true}).click();
 await until(async()=> (await api('/conversation/state')).turns.some(t=>t.transcript),'phone microphone transcribed');
 await phone.getByRole('button',{name:'Stop recording',exact:true}).click();
 await until(async()=> (await api('/conversation/state')).turns.some(t=>t.status==='completed'&&t.answer_id),'phone reviewed conversation completed');
 await until(async()=>await phone.evaluate(()=>window.__actualAudio.filter(a=>a.kind==='ended'&&a.duration>2).length>0),'phone spoken response completed');
 await phone.screenshot({path:path.join(out,'phone-voice-answer.png'),fullPage:true});
 console.log('Completed stage',report.cases.length+1);
 report.cases.push({name:'One-button phone Record → hands-free transcription → checked spoken response',passed:true});
 report.audio={dashboard:await dashboard.evaluate(()=>window.__actualAudio),phone:await phone.evaluate(()=>window.__actualAudio)};
 assert.equal(report.errors.length,0);
 report.passed=true;
} catch(e){report.passed=false;report.failure=String(e);report.audio={dashboard:await dashboard?.evaluate(()=>window.__actualAudio),phone:await phone?.evaluate(()=>window.__actualAudio)}; await dashboard?.screenshot({path:path.join(out,'failure.png'),fullPage:true}); report.text=await dashboard?.locator('body').innerText();throw e;}
finally{
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));await context.close();await browser.close();
}
