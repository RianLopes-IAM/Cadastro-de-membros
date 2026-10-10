export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin';
}

export interface AuthSession { user: AuthUser; expiresAt: string; }
export interface LoginCredentials { email: string; password: string; rememberMe: boolean; }

export class AuthError extends Error {
  readonly status: number;
  readonly fields: Record<string, string[]>;
  constructor(message: string, status: number, fields: Record<string, string[]> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AuthError('Não foi possível conectar. Verifique sua conexão e tente novamente.', 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; errors?: Record<string, string[]> };
    throw new AuthError(body.message ?? 'Não foi possível concluir. Tente novamente.', response.status, body.errors);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const authApi = {
  login: (credentials: LoginCredentials) => request<AuthSession>('/login', { method: 'POST', body: JSON.stringify(credentials) }),
  me: (signal?: AbortSignal) => request<AuthSession>('/me', { signal }),
  logout: () => request<void>('/logout', { method: 'POST', body: '{}' }),
};
