// Фон: закрученный «дым над бетоном» во фрагментном шейдере, рендер в низком разрешении.
import { onFrame } from './tween';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float time;
uniform float heat;   // 0 — холодный бетон, 1 — раскалённый (Карма)
uniform float spin;
uniform vec3 colA;
uniform vec3 colB;
uniform vec3 colC;

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / min(res.x,res.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  // закрутка, сильнее к центру
  a += spin * (1.2 - r) * 2.2 + time*0.05;
  vec2 q = vec2(cos(a), sin(a)) * r * 3.0;
  float t = time * 0.18;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    q += vec2(sin(q.y*1.3 + t + fi*1.7), cos(q.x*1.1 - t*0.8 + fi)) * 0.42;
  }
  float v = 0.5 + 0.5*sin(q.x + q.y*0.7);
  float w = 0.5 + 0.5*sin(length(q)*1.6 - t*2.0);
  vec3 col = mix(colA, colB, smoothstep(0.25, 0.85, v));
  col = mix(col, colC, smoothstep(0.62, 0.98, w*v) * (0.35 + heat*0.65));
  // зерно и виньетка
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)) + time) * 43758.5453);
  col += (grain - 0.5) * 0.035;
  col *= 1.0 - smoothstep(0.45, 1.25, r);
  // постеризация — «пиксельная» палитра
  col = floor(col * 18.0) / 18.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const MOODS = {
  menu: { a: '#121214', b: '#2a2a2f', c: '#7a1515', heat: 0.35, spin: 0.9 },
  game: { a: '#0d0d0f', b: '#1f1f23', c: '#4a0d0d', heat: 0.1, spin: 0.5 },
  karma: { a: '#150606', b: '#2b1010', c: '#d4862a', heat: 1, spin: 1.6 },
  win: { a: '#141210', b: '#3a3226', c: '#d4862a', heat: 0.7, spin: 1.1 },
  lose: { a: '#0a0a0b', b: '#18181b', c: '#2a0707', heat: 0.2, spin: 0.3 },
};
export type Mood = keyof typeof MOODS;

let target: Mood = 'menu';
export const setMood = (m: Mood) => (target = m);

export function startBackground(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.style.background = '#121214';
    return;
  }
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uRes = u('res'), uTime = u('time'), uHeat = u('heat'), uSpin = u('spin');
  const uA = u('colA'), uB = u('colB'), uC = u('colC');

  // текущие (сглаженные) значения
  const cur = { a: hex(MOODS.menu.a), b: hex(MOODS.menu.b), c: hex(MOODS.menu.c), heat: 0.35, spin: 0.9 };
  const PIX = 5; // размер «пикселя» фона

  const resize = () => {
    canvas.width = Math.ceil(window.innerWidth / PIX);
    canvas.height = Math.ceil(window.innerHeight / PIX);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  window.addEventListener('resize', resize);
  resize();

  onFrame((now, dt) => {
    const m = MOODS[target];
    const k = 1 - Math.pow(0.02, dt / 1000);
    const mix = (arr: number[], to: number[]) => arr.forEach((v, i) => (arr[i] = v + (to[i] - v) * k));
    mix(cur.a, hex(m.a));
    mix(cur.b, hex(m.b));
    mix(cur.c, hex(m.c));
    cur.heat += (m.heat - cur.heat) * k;
    cur.spin += (m.spin - cur.spin) * k;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, now / 1000);
    gl.uniform1f(uHeat, cur.heat);
    gl.uniform1f(uSpin, cur.spin);
    gl.uniform3fv(uA, cur.a);
    gl.uniform3fv(uB, cur.b);
    gl.uniform3fv(uC, cur.c);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
}
