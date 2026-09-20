(() => {
  const phrases = ['dementia','Alzheimer’s','remembering','staying connected','daily routines','familiar faces','everyday tasks'];
  const DURATION=3.5, FIRST=.4, SPIN_DURATION=1.8, END=2.4, END_DURATION=.45;
  const TURNS=phrases.length*2-1;
  const stage=document.querySelector('#stage');
  const ending=document.querySelector('#ending'), slot=document.querySelector('#window');
  const outgoing=document.querySelector('#outgoing'), incoming=document.querySelector('#incoming');
  const play=document.querySelector('#play');
  const rendering=new URLSearchParams(location.search).has('render');
  document.body.classList.toggle('render',rendering);
  const clamp=x=>Math.min(1,Math.max(0,x));
  // Quintic smoothstep keeps velocity and acceleration continuous at both ends.
  const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10)};
  const measure=document.createElement('span');
  measure.style.cssText='position:absolute;visibility:hidden;white-space:pre;font-size:60px;line-height:96px;letter-spacing:-2.5px;font-weight:400';
  stage.append(measure);
  const widths=phrases.map(phrase=>{measure.textContent=phrase;return Math.ceil(measure.getBoundingClientRect().width)+3});
  // Reserve the widest phrase so the sentence stays still as the wheel spins.
  const phraseWidth=Math.max(...widths);
  measure.textContent='with';
  const withWidth=measure.getBoundingClientRect().width;
  measure.remove();
  function fit(){document.documentElement.style.setProperty('--scale',Math.min(innerWidth/1920,innerHeight/1080))}
  fit();addEventListener('resize',fit);
  function pose(node,y,opacity,blur){node.style.transform=`translateY(${y}px)`;node.style.opacity=opacity;node.style.filter=`blur(${blur}px)`}
  function seek(seconds){
    const t=Math.max(0,Math.min(DURATION,seconds));
    // One continuous spin: accelerate through two passes, then settle on the last phrase.
    const travel=TURNS*smooth((t-FIRST)/SPIN_DURATION);
    const row=Math.floor(travel), index=row%phrases.length;
    const changing=t>FIRST&&t<FIRST+SPIN_DURATION;
    const p=travel-row, next=(index+1)%phrases.length;
    outgoing.textContent=phrases[index]; incoming.textContent=changing?phrases[next]:'';
    slot.style.width=`${phraseWidth}px`;
    const blur=changing?2.4*Math.sin(p*Math.PI):0;
    pose(outgoing,changing?-96*p:0,1,blur);
    pose(incoming,96*(1-p),changing?1:0,blur);
    const end=smooth((t-END)/END_DURATION);
    ending.style.opacity=1-end;
    ending.style.transform=`translateY(${-22*end}px)`;
    ending.style.filter=`blur(${4*end}px)`;
    ending.style.width=`${(withWidth+16+phraseWidth)*(1-end)}px`;
    ending.style.marginLeft=`${-16*end}px`;
    return {time:t,phrase:phrases[index],changing,final:t>=END+END_DURATION,
      cacheKey:changing?`transition-${index}-${t}`:t>END&&t<END+END_DURATION?`ending-${t}`:t>=END+END_DURATION?'final':`hold-${index}`};
  }
  let current=0,last=0,running=!rendering&&!matchMedia('(prefers-reduced-motion:reduce)').matches;
  function updateButton(){play.textContent=running?'Pause':'Play';play.setAttribute('aria-label',running?'Pause animation':'Play animation')}
  function tick(now){if(running){current=Math.min(DURATION,current+(last?(now-last)/1000:0));seek(current);if(current===DURATION){running=false;updateButton()}}last=now;requestAnimationFrame(tick)}
  play.onclick=()=>{if(current>=DURATION)current=0;running=!running;last=0;updateButton()};
  document.querySelector('#replay').onclick=()=>{current=0;running=true;last=0;seek(0);updateButton()};
  if(!running&&!rendering)current=DURATION;
  window.animation={seek,duration:DURATION,phrases,ready:true};
  seek(current);updateButton();requestAnimationFrame(tick);
})();
