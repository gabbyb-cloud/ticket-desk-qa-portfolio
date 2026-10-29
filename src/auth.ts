import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
export const IDLE_MS = 30 * 60 * 1000;
export const DEMO_PASSWORD = 'TicketDesk-demo-42!';
export type PasswordHash = { salt: Buffer; key: Buffer; parameters: typeof SCRYPT };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  return { salt, key: await derive(password, salt), parameters: SCRYPT };
}

export async function verifyPassword(password: string, hash: PasswordHash): Promise<boolean> {
  return timingSafeEqual(await derive(password, hash.salt), hash.key);
}

export const newToken = () => randomBytes(32).toString('hex');
export function equalToken(supplied: string | undefined, expected: string | undefined): boolean {
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}
