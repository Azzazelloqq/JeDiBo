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
uniform float style;  // 0 — дым (текущий), 1 — стена опалубки, 2 — ровный бетон, 3 — тёмный стол, 4 — спокойный дым
uniform vec3 colA;
uniform vec3 colB;
uniform vec3 colC;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 smoke(vec2 uv, float r, float calm){
  float a = atan(uv.y, uv.x);
  a += spin * (1.2 - r) * 2.2 * (1.0 - calm * 0.6) + time * 0.05 * (1.0 - calm * 0.7);
  vec2 q = vec2(cos(a), sin(a)) * r * (3.0 - calm * 1.4);
  float t = time * 0.18 * (1.0 - calm * 0.7);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    q += vec2(sin(q.y*1.3 + t + fi*1.7), cos(q.x*1.1 - t*0.8 + fi)) * 0.42 * (1.0 - calm * 0.5);
  }
  float v = 0.5 + 0.5*sin(q.x + q.y*0.7);
  float w = 0.5 + 0.5*sin(length(q)*1.6 - t*2.0);
  vec3 col = mix(colA, colB, smoothstep(0.25, 0.85, v));
  return mix(col, colC, smoothstep(0.62, 0.98, w*v) * (0.35 + heat*0.65) * (1.0 - calm * 0.5));
}

// литая стена из щитов опалубки: швы, стяжки, следы досок, каждый щит своего тона; свет сверху ступенями
vec3 formwork(vec2 p, float r){
  vec2 P = vec2(48.0, 28.0);
  vec2 cell = floor(vec2(p.x + mod(floor(p.y / P.y), 2.0) * 24.0, p.y) / P);
  vec2 q = mod(vec2(p.x + mod(floor(p.y / P.y), 2.0) * 24.0, p.y), P);
  float h = hash(cell);
  vec3 col = mix(colA, colB, 0.62 + 0.22 * h);
  if (mod(q.y, 7.0) < 1.0) col *= 0.955;                 // отпечатки досок
  if (hash(floor(p)) > 0.986) col *= 0.82;               // поры
  if (q.x < 1.0 || q.y < 1.0) col *= 0.72;               // шов
  else if (q.y < 2.0 || q.x < 2.0) col *= 1.06;          // фаска щита
  vec2 tq = mod(q - vec2(7.0, 7.0), vec2(34.0, 14.0));
  if (tq.x < 2.0 && tq.y < 2.0 && q.x > 4.0 && q.y > 4.0) col *= 0.55; // стяжки
  float light = floor((1.0 - smoothstep(0.2, 1.4, r)) * 4.0) / 4.0;
  return col * (0.82 + 0.22 * light) + colC * heat * 0.08;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / min(res.x,res.y);
  float r = length(uv);
  vec3 col;
  if (style < 0.5) {
    col = smoke(uv, r, 0.0);
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)) + time) * 43758.5453);
    col += (grain - 0.5) * 0.035;
    col *= 1.0 - 0.55 * smoothstep(0.6, 1.5, r);
    col = floor(col * 18.0) / 18.0;
  } else if (style < 1.5) {
    col = formwork(floor(gl_FragCoord.xy), r);
  } else if (style < 2.5) {
    // ровный бетон: тон colB, мягкий свет сверху крупными ступенями, без зерна
    float y = gl_FragCoord.y / res.y;
    float band = floor((0.35 + 0.65 * y - 0.25 * smoothstep(0.5, 1.4, r)) * 5.0) / 5.0;
    col = mix(colA, colB, 0.55 + 0.45 * band) + colC * heat * 0.06;
  } else if (style < 3.5) {
    // тёмный стол: тёплый базальт и круг света от лампы над полем, кольцами
    float ring = floor((1.0 - smoothstep(0.15, 0.95, r)) * 5.0) / 5.0;
    vec3 dark = colA * 0.62;
    col = mix(dark, colB * 0.95, ring * 0.85) + colC * heat * 0.1 * ring;
  } else {
    col = smoke(uv, r, 1.0);
    col *= 1.0 - 0.3 * smoothstep(0.7, 1.6, r);
    // ступени по яркости, а не по каналам — без цветной «радуги» на стыках
    float l = max(dot(col, vec3(0.299, 0.587, 0.114)), 0.001);
    col *= (floor(l * 10.0) / 10.0 + 0.05) / l;
  }
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

/** Пробные стили фона партии (выбор владельца, ?bg=N): действуют во всех настроениях, кроме 'menu'. */
export const BG_STYLES = ['дым (текущий)', 'стена опалубки', 'ровный бетон', 'тёмный стол', 'спокойный дым'];
let gameStyle = 0;
export const setBackgroundStyle = (n: number) => (gameStyle = n);
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
  const uA = u('colA'), uB = u('colB'), uC = u('colC'), uStyle = u('style');

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
    gl.uniform1f(uStyle, target === 'menu' ? 0 : gameStyle);
    gl.uniform3fv(uA, cur.a);
    gl.uniform3fv(uB, cur.b);
    gl.uniform3fv(uC, cur.c);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
}
