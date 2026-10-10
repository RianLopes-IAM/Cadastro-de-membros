export type RegistrationLinkStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface RegistrationLink {
  id: string;
  label: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  status: RegistrationLinkStatus;
  createdAt: string;
  revokedAt: string | null;
}

export interface RegistrationLinkRow {
  id: string;
  label: string;
  token_hash: string;
  expires_at: number;
  max_uses: number;
  used_count: number;
  created_at: number;
  revoked_at: number | null;
  created_by: string | null;
}

export function linkFromRow(row: RegistrationLinkRow, now = Date.now()): RegistrationLink {
  const status: RegistrationLinkStatus = row.revoked_at !== null ? 'revoked'
    : row.expires_at <= now ? 'expired'
    : row.used_count >= row.max_uses ? 'exhausted' : 'active';
  return {
    id: row.id, label: row.label, maxUses: row.max_uses, usedCount: row.used_count, status,
    expiresAt: new Date(row.expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString(),
    revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
  };
}
