import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import type { AuthService } from '../services/auth.js';
import { cookieOptions, sessionCookie } from '../middlewares/auth.js';

const loginSchema = z.object({
  email: z.string().trim().max(254).email('Informe um e-mail válido.').transform(value => value.toLowerCase()),
  password: z.string().min(1, 'Informe sua senha.').max(128, 'A senha deve ter até 128 caracteres.'),
  rememberMe: z.boolean().default(false),
});

export function authController(auth: AuthService, config: AppConfig) {
  const login: RequestHandler = async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: 'Confira os dados informados.', errors: z.flattenError(parsed.error).fieldErrors });
      return;
    }
    const { email, password, rememberMe } = parsed.data;
    const user = await auth.checkCredentials(email, password);
    if (!user) { res.status(401).json({ message: 'E-mail ou senha incorretos.' }); return; }
    const previous: unknown = req.cookies?.[sessionCookie];
    const oldSession = typeof previous === 'string' ? auth.authenticate(previous) : undefined;
    if (oldSession) auth.logout(oldSession.id);
    const session = auth.login(user, rememberMe);
    res.cookie(sessionCookie, session.token, {
      ...cookieOptions(config), ...(rememberMe ? { maxAge: session.seconds * 1000 } : {}),
    });
    res.json({ user: session.user, expiresAt: new Date(session.expiresAt).toISOString() });
  };

  const me: RequestHandler = (req, res) => {
    res.json({ user: req.auth!.user, expiresAt: new Date(req.auth!.expiresAt).toISOString() });
  };

  const logout: RequestHandler = (req, res) => {
    const token: unknown = req.cookies?.[sessionCookie];
    const session = typeof token === 'string' ? auth.authenticate(token) : undefined;
    if (session) auth.logout(session.id);
    res.clearCookie(sessionCookie, cookieOptions(config));
    res.status(204).end();
  };
  return { login, me, logout };
}
