import type { AuthStore } from '../config/database.js';
import { publicUser } from '../models/auth.js';
import type { StoredUser } from '../models/auth.js';
import type { ProfileUpdateInput, ProfileUpdateResult } from '../models/profile.js';
import { hashPassword, verifyPassword } from './password.js';
import { HttpError, isUniqueConstraint } from '../middlewares/errors.js';

export class ProfileService {
  constructor(private store: AuthStore) {}

  private storedUser(id: string): StoredUser {
    const user = this.store.findUserById(id);
    if (!user) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
    return user;
  }

  get(id: string) { return publicUser(this.storedUser(id)); }

  async update(id: string, sessionId: string, input: ProfileUpdateInput): Promise<ProfileUpdateResult> {
    const current = this.storedUser(id);
    const emailChanged = input.email !== undefined && input.email !== current.email;
    const passwordChanged = input.newPassword !== undefined;
    if ((emailChanged || passwordChanged) && (!input.currentPassword || !await verifyPassword(input.currentPassword, current.password_hash))) {
      throw new HttpError(400, 'Informe a senha atual correta para alterar o e-mail ou a senha.', { currentPassword: ['Senha atual incorreta ou não informada.'] });
    }
    const name = input.name ?? current.name;
    const email = input.email ?? current.email;
    const hash = input.newPassword === undefined ? current.password_hash : await hashPassword(input.newPassword);
    const database = this.store.database;
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!this.store.findSession(sessionId, id)) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
      const update = database.prepare('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ? AND password_hash = ? AND email = ? AND name = ?')
        .run(name, email, hash, id, current.password_hash, current.email, current.name);
      if (update.changes !== 1) throw new HttpError(409, 'Seu perfil foi alterado em outra solicitação. Atualize e tente novamente.');
      if (passwordChanged) database.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      else if (emailChanged) database.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(id, sessionId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      if (isUniqueConstraint(error)) throw new HttpError(409, 'Este e-mail já está sendo usado por outra conta.', { email: ['E-mail já cadastrado.'] });
      throw error;
    }
    return { user: this.get(id), requiresLogin: passwordChanged };
  }

  async changePassword(id: string, sessionId: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
    await this.update(id, sessionId, input);
  }
}
