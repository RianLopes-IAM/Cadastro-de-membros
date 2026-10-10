import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import sharp, { type OutputInfo } from 'sharp';
import { HttpError } from '../middlewares/errors.js';

export interface PhotoOwner { userId?: string; linkId?: string; expiresAt?: number; }
export const photoTypes = ['image/jpeg', 'image/png', 'image/webp'];

export class PhotoService {
  private processing = 0;
  constructor(private database: DatabaseSync) {}

  async upload(buffer: Buffer, mime: string, owner: PhotoOwner, validateOwner = () => {}) {
    if (!photoTypes.includes(mime)) throw new HttpError(415, 'Envie uma foto JPEG, PNG ou WebP.');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new HttpError(413, 'A foto deve ter até 5 MB.');
    const detected = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
      : buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (detected !== mime) throw new HttpError(400, 'O arquivo não corresponde ao formato da foto.');
    if (this.processing >= 2) throw new HttpError(429, 'Há fotos sendo processadas. Tente novamente em instantes.');
    this.processing++;
    let result: { data: Buffer; info: OutputInfo };
    try {
      const image = sharp(buffer, { failOn: 'warning', limitInputPixels: 20_000_000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Imagem inválida');
      result = await image.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    } catch { throw new HttpError(400, 'Foto inválida. Use uma imagem estática de até 20 megapixels.'); }
    finally { this.processing--; }
    validateOwner();
    const now = Date.now();
    this.database.prepare(`DELETE FROM member_photos WHERE expires_at <= ?
      AND id NOT IN (SELECT photo_id FROM members WHERE photo_id IS NOT NULL)`).run(now);
    const pending = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM member_photos
      WHERE (registration_link_id = ? OR created_by = ?) AND id NOT IN (SELECT photo_id FROM members WHERE photo_id IS NOT NULL)`)
      .get(owner.linkId ?? null, owner.userId ?? null)!.total);
    if (pending >= (owner.linkId ? 10 : 100)) throw new HttpError(429, 'Existem muitas fotos aguardando cadastro. Conclua o cadastro antes de enviar outra.');
    const id = randomUUID();
    const expiresAt = Math.min(now + 86400000, owner.expiresAt ?? Infinity);
    this.database.prepare(`INSERT INTO member_photos (id, registration_link_id, created_by, data, width, height, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, owner.linkId ?? null, owner.userId ?? null, result.data, result.info.width, result.info.height, now, expiresAt);
    return { photoId: id, contentType: 'image/webp', width: result.info.width, height: result.info.height, byteLength: result.data.length, expiresAt: new Date(expiresAt).toISOString() };
  }

  assertAttachable(id: string | null | undefined, owner: PhotoOwner, currentPhotoId: string | null = null): void {
    if (!id || id === currentPhotoId) return;
    const row = this.database.prepare(`SELECT id FROM member_photos WHERE id = ? AND expires_at > ?
      AND ((registration_link_id = ? AND created_by IS NULL) OR (created_by = ? AND registration_link_id IS NULL))
      AND id NOT IN (SELECT photo_id FROM members WHERE photo_id IS NOT NULL)`).get(id, Date.now(), owner.linkId ?? null, owner.userId ?? null);
    if (!row) throw new HttpError(400, 'A foto não está disponível para este cadastro. Envie-a novamente.');
  }

  get(id: string): Uint8Array {
    const row = this.database.prepare('SELECT data FROM member_photos WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Foto não encontrada.');
    return row.data as Uint8Array;
  }
}
