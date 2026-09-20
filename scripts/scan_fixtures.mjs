// Printed demo documents and an ordinary scene for real-vision browser tests.
// The test camera supplies these images; upload, recognition and filing stay real.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function scanFixtures(context, origin, out) {
  const page = await context.newPage();
  await page.goto(origin + '/print/');
  const images = {};
  for (const [name, selector] of [['letter', '.postcard-sheet'], ['bill', '.stmt']]) {
    const bytes = await page.locator(selector).first().screenshot();
    images[name] = 'data:image/png;base64,' + bytes.toString('base64');
    await fs.writeFile(path.join(out, name + '.png'), bytes);
  }
  await page.setViewportSize({width:1400,height:1000});
  await page.setContent(`<body style="margin:0;background:#b9b1a5"><img src="${images.letter}" style="position:absolute;left:30px;top:55px;width:600px"><img src="${images.bill}" style="position:absolute;right:40px;top:35px;height:930px"></body>`);
  await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
  images.both = 'data:image/png;base64,' + (await page.screenshot({path:path.join(out,'both.png')})).toString('base64');
  await page.setContent('<body style="margin:0;background:#c4ab89"><div style="position:absolute;left:350px;top:230px;width:570px;height:450px;background:#314960;border-radius:35px;box-shadow:12px 16px 15px #0003"><div style="height:100%;margin-left:55px;border-left:3px solid #dfd6c3"></div></div><div style="position:absolute;left:70px;top:270px;width:210px;height:210px;border:20px solid #f8f7f4;background:#544432;border-radius:50%;box-shadow:10px 12px 10px #0002"></div><div style="position:absolute;left:720px;top:810px;width:400px;height:20px;border-radius:10px;background:#ca6639;transform:rotate(-7deg)"></div></body>');
  images.ordinary = 'data:image/png;base64,' + (await page.screenshot({path:path.join(out,'ordinary.png')})).toString('base64');
  for (const [name,content] of [['blank',''],['receipt','CORNER MARKET<br>GROCERY RECEIPT<br><br>Apples $4.00<br>Milk $3.50<br>Bread $2.00<br><br>TOTAL $9.50<br>Paid in cash<br>Thank you!']]) {
    await page.setContent(`<body style="margin:0;background:#b9b1a5;display:grid;place-items:center;height:100vh"><article style="box-sizing:border-box;width:480px;min-height:720px;padding:60px;background:white;font:30px/1.8 monospace;color:#222;box-shadow:10px 10px 30px #0002">${content}</article></body>`);
    images[name]='data:image/png;base64,'+(await page.screenshot({path:path.join(out,name+'.png')})).toString('base64');
  }
  await page.close();
  return images;
}

export async function installScanCamera(page, initialImage) {
  await page.addInitScript(initial => {
    let selected = initial;
    window.__setScanFixture = source => { selected = source; };
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await native(constraints);
      if (!constraints.video) return stream;
      const canvas = document.createElement('canvas');
      canvas.width=1400; canvas.height=1000;
      const ctx=canvas.getContext('2d');
      const img=new Image(); let shown='';
      const draw=()=>{
        if (shown!==selected) {shown=selected; img.src=selected;}
        if (!img.complete || !img.naturalWidth) return;
        ctx.fillStyle='#c4bab0';ctx.fillRect(0,0,canvas.width,canvas.height);
        const scale=Math.min(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
        const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
        ctx.drawImage(img,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
      };
      img.src=selected;shown=selected;await img.decode();draw();
      const video=canvas.captureStream(8).getVideoTracks()[0];
      const timer=setInterval(draw,100);
      const stop=video.stop.bind(video);video.stop=()=>{clearInterval(timer);stop();};
      stream.getVideoTracks().forEach(track=>track.stop());
      return new MediaStream([...stream.getAudioTracks(),video]);
    };
  }, initialImage);
}
