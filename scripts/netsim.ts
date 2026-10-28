// Сеть без сети: npm run netsim -- 100
// 1) проверки «плохого соперника» — сырые сообщения в комнату и подделки в клиента;
// 2) партии бот-против-бота через RoomHost + LoopbackTransport: у каждого клиента своя копия GameState,
//    на каждом действии сверяются хэши; сценарии — задержки, обрывы с переподключением, таймауты, уход игрока.
import { botAction, botPlacement } from '../src/ai/bot';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { Action, GameState, ModeConfig, PlayerId } from '../src/core/types';
import { RoomClient } from '../src/net/client';
import { commit, commitHash, randomSalt } from '../src/net/commit';
import { stateHash } from '../src/net/hash';
import { LoopbackTransport } from '../src/net/loopback';
import { decodeServerMsg, PROTOCOL_VERSION, type ClientMsg, type ClockSnap, type ServerMsg } from '../src/net/protocol';
import { RoomHost } from '../src/net/roomHost';
import { Match } from '../src/session/match';
import type { Transport } from '../src/net/transport';

const N = Number(process.argv[2] ?? 30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name: string, ok: boolean, info = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${ok || !info ? '' : ` — ${info}`}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Плохой соперник
// ════════════════════════════════════════════════════════════════════════════

function raw(host: RoomHost) {
  const got: ServerMsg[] = [];
  let closed = false;
  const side = host.attach({ send: (r) => got.push(decodeServerMsg(r)!), close: () => (closed = true) });
  return {
    got,
    get closed() {
      return closed;
    },
    send: (m: unknown) => side.receive(typeof m === 'string' ? m : JSON.stringify(m)),
    last: <T extends ServerMsg['t']>(t: T) => [...got].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined,
    clear: () => (got.length = 0),
  };
}

const hello = (token: string, name: string, n = 1) => ({ t: 'hello', v: PROTOCOL_VERSION, n, token, name, avatarSeed: '', rating: 1000 });

async function roomChecks() {
  console.log('Комната против плохого клиента:');
  const host = new RoomHost('CHECK', { ratePerSec: Infinity });
  const room = host.room;

  const v = raw(host);
  await v.send({ ...hello('version-token', 'V'), v: 999 });
  check('чужая версия протокола → error version + разрыв', v.last('error')?.code === 'version' && v.closed);

  const pre = raw(host);
  await pre.send({ t: 'ping', at: 1 });
  check('сообщение до hello → badMsg', pre.last('error')?.code === 'badMsg');
  await pre.send('{{ мусор');
  check('мусор вместо JSON → badMsg', pre.got.filter((m) => m.t === 'error').length === 2);

  const a = raw(host);
  const b = raw(host);
  await a.send(hello('token-host-aaaa', 'Хост'));
  await b.send(hello('token-guest-bbb', 'Гость'));
  check('места: первый — 0, второй — 1', a.last('welcome')?.seat === 0 && b.last('welcome')?.seat === 1);
  const stale = raw(host);
  await stale.send(hello('token-guest-bbb', 'Гость', 0));
  check('запоздавший hello старого соединения → отбит, место у нового', stale.closed && !b.closed);
  const third = raw(host);
  await third.send(hello('token-third-ccc', 'Третий'));
  check('третий клиент → full + разрыв', third.last('error')?.code === 'full' && third.closed);

  check('гость получил обязательство seed', !!b.last('seedCommit'));
  await b.send({ t: 'seedShare', value: 12345 });
  const start = b.last('start');
  check('после доли гостя — start обоим', !!start && !!a.last('start'));
  await b.send({ t: 'seedShare', value: 1 });
  check('повторная доля seed → badMsg', b.last('error')?.code === 'badMsg');

  await b.send({ t: 'submit', cseq: 1, action: { type: 'endTurn', by: 1 } });
  check('submit во время расстановки → reject', b.last('reject')?.cseq === 1);

  const probe = createGame(start!.mode, start!.seed, start!.names);
  const layA = (botPlacement(probe, 0) as Extract<Action, { type: 'place' }>).layout;
  const layB = (botPlacement(probe, 1) as Extract<Action, { type: 'place' }>).layout;

  const ca = await commit(layA);
  await a.send({ t: 'placeCommit', hash: ca.hash });
  await a.send({ t: 'placeReveal', layout: layA, salt: ca.salt });
  check('раскрытие до обоих обязательств → badMsg', a.last('error')?.code === 'badMsg');

  const cb = await commit(layB);
  await b.send({ t: 'placeCommit', hash: cb.hash });
  check('оба обязательства → placeCommits обоим', !!a.last('placeCommits') && !!b.last('placeCommits'));

  const forged = layB.map((l, i) => (i === 0 ? { ...l, rank: (l.rank + 1) % 3 } : l));
  await b.send({ t: 'placeReveal', layout: forged, salt: cb.salt });
  check('подменённая расстановка → cheat', b.last('error')?.code === 'cheat' && room.state!.phase === 'placement');

  await a.send({ t: 'placeReveal', layout: layA, salt: ca.salt });
  await b.send({ t: 'placeReveal', layout: layB, salt: cb.salt });
  const s = room.state!;
  check('честные раскрытия → партия началась', s.phase === 'play' && a.got.filter((m) => m.t === 'action').length === 2);
  const placeMsgs = b.got.filter((m): m is Extract<ServerMsg, { t: 'action' }> => m.t === 'action');
  check('раскрытия идут с солью (гость может проверить)', placeMsgs.every((m) => !!m.salt));

  const cur = s.current;
  const idle = cur === 0 ? b : a;
  const logLen = () => a.got.filter((m) => m.t === 'action').length;
  const before = logLen();
  await idle.send({ t: 'submit', cseq: 7, action: { type: 'endTurn', by: cur } });
  check('ход не в свою очередь (с чужим by) → reject', idle.last('reject')?.cseq === 7 && logLen() === before);
  const bot = botAction(s, cur)!;
  await idle.send({ t: 'submit', cseq: 8, action: bot });
  check('легальный ход соперника от чужого имени → reject', idle.last('reject')?.cseq === 8 && logLen() === before);
  const actor = cur === 0 ? a : b;
  await actor.send({ t: 'submit', cseq: 9, action: { type: 'choose', by: cur, option: '0,0' } });
  check('choose без вопроса → reject', actor.last('reject')?.cseq === 9);
  await actor.send({ t: 'submit', cseq: 10, action: { type: 'timeout', by: cur, total: true } });
  check('timeout от клиента → reject', actor.last('reject')?.cseq === 10 && room.state!.phase === 'play');
  await actor.send({ t: 'submit', cseq: 11, action: { type: 'place', by: cur, layout: layA } });
  check('place через submit → reject', actor.last('reject')?.cseq === 11);
  await actor.send({ t: 'submit', cseq: 12, action: { type: 'move', by: cur, pieceId: 'x', to: null } });
  check('кривые поля действия → reject без исключения', actor.last('reject')?.cseq === 12);
  await actor.send({ t: 'submit', cseq: 13, action: bot });
  check('свой легальный ход → применён', logLen() === before + 1);
  const a2 = raw(host);
  await a2.send(hello('token-host-aaaa', 'Другое имя', 2));
  check('повторный hello с другим именем не меняет имена партии', a2.last('start')?.names[0] === 'Хост' && room.state!.players[0].name === 'Хост');
  host.dispose();
}

class FakeTransport implements Transport<ClientMsg, ServerMsg> {
  sent: ClientMsg[] = [];
  private cb: (m: ServerMsg) => void = () => {};
  send(m: ClientMsg) {
    this.sent.push(JSON.parse(JSON.stringify(m)));
  }
  onMessage(cb: (m: ServerMsg) => void) {
    this.cb = cb;
  }
  close() {}
  push(m: ServerMsg) {
    this.cb(JSON.parse(JSON.stringify(m)));
  }
}

const CLK: ClockSnap = { turnLeft: 0, total: [0, 0], running: null, now: 0 };
const me = (token: string) => ({ token, name: 'Я', avatarSeed: '', rating: 1000 });

async function clientChecks() {
  console.log('Клиент против нечестной комнаты:');
  {
    const t = new FakeTransport();
    const c = new RoomClient(t, me('client-seed-test'));
    const errors: string[] = [];
    c.listen({ error: (code) => errors.push(code) });
    t.push({ t: 'welcome', seat: 1, code: 'X', status: 'waiting', opponent: null });
    const salt = randomSalt();
    t.push({ t: 'seedCommit', hash: await commitHash(5, salt) });
    await sleep(5);
    const share = (t.sent.find((m) => m.t === 'seedShare') as Extract<ClientMsg, { t: 'seedShare' }>).value;
    t.push({ t: 'seedReveal', value: 6, salt, share });
    await sleep(5);
    check('подменённая доля seed → cheat', errors.includes('cheat'));
  }
  {
    const t = new FakeTransport();
    const c = new RoomClient(t, me('client-seed-test2'));
    const errors: string[] = [];
    c.listen({ error: (code) => errors.push(code) });
    t.push({ t: 'welcome', seat: 1, code: 'X', status: 'waiting', opponent: null });
    const salt = randomSalt();
    t.push({ t: 'seedCommit', hash: await commitHash(5, salt) });
    await sleep(5);
    const share = (t.sent.find((m) => m.t === 'seedShare') as Extract<ClientMsg, { t: 'seedShare' }>).value;
    t.push({ t: 'seedReveal', value: 5, salt, share });
    t.push({ t: 'start', mode: CLASSIC, seed: 42, names: ['A', 'B'], log: [], clocks: CLK });
    await sleep(5);
    check('честное раскрытие, но start с другим seed → cheat', errors.includes('cheat'));
  }
  {
    const t = new FakeTransport();
    const c = new RoomClient(t, me('client-move-test'));
    const errors: string[] = [];
    c.listen({ error: (code) => errors.push(code) });
    t.push({ t: 'welcome', seat: 0, code: 'X', status: 'placement', opponent: null });
    t.push({ t: 'start', mode: CLASSIC, seed: 7, names: ['A', 'B'], log: [], clocks: CLK });
    t.push({ t: 'action', seq: 1, action: { type: 'endTurn', by: 1 }, hash: 0, clocks: CLK });
    await sleep(5);
    check('недопустимое действие от комнаты → cheat', errors.includes('cheat'));
  }
  {
    const t = new FakeTransport();
    const c = new RoomClient(t, me('client-place-test'));
    const errors: string[] = [];
    c.listen({ error: (code) => errors.push(code) });
    t.push({ t: 'welcome', seat: 0, code: 'X', status: 'placement', opponent: null });
    t.push({ t: 'start', mode: CLASSIC, seed: 9, names: ['A', 'B'], log: [], clocks: CLK });
    await sleep(5);
    const shadow = createGame(CLASSIC, 9, ['A', 'B']);
    const mine = (botPlacement(shadow, 0) as Extract<Action, { type: 'place' }>).layout;
    const theirs = (botPlacement(shadow, 1) as Extract<Action, { type: 'place' }>).layout;
    await c.place(mine);
    const myHash = (t.sent.find((m) => m.t === 'placeCommit') as Extract<ClientMsg, { t: 'placeCommit' }>).hash;
    const theirSalt = randomSalt();
    t.push({ t: 'placeCommits', hashes: [myHash, await commitHash(theirs, theirSalt)] });
    await sleep(5);
    const reveal = t.sent.find((m) => m.t === 'placeReveal') as Extract<ClientMsg, { t: 'placeReveal' }>;
    check('после обоих обязательств клиент раскрывается', !!reveal);
    dispatch(shadow, { type: 'place', by: 0, layout: mine });
    t.push({ t: 'action', seq: 1, action: { type: 'place', by: 0, layout: mine }, hash: stateHash(shadow), clocks: CLK, salt: reveal.salt });
    t.push({ t: 'action', seq: 2, action: { type: 'place', by: 1, layout: theirs }, hash: 0, clocks: CLK, salt: randomSalt() });
    await sleep(5);
    check('расстановка соперника не по обязательству → cheat', errors.includes('cheat') && c.state!.phase === 'placement');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Партии ботов
// ════════════════════════════════════════════════════════════════════════════

type Scenario = 'plain' | 'lag' | 'drop' | 'timeout' | 'abandon' | 'restore';
const SCENARIOS: Scenario[] = process.env.SC ? (process.env.SC.split(',') as Scenario[]) : ['plain', 'lag', 'drop', 'timeout', 'abandon', 'restore'];

interface Bot {
  c: RoomClient;
  /** настоящая сессия партии поверх клиента: бот ходит через неё, как ходил бы UI */
  m: Match | null;
  t: LoopbackTransport;
  alive: boolean;
  errors: string[];
  rejects: string[];
}

async function game(g: number, sc: Scenario): Promise<{ ok: boolean; why?: string; turns: number; ms: number; drops: number; timeouts: number }> {
  const t0 = Date.now();
  const mode: ModeConfig = sc === 'timeout' ? { ...CLASSIC, turnMs: 30, totalMs: 1500 } : CLASSIC;
  const hostOpts = { mode, abandonMs: 60, ratePerSec: Infinity };
  let host = new RoomHost(`G${g}`, hostOpts);
  // задержка у части сообщений: перемешивает моменты прихода, сохраняя порядок
  const delay = sc === 'plain' ? undefined : () => (Math.random() < 0.3 ? Math.random() * 4 : 0);
  const bots: Bot[] = [];

  const botAct = (s: GameState, p: PlayerId): Action | null => {
    if (s.phase === 'play') {
      if (sc === 'timeout' && Math.random() < 0.2) return null; // «задумался»: пусть сработают часы комнаты
      // боты играют долго (в среднем ~600 ходов) — для проверки сети хватит 300
      if (s.turn > 300) return { type: 'resign', by: p };
    }
    return botAction(s, p);
  };
  for (const i of [0, 1]) {
    const t = new LoopbackTransport(host, { delay });
    const b: Bot = { c: new RoomClient(t, me(`token-${g}-${i}-xxxx`)), m: null, t, alive: true, errors: [], rejects: [] };
    b.c.listen({
      // Match создаётся по первому start, как это будет делать экран партии
      start: (st) => {
        if (b.m || b.c.seat === null) return;
        const seat = b.c.seat;
        b.m = new Match({
          names: [st.players[0].name, st.players[1].name],
          controllers: seat === 0 ? ['bot', 'remote'] : ['remote', 'bot'],
          net: b.c,
          botDelay: 0,
          botAct,
        });
        b.m.start();
      },
      reject: (e) => b.rejects.push(e),
      error: (code, text) => b.errors.push(`${code}: ${text}`),
    });
    bots.push(b);
  }

  // «гость» — тот, кто сел на место 1 (при задержках hello бота 1 может прийти первым)
  let guest = bots[1];
  const reconnect = () => {
    evlog.push(`re@${host.room.snapshot().log.length}`);
    guest.t = new LoopbackTransport(host, { delay });
    guest.c.attach(guest.t);
    guest.c.hello();
  };
  let disruptions = 0;
  const STRESS = !!process.env.STRESS;
  const evlog: string[] = [];
  const leaveAt = 2 + Math.floor(Math.random() * 120);
  const disrupt = () => {
    const s = host.room.state;
    guest = bots.find((b) => b.c.seat === 1) ?? guest;
    if (!guest.alive || !s || s.phase === 'over') return;
    if (!guest.t.isOpen) return void setTimeout(disrupt, 10); // ещё не переподключился
    if (sc === 'drop') {
      guest.t.drop();
      disruptions++;
      evlog.push(`drop@${host.room.snapshot().log.length}`);
      setTimeout(reconnect, Math.random() * 40);
      if (disruptions < (STRESS ? 60 : 4)) setTimeout(disrupt, STRESS ? 5 + Math.random() * 50 : 30 + Math.random() * 300);
    } else if (sc === 'restore') {
      // «перезагрузка вкладки хоста»: комната поднимается из снимка, оба клиента переподключаются
      const data = host.room.snapshot();
      host.dispose();
      for (const b of bots) b.t.drop();
      disruptions++;
      setTimeout(() => {
        host = new RoomHost(`G${g}`, hostOpts, data);
        for (const b of bots) {
          b.t = new LoopbackTransport(host, { delay });
          b.c.attach(b.t);
          b.c.hello();
        }
      }, Math.random() * 30);
      if (disruptions < 3) setTimeout(disrupt, 50 + Math.random() * 300);
    } else if (sc === 'abandon') {
      if (s.phase !== 'play' || s.turn < leaveAt) return void setTimeout(disrupt, 5);
      guest.t.drop();
      guest.alive = false;
      guest.m?.stop();
      disruptions++;
    }
  };
  if (sc === 'drop' || sc === 'abandon' || sc === 'restore') setTimeout(disrupt, 10 + Math.random() * 300);

  bots[0].c.hello();
  bots[1].c.hello();

  const deadline = Date.now() + 60_000;
  let why = '';
  for (;;) {
    await sleep(10);
    const rs = host.room.state as GameState | null;
    const st = host.room.status;
    if (st === 'over' && rs) {
      const h = stateHash(rs);
      const live = bots.filter((b) => b.alive);
      if (live.every((b) => b.m && !b.m.isBusy && stateHash(b.m.state) === h && b.c.state && stateHash(b.c.state) === h)) break;
    }
    if (st === 'abandoned') break;
    if (Date.now() > deadline) {
      const actor = rs ? (rs.pending ? `выбор ${rs.pending.chooser} (${rs.pending.source})` : `ход ${rs.current}`) : '-';
      const cl = bots
        .map((b) => `[seat ${b.c.seat} alive=${b.alive} open=${b.t.isOpen} awaiting=${b.c.awaiting} broken=${b.c.broken} phase=${b.c.state?.phase} sync=${b.c.state ? stateHash(b.c.state) === stateHash(rs!) : '-'} match=${b.m ? `${stateHash(b.m.state) === stateHash(rs!)}/busy=${b.m.isBusy}` : '-'} applied=${b.c.appliedSeq}/${host.room.snapshot().log.length} err=${b.errors.length} rej=${b.rejects.join('|')}]`)
        .join(' ');
      why = `не завершилась: статус ${st}, ход ${rs?.turn}, ${actor}; ${cl}
    гость: ${bots.find((b) => b.c.seat === 1)?.c.trace.join(' ')}
    события: ${evlog.slice(-30).join(' ')}`;
      break;
    }
  }
  host.dispose();
  for (const b of bots) {
    b.m?.stop();
    b.t.close();
  }

  const rs = host.room.state;
  const errs = bots.flatMap((b) => b.errors);
  const rejects = sc === 'timeout' ? [] : bots.flatMap((b) => b.rejects);
  if (!why && errs.length) why = `ошибки клиентов: ${errs.slice(0, 3).join('; ')}`;
  if (!why && rejects.length) why = `неожиданные отказы: ${rejects.slice(0, 3).join('; ')}`;
  if (!why && sc === 'abandon') {
    if (host.room.status === 'abandoned') why = 'комната брошена до начала партии';
    else if (rs?.endReason?.includes('покинул') && rs.winner !== 0) why = `ушёл гость, а победил ${rs.winner}`;
    else if (!guest.alive && !rs?.endReason?.includes('покинул')) why = `гость ушёл, но партия кончилась иначе: ${rs?.endReason}`;
  }
  if (!why && sc !== 'abandon' && host.room.status !== 'over') why = `статус ${host.room.status}`;
  const timeouts = host.room.snapshot().log.filter((a) => a.type === 'timeout').length;
  return { ok: !why, why, turns: rs?.turn ?? 0, ms: Date.now() - t0, drops: disruptions, timeouts };
}

async function main() {
  await roomChecks();
  await clientChecks();
  console.log(`\nПартии ботов через комнату (${N}):`);
  const agg: Record<string, { n: number; fail: number; turns: number; ms: number; drops: number; timeouts: number }> = {};
  for (let g = 0; g < N; g++) {
    const sc = SCENARIOS[g % SCENARIOS.length];
    const r = await game(g, sc);
    const a = (agg[sc] ??= { n: 0, fail: 0, turns: 0, ms: 0, drops: 0, timeouts: 0 });
    a.drops += r.drops;
    a.timeouts += r.timeouts;
    a.n++;
    a.turns += r.turns;
    a.ms += r.ms;
    if (!r.ok) {
      a.fail++;
      failures++;
      console.log(`  FAIL партия ${g} [${sc}]: ${r.why}`);
    }
  }
  // сценарий бессмыслен, если возмущений не было вовсе (в отдельной короткой партии их может и не быть)
  for (const [sc, a] of Object.entries(agg)) {
    const none = (sc === 'drop' || sc === 'restore' || sc === 'abandon') ? !a.drops : sc === 'timeout' ? !a.timeouts : false;
    if (none) {
      failures++;
      console.log(`  FAIL сценарий ${sc}: ни одного обрыва/таймаута`);
    }
  }
  for (const [sc, a] of Object.entries(agg))
    console.log(`  ${sc.padEnd(8)} партий ${a.n}, провалов ${a.fail}, ходов в среднем ${Math.round(a.turns / a.n)}, обрывов ${a.drops}, таймаутов ${a.timeouts}, ${Math.round(a.ms / a.n)} мс/партия`);
  console.log(failures ? `\nПРОВАЛОВ: ${failures}` : '\nвсё ok');
  process.exit(failures ? 1 : 0);
}

void main();
