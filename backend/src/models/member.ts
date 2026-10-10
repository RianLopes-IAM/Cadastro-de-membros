import { emptyMemberDetails, type MemberDetails } from './member-details.js';
import { ageOn, elapsedCalendarTime, todayInTimezone } from '../services/dates.js';

export type MemberStatus = 'active' | 'inactive' | 'pending';

export interface MemberAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface MemberLocation { latitude: number; longitude: number; }

export interface MemberGeocoding {
  status: 'located' | 'missing_postal_code' | 'not_requested' | 'not_found' | 'unavailable' | 'coordinates_unavailable' | 'address_conflict';
  source: 'brasilapi' | 'viacep' | 'manual' | null;
  precision: 'approximate' | 'manual' | null;
  checkedAt: string | null;
}

export interface Member extends Omit<MemberDetails, 'children'> {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  joinedAt: string;
  category: string;
  status: MemberStatus;
  address: MemberAddress;
  location: MemberLocation | null;
  geocoding: MemberGeocoding;
  createdAt: string;
  updatedAt: string;
  age: number | null;
  weddingDuration: ReturnType<typeof elapsedCalendarTime> | null;
  children: (MemberDetails['children'][number] & { age: number | null })[];
  photoUrl: string | null;
  calculatedAt: string;
}

export interface MemberInput extends Partial<MemberDetails> {
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  joinedAt: string;
  category: string;
  status: MemberStatus;
  address: MemberAddress;
  location: MemberLocation | null;
  geocoding?: MemberGeocoding;
}

export type MemberPatch = Partial<Omit<MemberInput, 'address'>> & { address?: Partial<MemberAddress> | null };

export interface MemberFilters {
  q?: string;
  status?: MemberStatus;
  category?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  hasLocation?: boolean;
}

export interface MemberListQuery extends MemberFilters {
  page: number;
  pageSize: number;
  sort: 'name' | 'name_desc' | 'newest' | 'oldest';
}

export interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  joined_at: string;
  category: string;
  status: MemberStatus;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoding_json: string | null;
  details_json: string | null;
  photo_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export function memberFromRow(row: MemberRow, today = todayInTimezone('America/Sao_Paulo')): Member {
  const details = { ...emptyMemberDetails, ...(row.details_json ? JSON.parse(row.details_json) as Partial<MemberDetails> : {}) };
  return {
    ...details, photoId: row.photo_id,
    photoUrl: row.photo_id ? '/api/usuarios/' + row.id + '/foto' : null,
    age: ageOn(row.birth_date, today),
    weddingDuration: details.weddingDate && details.weddingDate <= today ? elapsedCalendarTime(details.weddingDate, today) : null,
    children: details.children.map(child => ({ name: child.name, birthDate: child.birthDate, age: ageOn(child.birthDate, today) })),
    calculatedAt: today,
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    birthDate: row.birth_date, joinedAt: row.joined_at, category: row.category, status: row.status,
    address: {
      street: row.street, number: row.number, complement: row.complement,
      neighborhood: row.neighborhood, city: row.city, state: row.state, postalCode: row.postal_code,
    },
    location: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : null,
    geocoding: row.geocoding_json ? JSON.parse(row.geocoding_json) as MemberGeocoding : {
      status: row.latitude !== null ? 'located' : row.postal_code ? 'not_requested' : 'missing_postal_code',
      source: row.latitude !== null ? 'manual' : null, precision: row.latitude !== null ? 'manual' : null, checkedAt: null,
    },
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}
