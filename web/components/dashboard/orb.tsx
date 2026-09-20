'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

export type OrbState =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'thinking'
  | 'answer';

// WebGL orb adapted from the React Bits "Orb" fragment shader (MIT), rewritten
// against raw WebGL so it carries no extra dependency. See
// components/react-bits/SOURCE.md for the upstream attribution.
const VERT = `attribute vec2 position; varying vec2 vUv;
void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform float iTime; uniform vec3 iResolution; uniform float hue; uniform float hover; uniform float rot; uniform float energy;
varying vec2 vUv;
vec3 rgb2yiq(vec3 c){ return vec3(dot(c,vec3(0.299,0.587,0.114)), dot(c,vec3(0.596,-0.274,-0.322)), dot(c,vec3(0.211,-0.523,0.312))); }
vec3 yiq2rgb(vec3 c){ return vec3(c.x+0.956*c.y+0.621*c.z, c.x-0.272*c.y-0.647*c.z, c.x-1.106*c.y+1.703*c.z); }
vec3 adjustHue(vec3 color, float deg){ float r = deg*3.14159265/180.0; vec3 y = rgb2yiq(color); float ca=cos(r), sa=sin(r);
  float i = y.y*ca - y.z*sa; float q = y.y*sa + y.z*ca; y.y=i; y.z=q; return yiq2rgb(y); }
vec3 hash33(vec3 p3){ p3 = fract(p3*vec3(0.1031,0.11369,0.13787)); p3 += dot(p3, p3.yxz+19.19);
  return -1.0 + 2.0*fract(vec3(p3.x+p3.y, p3.x+p3.z, p3.y+p3.z)*p3.zyx); }
float snoise3(vec3 p){ const float K1=0.333333333; const float K2=0.166666667;
  vec3 i = floor(p + (p.x+p.y+p.z)*K1); vec3 d0 = p - (i - (i.x+i.y+i.z)*K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx); vec3 i1 = e*(1.0-e.zxy); vec3 i2 = 1.0 - e.zxy*(1.0-e);
  vec3 d1 = d0-(i1-K2); vec3 d2 = d0-(i2-K1); vec3 d3 = d0-0.5;
  vec4 h = max(0.6 - vec4(dot(d0,d0),dot(d1,d1),dot(d2,d2),dot(d3,d3)), 0.0);
  vec4 n = h*h*h*h*vec4(dot(d0,hash33(i)),dot(d1,hash33(i+i1)),dot(d2,hash33(i+i2)),dot(d3,hash33(i+1.0)));
  return dot(vec4(31.316), n); }
vec4 extractAlpha(vec3 c){ float a = max(max(c.r,c.g),c.b); return vec4(c.rgb/(a+1e-5), a); }
const vec3 baseColor1 = vec3(0.611765,0.262745,0.996078);
const vec3 baseColor2 = vec3(0.298039,0.760784,0.913725);
const vec3 baseColor3 = vec3(0.062745,0.078431,0.600000);
const float innerRadius = 0.6; const float noiseScale = 0.65;
float light1(float i, float a, float d){ return i/(1.0+d*a); }
float light2(float i, float a, float d){ return i/(1.0+d*d*a); }
vec4 draw(vec2 uv){
  vec3 color1 = adjustHue(baseColor1, hue); vec3 color2 = adjustHue(baseColor2, hue); vec3 color3 = adjustHue(baseColor3, hue);
  float ang = atan(uv.y, uv.x); float len = length(uv); float invLen = len > 0.0 ? 1.0/len : 0.0;
  float n0 = snoise3(vec3(uv*noiseScale, iTime*0.5))*0.5+0.5;
  float r0 = mix(mix(innerRadius,1.0,0.4), mix(innerRadius,1.0,0.6), n0);
  float d0 = distance(uv, (r0*invLen)*uv);
  float v0 = light1(1.0, 10.0, d0);
  v0 *= smoothstep(r0*1.05, r0, len);
  v0 *= smoothstep(r0*0.8, r0*0.95, len);
  float cl = cos(ang + iTime*2.0)*0.5+0.5;
  float a = iTime*-1.0; vec2 pos = vec2(cos(a), sin(a))*r0; float d = distance(uv, pos);
  float v1 = light2(1.5, 5.0, d); v1 *= light1(1.0, 50.0, d0);
  float v2 = smoothstep(1.0, mix(innerRadius,1.0,n0*0.5), len);
  float v3 = smoothstep(innerRadius, mix(innerRadius,1.0,0.5), len);
  vec3 colBase = mix(color1, color2, cl);
  vec3 col = mix(color3, colBase, v0);
  col = clamp((col + v1) * v2 * v3, 0.0, 1.0);
  return extractAlpha(col);
}
void main(){
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 center = iResolution.xy*0.5; float size = min(iResolution.x, iResolution.y);
  vec2 uv = (fragCoord - center)/size*2.0;
  float s = sin(rot), c = cos(rot); uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y);
  uv.x += hover*0.1*sin(uv.y*10.0 + iTime*(1.0+energy*3.0));
  uv.y += hover*0.1*sin(uv.x*10.0 + iTime*(1.0+energy*3.0));
  vec4 col = draw(uv);
  gl_FragColor = vec4(col.rgb*col.a, col.a);
}`;

