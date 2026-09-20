import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
const require=createRequire(process.env.LOCAL_RENDER_RUNTIME||path.resolve('package.json'));
const { chromium }=require('playwright');
const output=path.resolve('exports');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--force-color-profile=srgb']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(process.env.ANIMATION_URL||'http://127.0.0.1:4317/?render=1');
await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()))});
const duration=await page.evaluate(()=>window.animation.duration);
const fps=60;
const ffmpeg=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path.join(output,'openai-helps-grandparents.mp4')],{stdio:['pipe','ignore','pipe']});
let diagnostics='';ffmpeg.stderr.on('data',chunk=>diagnostics+=chunk.toString());
const exit=once(ffmpeg,'close');let previous='',buffer;const checkpoints=new Map([[0,'opening'],[66,'spinning'],[136,'settled'],[158,'ending-transition'],[200,'final']]);
try{
 for(let frame=0;frame<Math.round(duration*fps);frame++){
  const state=await page.evaluate(t=>window.animation.seek(t),frame/fps);
  if(state.cacheKey!==previous){buffer=await page.screenshot({type:'png'});previous=state.cacheKey}
  if(checkpoints.has(frame))await writeFile(path.join(output,checkpoints.get(frame)+'.png'),buffer);
  if(!ffmpeg.stdin.write(buffer))await once(ffmpeg.stdin,'drain');
  if(frame%180===0)console.log(`${Math.round(frame/(duration*fps)*100)}% rendered`);
 }
 ffmpeg.stdin.end();const [code]=await exit;if(code!==0)throw new Error(diagnostics);
 if(errors.length)throw new Error(errors.join('\n'));
 await writeFile(path.join(output,'render.json'),JSON.stringify({width:1920,height:1080,fps,duration,frames:duration*fps,errors,phrases:await page.evaluate(()=>window.animation.phrases)},null,2));
 console.log('Exported 1080p60 video');
}finally{await browser.close();if(ffmpeg.exitCode===null)ffmpeg.kill()}
