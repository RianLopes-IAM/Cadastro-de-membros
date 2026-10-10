import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AuthStore } from '../config/database.js';
import type { AppConfig } from '../config/env.js';
import { publicUser } from '../models/auth.js';
import type { AuthenticatedSession, StoredUser } from '../models/auth.js';
import { hashPassword, verifyPassword } from './password.js';

const issuer = 'cadastro-de-membros';
const audience = 'church-administration';

export class AuthService {
  private constructor(private store: AuthStore, private config: AppConfig, private dummyHash: string) {}

  static async create(store: AuthStore, config: AppConfig): Promise<AuthService> {
    return new AuthService(store, config, await hashPassword(randomUUID()));
  }

  async checkCredentials(email: string, password: string): Promise<StoredUser | undefined> {
    const user = this.store.findUserByEmail(email);
    // Execute o mesmo hash também para contas inexistentes, evitando revelar e-mails pelo tempo de resposta.
    const valid = await verifyPassword(password, user?.password_hash ?? this.dummyHash);
    return valid ? user : undefined;
  }

  login(user: StoredUser, rememberMe: boolean) {
    const seconds = rememberMe ? 7 * 24 * 60 * 60 : 8 * 60 * 60;
    const id = randomUUID();
    const token = jwt.sign({}, this.config.jwtSecret, {
      algorithm: 'HS256', issuer, audience, subject: user.id, jwtid: id, expiresIn: seconds,
    });
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    const expiresAt = decoded.exp! * 1000;
    this.store.createSession(id, user.id, expiresAt);
    return { token, seconds, user: publicUser(user), expiresAt };
  }

  authenticate(token: string): AuthenticatedSession | undefined {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, { algorithms: ['HS256'], issuer, audience });
      if (typeof payload === 'string' || !payload.sub || !payload.jti || !payload.exp) return;
      const user = this.store.findSession(payload.jti, payload.sub);
      if (!user) return;
      return { id: payload.jti, expiresAt: payload.exp * 1000, user: publicUser(user) };
    } catch { return; }
  }

  logout(sessionId: string): void { this.store.deleteSession(sessionId); }
}
