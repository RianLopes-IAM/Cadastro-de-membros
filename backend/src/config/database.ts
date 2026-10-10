import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredUser } from '../models/auth.js';
import { initializePanelSchema } from './panel-schema.js';

export class AuthStore {
  readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin' CHECK(role = 'admin'),
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    `);
    initializePanelSchema(this.database);
  }

  findUserById(id: string): StoredUser | undefined {
    return this.database.prepare('SELECT id, name, email, password_hash, role FROM users WHERE id = ?')
      .get(id) as unknown as StoredUser | undefined;
  }

  findUserByEmail(email: string): StoredUser | undefined {
    return this.database.prepare('SELECT id, name, email, password_hash, role FROM users WHERE email = ?')
      .get(email) as unknown as StoredUser | undefined;
  }

  createUser(user: StoredUser): void {
    this.database.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, user.name, user.email, user.password_hash, user.role, Date.now());
  }

  createSession(id: string, userId: string, expiresAt: number): void {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    this.database.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  }

  findSession(id: string, userId: string): StoredUser | undefined {
    return this.database.prepare(`
      SELECT users.id, name, email, password_hash, role FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ? AND user_id = ? AND expires_at > ?
    `).get(id, userId, Date.now()) as unknown as StoredUser | undefined;
  }

  deleteSession(id: string): void {
    this.database.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  close(): void { this.database.close(); }
}
