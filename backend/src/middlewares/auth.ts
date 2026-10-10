import type { CookieOptions, RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import type { AuthService } from '../services/auth.js';

export const sessionCookie = 'church_session';

export function cookieOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/api' };
}

export function requireAuth(auth: AuthService, config: AppConfig): RequestHandler {
  return (req, res, next) => {
    const token: unknown = req.cookies?.[sessionCookie];
    const session = typeof token === 'string' ? auth.authenticate(token) : undefined;
    if (!session) {
      res.clearCookie(sessionCookie, cookieOptions(config));
      res.status(401).json({ message: 'Sua sessão expirou. Entre novamente.' });
      return;
    }
    req.auth = session;
    next();
  };
}

export function verifyOrigin(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    if ((origin && !config.frontendOrigins.includes(origin)) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ message: 'Origem da requisição não permitida.' });
      return;
    }
    const photoUpload = req.method === 'POST' && /^\/api\/(?:cadastro\/[^/]+|usuarios|membros)\/foto$/.test(req.path)
      && ['image/jpeg', 'image/png', 'image/webp'].some(type => req.is(type));
    if (!req.is('application/json') && !photoUpload) {
      res.status(415).json({ message: 'Envie a requisição como application/json.' });
      return;
    }
    next();
  };
}
