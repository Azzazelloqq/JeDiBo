// Фон: закрученный «дым над бетоном» во фрагментном шейдере, рендер в низком разрешении.
// Вид зависит от темы: тёмная — исходный красный дым, светлая — мягкий тёплый дым.
import { THEME } from './palette';
import { onFrame } from './tween';

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float time;
uniform float heat;   // 0 — холодный бетон, 1 — раскалённый (Карма)
uniform float spin;
uniform float style;  // 0 — дым (тёмная тема), 1 — спокойный дым (светлая тема), 2 — пиксельный вихрь (вариант «б»)
uniform vec3 colA;
uniform vec3 colB;
uniform vec3 colC;

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

// вариант «б»: крупный закрученный узор полосами (4 ступени между colA и colB, пятна colC)
vec3 swirl(vec2 uv, float r){
  float t = time * 0.03;
  vec2 q = uv * 1.7;
  // два вихря: ближе к центру вихря поворот сильнее
  for (int k = 0; k < 2; k++) {
    vec2 c = k == 0 ? vec2(-0.55, 0.15) : vec2(0.7, -0.25);
    vec2 d = q - c * 1.7;
    float ang = 2.6 * exp(-dot(d, d) * 0.9) * (k == 0 ? 1.0 : -0.8) + t * 0.6;
    float cs = cos(ang), sn = sin(ang);
    q = c * 1.7 + mat2(cs, -sn, sn, cs) * d;
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += 0.22 * vec2(sin(q.y*2.3 + t*3.0 + fi*1.3), cos(q.x*2.1 - t*2.0 + fi*0.7));
  }
  float v = 0.5 + 0.5*sin(q.x*2.6 + q.y*1.9);
  float w = 0.5 + 0.5*sin(q.x*1.3 - q.y*2.7 + 1.7);
  vec3 col = mix(colA, colB, floor(v * 3.99) / 3.0);
  col = mix(col, colC, step(0.86, w * v) * 0.8);
  return col * (1.0 - 0.16 * floor(smoothstep(0.55, 1.3, r) * 3.0) / 3.0);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / min(res.x,res.y);
  float r = length(uv);
  vec3 col;
  if (style > 1.5) {
    col = swirl(uv, r);
  } else if (style < 0.5) {
    // тёмная, камень: исходный закрученный дым с зерном и виньеткой
    col = smoke(uv, r, 0.0);
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)) + time) * 43758.5453);
    col += (grain - 0.5) * 0.035;
    col *= 1.0 - smoothstep(0.45, 1.25, r);
    col = floor(col * 18.0) / 18.0;
  } else {
    // светлая, камень: медленный крупный дым без зерна, ступени по яркости (без цветной «радуги»)
    col = smoke(uv, r, 1.0);
    col *= 1.0 - 0.12 * smoothstep(0.7, 1.6, r);
    float l = max(dot(col, vec3(0.299, 0.587, 0.114)), 0.001);
    col *= (floor(l * 14.0) / 14.0 + 0.035) / l;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// a — тени, b — основной тон, c — «дым».
const DARK_MOODS = {
  menu: { a: '#121214', b: '#2a2a2f', c: '#7a1515', heat: 0.35, spin: 0.9 },
  game: { a: '#0d0d0f', b: '#1f1f23', c: '#4a0d0d', heat: 0.1, spin: 0.5 },
  karma: { a: '#150606', b: '#2b1010', c: '#d4862a', heat: 1, spin: 1.6 },
  win: { a: '#141210', b: '#3a3226', c: '#d4862a', heat: 0.7, spin: 1.1 },
  lose: { a: '#0a0a0b', b: '#18181b', c: '#2a0707', heat: 0.2, spin: 0.3 },
};
const LIGHT_MOODS: typeof DARK_MOODS = {
  menu: { a: '#e3d6ca', b: '#f6eee5', c: '#ec6a55', heat: 0.3, spin: 0.9 },
  // партия: контрастнее меню по теням и с красным дымом, но медленнее — не отвлекает от поля
  game: { a: '#c98a7a', b: '#f3e4da', c: '#d93a2b', heat: 0.9, spin: 0.6 },
  karma: { a: '#eadbc6', b: '#f8ecd8', c: '#f2b95e', heat: 0.8, spin: 1.3 },
  win: { a: '#ecdfcf', b: '#fbf3e8', c: '#f2b95e', heat: 0.6, spin: 1.0 },
  lose: { a: '#d6d2cf', b: '#e8e5e2', c: '#bab4b0', heat: 0.1, spin: 0.25 },
};
const MOODS = THEME.scheme === 'dark' ? DARK_MOODS : LIGHT_MOODS;
const THEME_STYLE = THEME.scheme === 'dark' ? 0 : 1;
/** Стиль фона: свой у темы или пиксельный вихрь варианта «б» (крупнее «пиксель»). */
let style = THEME_STYLE;
let pix = 5;
let onPixChange: (() => void) | null = null;
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
  setBackgroundStyle('theme');
};

/** 'swirl' — пиксельный закрученный узор варианта «б» (цвета — через setBackgroundPalette); setMood возвращает 'theme'. */
export function setBackgroundStyle(s: 'theme' | 'swirl') {
  style = s === 'swirl' ? 2 : THEME_STYLE;
  const p = s === 'swirl' ? 8 : 5;
  if (p !== pix) {
    pix = p;
    onPixChange?.();
  }
}

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
  // размер «пикселя» фона — pix (5, у вихря «б» — 8)
  const resize = () => {
    canvas.width = Math.ceil(window.innerWidth / pix);
    canvas.height = Math.ceil(window.innerHeight / pix);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  window.addEventListener('resize', resize);
  onPixChange = resize;
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
    gl.uniform1f(uStyle, style);
    gl.uniform3fv(uA, cur.a);
    gl.uniform3fv(uB, cur.b);
    gl.uniform3fv(uC, cur.c);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });
}
