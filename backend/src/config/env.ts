import { loadEnvFile } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const backendDirectory = fileURLToPath(new URL('../../', import.meta.url));
const envFile = resolve(backendDirectory, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

export interface AppConfig {
  production: boolean;
  port: number;
  host: string;
  frontendOrigins: string[];
  jwtSecret: string;
  databasePath: string;
  trustProxy: boolean;
  churchTimezone?: string;
  postalTimeoutMs?: number;
}

export function readConfig(): AppConfig {
  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
  const origin = new URL(frontendOrigin);
  if (origin.origin !== frontendOrigin || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('FRONTEND_ORIGIN deve ser uma origem HTTP/HTTPS, sem caminho ou barra final.');
  }
  if (production && origin.protocol !== 'https:') throw new Error('Use HTTPS em produção.');
  const churchTimezone = process.env.CHURCH_TIMEZONE ?? 'America/Sao_Paulo';
  new Intl.DateTimeFormat('en', { timeZone: churchTimezone }).format();
  const postalTimeoutMs = Number(process.env.POSTAL_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(postalTimeoutMs) || postalTimeoutMs < 500 || postalTimeoutMs > 10000) {
    throw new Error('POSTAL_TIMEOUT_MS deve estar entre 500 e 10000.');
  }

  const databasePath = resolve(backendDirectory, process.env.DATABASE_PATH ?? 'data/auth.sqlite');
  let jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret && !production) {
    const secretFile = resolve(dirname(databasePath), '.session-secret');
    mkdirSync(dirname(secretFile), { recursive: true });
    if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('hex'), { mode: 0o600, flag: 'wx' });
    jwtSecret = readFileSync(secretFile, 'utf8').trim();
  }
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres.');
  return {
    production, port, jwtSecret, databasePath, churchTimezone, postalTimeoutMs,
    host: process.env.HOST ?? '127.0.0.1',
    frontendOrigins: production ? [frontendOrigin] : [...new Set([frontendOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'])],
    trustProxy: process.env.TRUST_PROXY === 'true',
  };
}
