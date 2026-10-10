import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RegistrationLinkRow } from '../models/link.js';
import { linkFromRow } from '../models/link.js';
import type { MemberInput } from '../models/member.js';
import { HttpError, isUniqueConstraint } from '../middlewares/errors.js';
import { MemberService } from './members.js';

function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export class RegistrationLinkService {
  constructor(private database: DatabaseSync, private members: MemberService, private frontendOrigin: string) {}

  create(input: { label: string; expiresInDays: number; maxUses: number }, userId: string) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const now = Date.now();
    this.database.prepare(`INSERT INTO registration_links
      (id, label, token_hash, expires_at, max_uses, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.label, hashToken(token), now + input.expiresInDays * 86_400_000, input.maxUses, now, userId);
    return { link: this.get(id), url: this.frontendOrigin + '/cadastro/' + token };
  }

  get(id: string) {
    const row = this.database.prepare('SELECT * FROM registration_links WHERE id = ?').get(id) as unknown as RegistrationLinkRow | undefined;
    if (!row) throw new HttpError(404, 'Link não encontrado.');
    return linkFromRow(row);
  }

  list(query: { page: number; pageSize: number }) {
    const total = Number(this.database.prepare('SELECT COUNT(*) AS total FROM registration_links').get()!.total);
    const rows = this.database.prepare('SELECT * FROM registration_links ORDER BY created_at DESC, id LIMIT ? OFFSET ?')
      .all(query.pageSize, (query.page - 1) * query.pageSize) as unknown as RegistrationLinkRow[];
    return { data: rows.map(row => linkFromRow(row)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  revoke(id: string): void {
    this.get(id);
    this.database.prepare('UPDATE registration_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(Date.now(), id);
  }

  publicInfo(token: string) {
    const row = this.available(token);
    return { label: row.label, expiresAt: new Date(row.expires_at).toISOString() };
  }

  publicContext(token: string) {
    const row = this.available(token);
    return { id: row.id, expiresAt: row.expires_at };
  }

  private available(token: string): RegistrationLinkRow {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, 'Este link de cadastro não está disponível.');
    const row = this.database.prepare(`SELECT * FROM registration_links WHERE token_hash = ?
      AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses`).get(hashToken(token), Date.now()) as unknown as RegistrationLinkRow | undefined;
    if (!row) throw new HttpError(404, 'Este link de cadastro não está disponível.');
    return row;
  }

  submit(token: string, input: MemberInput): void {
    // A reserva de uso e o cadastro precisam ser atômicos para impedir reuso concorrente.
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.available(token);
      const reservation = this.database.prepare(`UPDATE registration_links SET used_count = used_count + 1
        WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND used_count < max_uses`).run(row.id, Date.now());
      if (reservation.changes !== 1) throw new HttpError(404, 'Este link de cadastro não está disponível.');
      try { this.members.create(input, row.id); }
      catch (error) {
        // Não revele pelo cadastro público se uma pessoa já consta na igreja.
        if (!isUniqueConstraint(error)) throw error;
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
