import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../config/env.js';
import type { AuthService } from '../services/auth.js';
import { authController } from '../controllers/auth.js';
import { requireAuth } from '../middlewares/auth.js';

export function authRoutes(auth: AuthService, config: AppConfig) {
  const router = Router();
  const controller = authController(auth, config);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/login', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { message: 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.' },
  }), controller.login);
  router.get('/me', requireAuth(auth, config), controller.me);
  router.post('/logout', controller.logout);
  return router;
}
