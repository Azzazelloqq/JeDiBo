// Commit-reveal: игрок сначала публикует хэш значения с солью, а само значение — позже.
// Так хост не может подстроить seed или расстановку под уже известные данные гостя.
import { stableStringify } from './hash';

export interface Commitment<T> {
  value: T;
  salt: string;
  hash: string;
}

const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function randomSalt(bytes = 16): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function commitHash(value: unknown, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${stableStringify(value)}|${salt}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

export async function commit<T>(value: T): Promise<Commitment<T>> {
  const salt = randomSalt();
  return { value, salt, hash: await commitHash(value, salt) };
}

export async function verify(value: unknown, salt: string, hash: string): Promise<boolean> {
  return typeof salt === 'string' && salt.length >= 16 && (await commitHash(value, salt)) === hash;
}

/** Совместный seed из долей хоста и гостя (32-битное перемешивание, результат — положительный int31). */
export function mixSeed(a: number, b: number): number {
  let h = Math.imul((a ^ 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) & 0x7fffffff;
}

export function randomSeedShare(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] | 0;
}
