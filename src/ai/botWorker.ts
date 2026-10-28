// Web Worker бота: расчёт хода не блокирует интерфейс. Один агент на (уровень, место) — у агента кэш плана хода.
import { createAgent, type BotFn } from './agent';
import { levelById } from './levels';
import type { BotRequest, BotResponse } from './botClient';

const agents = new Map<string, BotFn>();

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, level, state, me, clockMs } = e.data;
  const key = `${level}:${me}`;
  let agent = agents.get(key);
  if (!agent) agents.set(key, (agent = createAgent(levelById(level).config)));
  const t0 = performance.now();
  let res: BotResponse;
  try {
    res = { id, action: agent(state, me, { clockMs }), ms: performance.now() - t0 };
  } catch (err) {
    res = { id, action: null, ms: performance.now() - t0, error: String((err as Error)?.stack ?? err) };
  }
  (self as unknown as Worker).postMessage(res);
};
