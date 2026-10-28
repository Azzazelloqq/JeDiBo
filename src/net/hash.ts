// Хэши для сети. Без DOM: этот файл собирается и в «чистой» конфигурации (tsconfig.pure.json).
import type { GameState } from '../core/types';

/** JSON с отсортированными ключами: одинаковая строка независимо от порядка создания полей. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** FNV-1a 32 бита. */
export function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Хэш всего состояния партии: ловит любой рассинхрон между пирами (фигуры, кладбища, Карма, эффекты, вопросы). */
export function stateHash(s: GameState): number {
  return fnv1a(stableStringify(s));
}
