import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Member, MemberFilters, MemberInput, MemberListQuery, MemberPatch, MemberRow } from '../models/member.js';
import { memberFromRow } from '../models/member.js';
import { emptyAddress } from '../models/validation.js';
import { HttpError } from '../middlewares/errors.js';
import { memberDetails, timelineErrors } from '../models/member-details.js';
import { todayInTimezone } from './dates.js';
import { PhotoService } from './photos.js';

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function searchPattern(value: string): string {
  return '%' + normalizeSearch(value).replace(/[\\%_]/g, '\\$&') + '%';
}

const memberOrders: Record<MemberListQuery['sort'], string> = {
  name: 'name COLLATE NOCASE ASC, id', name_desc: 'name COLLATE NOCASE DESC, id',
  newest: 'created_at DESC, id', oldest: 'created_at ASC, id',
};

export function memberWhere(filters: MemberFilters) {
  const conditions = ['deleted_at IS NULL'];
  const values: SQLInputValue[] = [];
  if (filters.q) {
    const terms = filters.q.trim().split(/\s+/).filter(Boolean);
    if (terms.length) {
      const textConditions = terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(' AND ');
      values.push(...terms.map(searchPattern));
      const digits = filters.q.replace(/\D/g, '');
      if (/^[+\d\s().-]+$/.test(filters.q) && digits.length >= 3) {
        conditions.push(`((${textConditions}) OR search_text LIKE ?)`);
        values.push('%' + digits + '%');
      } else conditions.push('(' + textConditions + ')');
    }
  }
  for (const column of ['status', 'category', 'city', 'state', 'neighborhood'] as const) {
    if (filters[column] !== undefined) { conditions.push(`${column} = ?`); values.push(filters[column]!); }
  }
  if (filters.hasLocation !== undefined) conditions.push(filters.hasLocation ? 'latitude IS NOT NULL AND longitude IS NOT NULL' : 'latitude IS NULL');
  return { clause: conditions.join(' AND '), values };
}

function inputValues(input: MemberInput): SQLInputValue[] {
  const address = input.address;
  const searchText = normalizeSearch([
    input.name, input.email, input.phone, input.phone?.replace(/\D/g, ''),
    input.category, address.city, address.neighborhood,
  ].filter(Boolean).join(' '));
  return [
    input.name, input.email, input.phone, input.birthDate, input.joinedAt, input.category, input.status,
    address.street, address.number, address.complement, address.neighborhood, address.city, address.state, address.postalCode,
    input.location?.latitude ?? null, input.location?.longitude ?? null, searchText,
    input.geocoding ? JSON.stringify(input.geocoding) : null,
    JSON.stringify({ ...memberDetails(input), photoId: undefined }), input.photoId ?? null,
  ];
}

export class MemberService {
  private photos: PhotoService;
  constructor(private database: DatabaseSync, private timezone = 'America/Sao_Paulo') { this.photos = new PhotoService(database); }

  private fromRow(row: MemberRow): Member { return memberFromRow(row, todayInTimezone(this.timezone)); }

  private validate(input: MemberInput): void {
    const errors = timelineErrors(input);
    if (Object.keys(errors).length) throw new HttpError(400, 'Confira a ordem das datas informadas.', errors);
  }

  findRow(id: string, includeArchived = false): MemberRow {
    const row = this.database.prepare(`SELECT * FROM members WHERE id = ?${includeArchived ? '' : ' AND deleted_at IS NULL'}`)
      .get(id) as unknown as MemberRow | undefined;
    if (!row) throw new HttpError(404, 'Membro não encontrado.');
    return row;
  }

  get(id: string): Member { return this.fromRow(this.findRow(id)); }