const STATES: Record<
  OrbState,
  { speed: number; hover: number; energy: number; hue: number }
> = {
  idle: { speed: 0.45, hover: 0, energy: 0, hue: 0 },
  starting: { speed: 1.1, hover: 1, energy: 0.6, hue: 25 },
  listening: { speed: 1.1, hover: 1, energy: 0.6, hue: 25 },
  thinking: { speed: 2.4, hover: 0.35, energy: 1, hue: -20 },
  answer: { speed: 0.6, hover: 0.15, energy: 0.2, hue: 40 },
};

export function Orb({
  state,
  size = 168,
  hue = 0,
}: {
  state: OrbState;
  size?: number;
  hue?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    if (!gl) {
      container.classList.add('orb-fallback');
      return () => {
        canvas.remove();
      };
    }

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    // oxlint-disable-next-line react/react-compiler -- WebGL API, not a React hook
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uTime = u('iTime'),
      uRes = u('iResolution'),
      uHue = u('hue'),
      uHover = u('hover'),
      uRot = u('rot'),
      uEnergy = u('energy');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth,
        h = container.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform3f(
        uRes,
        canvas.width,
        canvas.height,
        canvas.width / canvas.height,
      );
    };
    resize();
    window.addEventListener('resize', resize);

    const cur = { hover: 0, energy: 0, hue: 0 };
    let shownState: OrbState | null = null;
    let t = 0,
      rot = 0,
      last = performance.now(),
      speed = 0.45,
      pointer = 0,
      raf = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const onMove = (e: PointerEvent) => {
      const r = container.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2,
        y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      pointer = Math.hypot(x, y) < 0.85 ? 1 : 0;
    };
    const onLeave = () => (pointer = 0);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerleave', onLeave);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const target = STATES[stateRef.current];
      if (shownState !== stateRef.current) {
        // A tap changes the animation on this frame, even on a slow GPU.
        shownState = stateRef.current;
        speed = target.speed;
        cur.hover = target.hover;
        cur.energy = target.energy;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      speed += (target.speed - speed) * 0.05;
      t += dt * (reduced ? 0 : speed);
      cur.hover += (Math.max(target.hover, pointer * 0.6) - cur.hover) * 0.08;
      cur.energy += (target.energy - cur.energy) * 0.06;
      cur.hue += (target.hue - cur.hue) * 0.04;
      if (cur.hover > 0.05) rot += dt * 0.3 * (1 + cur.energy);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uHover, cur.hover);
      gl.uniform1f(uEnergy, cur.energy);
      gl.uniform1f(uRot, rot);
      gl.uniform1f(uHue, hue + cur.hue);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, [hue]);

  return (
    <div
      ref={ref}
      className="orb"
      data-orb-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
