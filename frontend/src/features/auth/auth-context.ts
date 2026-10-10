import { createContext } from 'react';
import type { AuthSession, LoginCredentials } from '../../services/auth';

export interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  connectionError: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
