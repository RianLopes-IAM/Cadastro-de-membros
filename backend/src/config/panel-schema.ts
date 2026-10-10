import type { DatabaseSync } from 'node:sqlite';

export function initializePanelSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS registration_links (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      max_uses INTEGER NOT NULL CHECK(max_uses > 0),
      used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0 AND used_count <= max_uses),
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT COLLATE NOCASE,
      phone TEXT,
      birth_date TEXT,
      joined_at TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'pending')),
      street TEXT,
      number TEXT,
      complement TEXT,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      postal_code TEXT,
      latitude REAL,
      longitude REAL,
      search_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      registration_link_id TEXT REFERENCES registration_links(id) ON DELETE SET NULL,
      CHECK((latitude IS NULL AND longitude IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS members_unique_email ON members(email)
      WHERE email IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS members_status ON members(status) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS members_category ON members(category) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS members_joined ON members(joined_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS members_created ON members(created_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS links_created ON registration_links(created_at);
    CREATE TABLE IF NOT EXISTS postal_code_cache (
      postal_code TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS member_photos (
      id TEXT PRIMARY KEY,
      registration_link_id TEXT REFERENCES registration_links(id) ON DELETE CASCADE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      data BLOB NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS photos_expiry ON member_photos(expires_at);
  `);
  const columns = database.prepare('PRAGMA table_info(members)').all();
  if (!columns.some(column => column.name === 'geocoding_json')) {
    database.exec('ALTER TABLE members ADD COLUMN geocoding_json TEXT');
  }
  if (!columns.some(column => column.name === 'details_json')) database.exec('ALTER TABLE members ADD COLUMN details_json TEXT');
  if (!columns.some(column => column.name === 'photo_id')) database.exec('ALTER TABLE members ADD COLUMN photo_id TEXT REFERENCES member_photos(id)');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_unique_photo ON members(photo_id) WHERE photo_id IS NOT NULL');
  database.prepare('DELETE FROM postal_code_cache WHERE expires_at < ?').run(Date.now());
}
