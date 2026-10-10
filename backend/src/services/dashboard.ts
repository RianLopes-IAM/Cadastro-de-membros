import type { DatabaseSync } from 'node:sqlite';
import type { MemberRow } from '../models/member.js';
import { memberFromRow } from '../models/member.js';
import { nextBirthday, todayInTimezone } from './dates.js';
import { normalizeSearch } from './members.js';

const missionaryCategories = new Set(['missionario', 'missionaria', 'missionarios', 'missionarias']);

export class DashboardService {
  constructor(private database: DatabaseSync, private timezone: string) {}

  summary(birthdayDays: number, now = new Date()) {
    const today = todayInTimezone(this.timezone, now);
    const counts = this.database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(status = 'active'), 0) AS active,
      COALESCE(SUM(status = 'inactive'), 0) AS inactive,
      COALESCE(SUM(status = 'pending'), 0) AS pending,
      COALESCE(SUM(latitude IS NOT NULL), 0) AS with_location,
      COALESCE(SUM(CASE WHEN json_extract(details_json, '$.baptismDate') BETWEEN '1900-01-01' AND ?
        OR json_extract(details_json, '$.admissionType') = 'baptism' THEN 1 ELSE 0 END), 0) AS baptized
      FROM members WHERE deleted_at IS NULL`).get(today)!;
    const categoryRows = this.database.prepare(`SELECT category AS label, COUNT(*) AS count FROM members
      WHERE deleted_at IS NULL GROUP BY category ORDER BY count DESC, category`).all();
    const missionaries = categoryRows.reduce((total, row) =>
      total + (missionaryCategories.has(normalizeSearch(String(row.label).trim())) ? Number(row.count) : 0), 0);
    const cityRows = this.database.prepare(`SELECT city AS label, COUNT(*) AS count FROM members
      WHERE deleted_at IS NULL AND city IS NOT NULL AND city <> '' GROUP BY city ORDER BY count DESC, city`).all();

    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7)) - 1;
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(year, month - 11 + i, 1)).toISOString().slice(0, 7));
    const registrationRows = this.database.prepare(`SELECT substr(joined_at, 1, 7) AS month, COUNT(*) AS count
      FROM members WHERE deleted_at IS NULL AND joined_at >= ? AND joined_at <= ?
      GROUP BY substr(joined_at, 1, 7)`).all(months[0] + '-01', today);
    const byMonth = new Map(registrationRows.map(row => [String(row.month), Number(row.count)]));
    const birthdayRows = this.database.prepare(`SELECT id, name, birth_date FROM members
      WHERE deleted_at IS NULL AND status = 'active' AND birth_date IS NOT NULL`).all();
    const birthdays = birthdayRows.map(row => {
      const next = nextBirthday(String(row.birth_date), today);
      return { id: String(row.id), name: String(row.name), birthDate: String(row.birth_date), nextBirthday: next.date, daysUntil: next.daysUntil, turningAge: next.turningAge };
    }).filter(birthday => birthday.daysUntil <= birthdayDays)
      .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name, 'pt-BR'));
    const latestRows = this.database.prepare('SELECT * FROM members WHERE deleted_at IS NULL ORDER BY created_at DESC, id LIMIT 5')
      .all() as unknown as MemberRow[];
    const activeLinks = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM registration_links
      WHERE revoked_at IS NULL AND expires_at > ? AND used_count < max_uses`).get(now.getTime())!.total);
    return {
      asOf: today, timezone: this.timezone,
      counts: {
        total: Number(counts.total), active: Number(counts.active), inactive: Number(counts.inactive),
        pending: Number(counts.pending), withLocation: Number(counts.with_location),
        withoutLocation: Number(counts.total) - Number(counts.with_location), activeLinks,
        missionaries, baptized: Number(counts.baptized),
      },
      cards: [
        { key: 'members', label: 'Membros cadastrados', value: Number(counts.total) },
        { key: 'missionaries', label: 'Missionários', value: missionaries },
        { key: 'baptized', label: 'Batizados', value: Number(counts.baptized) },
      ],
      byCategory: categoryRows.map(row => ({ label: String(row.label), count: Number(row.count) })),
      byCity: cityRows.map(row => ({ label: String(row.label), count: Number(row.count) })),
      membershipByMonth: months.map(month => ({ month, count: byMonth.get(month) ?? 0 })),
      birthdays: { windowDays: birthdayDays, total: birthdays.length, data: birthdays.slice(0, 100), truncated: birthdays.length > 100 },
      latestMembers: latestRows.map(row => memberFromRow(row, today)),
    };
  }
}
