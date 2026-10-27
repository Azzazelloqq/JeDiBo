// Фон: закрученный «дым над бетоном» во фрагментном шейдере, рендер в низком разрешении.
// Цвета — из палитры «Дневной бетон»: средний бетон, дым оранжевый/янтарный, без «крови».
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
  // зерно и мягкая виньетка
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)) + time) * 43758.5453);
  col += (grain - 0.5) * 0.035;
  col *= 1.0 - 0.55 * smoothstep(0.6, 1.5, r);
  // постеризация — «пиксельная» палитра
  col = floor(col * 18.0) / 18.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// a — тени, b — основной тон, c — «дым». Значения совпадают с цветами палитры (PAL) или лежат между ними.
const MOODS = {
  menu: { a: '#3b3935', b: '#6e6a63', c: '#ff5a1f', heat: 0.25, spin: 0.9 },
  game: { a: '#46433f', b: '#6a6762', c: '#a9a499', heat: 0.08, spin: 0.4 },
  karma: { a: '#4f4a44', b: '#8a8378', c: '#f0b45a', heat: 0.9, spin: 1.4 },
  win: { a: '#5c5248', b: '#938e84', c: '#f0b45a', heat: 0.6, spin: 1.0 },
  lose: { a: '#3d3f42', b: '#5d6164', c: '#8a9196', heat: 0.15, spin: 0.25 },
};
export type Mood = keyof typeof MOODS;
type Colors = { a: string; b: string; c: string };

let target: Mood = 'menu';
/** Своя палитра фона поверх настроения (вариант «а» меню). null — вернуть цвета настроения. */
let custom: Colors | null = null;
/** Плавный цикл цветов: список троек [a, b, c], переход между соседними, полный круг за period мс. */
let cycle: { colors: string[][]; period: number } | null = null;

export const setMood = (m: Mood) => {
  target = m;
  custom = null;
  cycle = null;
};

/** Задать цвета фона вручную; с `cycle` — цвета плавно перетекают по кругу (период 30–60 с). */
export function setBackgroundPalette(p: Partial<Colors> & { cycle?: string[][]; period?: number } | null) {
  if (!p) {
    custom = null;
    cycle = null;
    return;
  }
  const m = MOODS[target];
  custom = { a: p.a ?? m.a, b: p.b ?? m.b, c: p.c ?? m.c };
  cycle = p.cycle?.length ? { colors: p.cycle, period: p.period ?? 45000 } : null;
}

function targetColors(now: number): number[][] {
  if (cycle) {
    const n = cycle.colors.length;
    const f = ((now % cycle.period) / cycle.period) * n;
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    const A = cycle.colors[i].map(hex);
    const B = cycle.colors[(i + 1) % n].map(hex);
    return A.map((c, k) => c.map((v, j) => v + (B[k][j] - v) * s));
  }
  const src = custom ?? MOODS[target];
  return [hex(src.a), hex(src.b), hex(src.c)];
}

export function startBackground(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) {
    canvas.style.background = MOODS.menu.b;
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
  const cur = { a: hex(MOODS.menu.a), b: hex(MOODS.menu.b), c: hex(MOODS.menu.c), heat: MOODS.menu.heat, spin: MOODS.menu.spin };
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
    const [ta, tb, tc] = targetColors(now);
    mix(cur.a, ta);
    mix(cur.b, tb);
    mix(cur.c, tc);
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
