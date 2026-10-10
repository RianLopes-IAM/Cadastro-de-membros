import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelism, salt, digest] = hash.split('$');
  if (algorithm !== 'scrypt' || cost !== '32768' || blockSize !== '8' || parallelism !== '3' || !salt || !digest) return false;
  const stored = Buffer.from(digest, 'hex');
  const candidate = await derive(password, salt);
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
