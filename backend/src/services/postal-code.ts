import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { MemberAddress, MemberLocation } from '../models/member.js';
import { HttpError } from '../middlewares/errors.js';

export type PostalFetch = (url: string, options: RequestInit) => Promise<Response>;
export interface PostalResult {
  postalCode: string;
  address: Omit<MemberAddress, 'number' | 'complement'>;
  location: MemberLocation | null;
  source: 'brasilapi' | 'viacep';
  precision: 'approximate' | null;
}

const street = z.string().trim().max(160).nullable().optional();
const neighborhood = z.string().trim().max(100).nullable().optional();
const brasilSchema = z.object({
  cep: z.string(), state: z.string().regex(/^[A-Z]{2}$/), city: z.string().min(1).max(100),
  street, neighborhood,
  location: z.unknown().optional(),
});
const coordinateSchema = z.object({
  type: z.literal('Point').optional(),
  coordinates: z.object({ latitude: z.unknown().optional(), longitude: z.unknown().optional() }),
});
const viaSchema = z.object({
  cep: z.string(), uf: z.string().regex(/^[A-Z]{2}$/), localidade: z.string().min(1).max(100),
  logradouro: street, bairro: neighborhood,
});

export function normalizePostalCode(value: string): string {
  if (!/^\d{5}-?\d{3}$/.test(value)) throw new HttpError(400, 'CEP inválido. Informe oito dígitos.');
  return value.replace('-', '');
}

function coordinate(value: unknown, limit: number): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export class PostalCodeService {
  private pending = new Map<string, Promise<PostalResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;

  constructor(private database: DatabaseSync, private request: PostalFetch = fetch, private timeoutMs = 5000) {}

  lookup(value: string): Promise<PostalResult> {
    const cep = normalizePostalCode(value);
    const existing = this.pending.get(cep);
    if (existing) return existing;
    if (this.pending.size >= 20) throw this.error(503);
    const task = this.queue.then(() => this.resolve(cep));
    this.queue = task.catch(() => undefined);
    this.pending.set(cep, task);
    void task.finally(() => this.pending.delete(cep)).catch(() => undefined);
    return task;
  }

  private cache(cep: string, result: PostalResult | { error: 404 | 503 }, ttl: number): void {
    this.database.prepare(`INSERT INTO postal_code_cache (postal_code, payload, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(postal_code) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`)
      .run(cep, JSON.stringify(result), Date.now() + ttl);
  }

  private async json(url: string): Promise<{ status: number; body: unknown }> {
    await delay(Math.max(0, 250 - (Date.now() - this.lastRequest)));
    this.lastRequest = Date.now();
    try {
      const response = await this.request(url, {
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': 'Cadastro-de-membros/1.0' },
      });
      return { status: response.status, body: response.ok ? await response.json() as unknown : null };
    } catch { return { status: 503, body: null }; }
  }

  private async resolve(cep: string): Promise<PostalResult> {
    const cached = this.database.prepare('SELECT payload FROM postal_code_cache WHERE postal_code = ? AND expires_at > ?')
      .get(cep, Date.now());
    if (cached) {
      const value = JSON.parse(String(cached.payload)) as PostalResult | { error: 404 | 503 };
      if ('error' in value) throw this.error(value.error);
      return value;
    }
    // Only the public postal code leaves the server; no member identity or house number is sent.
    const brasil = await this.json('https://brasilapi.com.br/api/cep/v2/' + cep);
    const parsed = brasil.status === 200 ? brasilSchema.safeParse(brasil.body) : null;
    if (parsed?.success && parsed.data.cep.replace(/\D/g, '') === cep) {
      const data = parsed.data;
      const gps = coordinateSchema.safeParse(data.location);
      const latitude = coordinate(gps.success ? gps.data.coordinates.latitude : null, 90);
      const longitude = coordinate(gps.success ? gps.data.coordinates.longitude : null, 180);
      const location = latitude !== null && longitude !== null ? { latitude, longitude } : null;
      const result: PostalResult = {
        postalCode: cep, source: 'brasilapi', precision: location ? 'approximate' : null, location,
        address: { postalCode: cep, state: data.state, city: data.city, street: data.street || null, neighborhood: data.neighborhood || null },
      };
      this.cache(cep, result, location ? 7 * 86400000 : 3600000);
      return result;
    }
    const via = await this.json('https://viacep.com.br/ws/' + cep + '/json/');
    const fallback = via.status === 200 ? viaSchema.safeParse(via.body) : null;
    if (fallback?.success && fallback.data.cep.replace(/\D/g, '') === cep) {
      const data = fallback.data;
      const result: PostalResult = {
        postalCode: cep, source: 'viacep', precision: null, location: null,
        address: { postalCode: cep, state: data.uf, city: data.localidade, street: data.logradouro || null, neighborhood: data.bairro || null },
      };
      this.cache(cep, result, 3600000);
      return result;
    }
    const missing = via.status === 200 && typeof via.body === 'object' && via.body !== null
      && 'erro' in via.body && (via.body.erro === true || via.body.erro === 'true');
    const status = missing ? 404 : 503;
    this.cache(cep, { error: status }, status === 404 ? 600000 : 30000);
    throw this.error(status);
  }

  private error(status: 404 | 503): HttpError {
    return new HttpError(status, status === 404 ? 'CEP não encontrado.' : 'Consulta de CEP indisponível. Tente novamente mais tarde.');
  }
}
