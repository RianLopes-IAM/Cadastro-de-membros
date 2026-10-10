export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin';
}

export interface StoredUser extends User {
  password_hash: string;
}

export interface AuthenticatedSession {
  id: string;
  expiresAt: number;
  user: User;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedSession;
    }
  }
}

export function publicUser(user: StoredUser): User {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