  list(query: MemberListQuery) {
    const { clause, values } = memberWhere(query);
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM members WHERE ${clause}`).get(...values)!.total);
    const order = memberOrders[query.sort];
    const rows = this.database.prepare(`SELECT * FROM members WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as unknown as MemberRow[];
    return { data: rows.map(row => this.fromRow(row)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }

  filterOptions() {
    const distinct = (column: 'category' | 'city' | 'state' | 'neighborhood') => {
      const rows = this.database.prepare(`SELECT ${column} AS value, COUNT(*) AS count FROM members
        WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND TRIM(${column}) <> ''
        GROUP BY ${column} ORDER BY ${column} COLLATE NOCASE, ${column} LIMIT 201`).all();
      return {
        data: rows.slice(0, 200).map(row => ({ value: String(row.value), label: String(row.value), count: Number(row.count) })),
        truncated: rows.length > 200,
      };
    };
    const counts = this.database.prepare('SELECT status, COUNT(*) AS count FROM members WHERE deleted_at IS NULL GROUP BY status').all();
    return {
      status: (['active', 'inactive', 'pending'] as const).map(value => ({
        value, label: { active: 'Ativo', inactive: 'Inativo', pending: 'Pendente' }[value],
        count: Number(counts.find(row => row.status === value)?.count ?? 0),
      })),
      categories: distinct('category'), cities: distinct('city'), states: distinct('state'), neighborhoods: distinct('neighborhood'),
      location: [{ value: 'true', label: 'Com localização' }, { value: 'false', label: 'Sem localização' }],
      sort: [
        { value: 'name', label: 'Nome: A–Z' }, { value: 'name_desc', label: 'Nome: Z–A' },
        { value: 'newest', label: 'Mais recentes' }, { value: 'oldest', label: 'Mais antigos' },
      ],
    };
  }

  create(input: MemberInput, registrationLinkId: string | null = null, actorUserId?: string): Member {
    this.validate(input);
    this.photos.assertAttachable(input.photoId, { linkId: registrationLinkId ?? undefined, userId: actorUserId });
    const id = randomUUID();
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO members (id, name, email, phone, birth_date, joined_at, category, status,
        street, number, complement, neighborhood, city, state, postal_code, latitude, longitude,
        search_text, geocoding_json, details_json, photo_id, created_at, updated_at, registration_link_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ...inputValues(input), now, now, registrationLinkId);
    return this.get(id);
  }

  update(id: string, patch: MemberPatch, actorUserId?: string): Member {
    const current = this.get(id);
    const input: MemberInput = {
      ...current, ...patch,
      address: patch.address === null ? { ...emptyAddress } : { ...current.address, ...patch.address },
    };
    this.validate(input);
    this.photos.assertAttachable(input.photoId, { userId: actorUserId }, current.photoId);
    this.database.prepare(`UPDATE members SET
      name = ?, email = ?, phone = ?, birth_date = ?, joined_at = ?, category = ?, status = ?,
      street = ?, number = ?, complement = ?, neighborhood = ?, city = ?, state = ?, postal_code = ?,
      latitude = ?, longitude = ?, search_text = ?, geocoding_json = ?, details_json = ?, photo_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
    `).run(...inputValues(input), Math.max(Date.now(), Date.parse(current.updatedAt) + 1), id);
    return this.get(id);
  }

  archive(id: string): void {
    const row = this.findRow(id, true);
    if (row.deleted_at !== null) return;
    const now = Math.max(Date.now(), row.updated_at + 1);
    this.database.prepare('UPDATE members SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
  }

  restore(id: string): Member {
    const row = this.findRow(id, true);
    this.database.prepare('UPDATE members SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(Math.max(Date.now(), row.updated_at + 1), id);
    return this.get(id);
  }

  map(query: MemberFilters & { limit: number; page?: number; bounds?: number[] }) {
    const { clause, values } = memberWhere(query);
    const counts = this.database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN latitude IS NULL THEN 1 ELSE 0 END), 0) AS without_location
      FROM members WHERE ${clause}`).get(...values)!;
    const conditions = [clause, 'latitude IS NOT NULL', 'longitude IS NOT NULL'];
    const boundedValues = [...values];
    if (query.bounds) {
      conditions.push('longitude BETWEEN ? AND ?', 'latitude BETWEEN ? AND ?');
      boundedValues.push(query.bounds[0], query.bounds[2], query.bounds[1], query.bounds[3]);
    }
    const boundedClause = conditions.join(' AND ');
    const withinBounds = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM members WHERE ${boundedClause}`).get(...boundedValues)!.total);
    const page = query.page ?? 1;
    const rows = this.database.prepare(`SELECT * FROM members WHERE ${boundedClause} ORDER BY name COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...boundedValues, query.limit, (page - 1) * query.limit) as unknown as MemberRow[];
    return {
      type: 'FeatureCollection' as const,
      features: rows.map(row => ({
        type: 'Feature' as const, id: row.id,
        geometry: { type: 'Point' as const, coordinates: [row.longitude!, row.latitude!] },
        properties: {
          id: row.id, name: row.name, category: row.category, status: row.status,
          address: memberFromRow(row).address, city: row.city, neighborhood: row.neighborhood,
          geocoding: memberFromRow(row).geocoding,
        },
      })),
      meta: {
        total: Number(counts.total), withoutLocation: Number(counts.without_location),
        located: Number(counts.total) - Number(counts.without_location),
        withinBounds, returned: rows.length, truncated: withinBounds > query.limit,
        page, totalPages: Math.ceil(withinBounds / query.limit),
        nextPage: page * query.limit < withinBounds ? page + 1 : null,
      },
    };
  }

  missingLocations(query: MemberListQuery) {
    const { clause, values } = memberWhere(query);
    const condition = clause + ' AND latitude IS NULL';
    const total = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM members WHERE ${condition}`).get(...values)!.total);
    const rows = this.database.prepare(`SELECT * FROM members WHERE ${condition} ORDER BY ${memberOrders[query.sort]} LIMIT ? OFFSET ?`)
      .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as unknown as MemberRow[];
    return { data: rows.map(row => this.fromRow(row)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }
}
