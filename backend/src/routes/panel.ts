import { Router, raw } from 'express';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../config/env.js';
import type { AuthStore } from '../config/database.js';
import type { AuthService } from '../services/auth.js';
import { MemberService } from '../services/members.js';
import { DashboardService } from '../services/dashboard.js';
import { ProfileService } from '../services/profile.js';
import { RegistrationLinkService } from '../services/links.js';
import { memberController } from '../controllers/members.js';
import { panelController } from '../controllers/panel.js';
import { registrationController } from '../controllers/registration.js';
import { requireAuth } from '../middlewares/auth.js';
import { PostalCodeService, type PostalFetch } from '../services/postal-code.js';
import { MemberLocationService } from '../services/member-location.js';
import { mapController } from '../controllers/map.js';
import { PhotoService, photoTypes } from '../services/photos.js';
import { formController } from '../controllers/form.js';

const noStore: RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

export function panelRoutes(store: AuthStore, auth: AuthService, config: AppConfig, postalFetch?: PostalFetch) {
  const timezone = config.churchTimezone ?? 'America/Sao_Paulo';
  const members = new MemberService(store.database, timezone);
  const postal = new PostalCodeService(store.database, postalFetch, config.postalTimeoutMs);
  const locations = new MemberLocationService(members, postal);
  const map = mapController(postal, locations, members);
  const links = new RegistrationLinkService(store.database, members, config.frontendOrigins[0]);
  const form = formController(members, links, new PhotoService(store.database), timezone);
  const photoBody = raw({ type: photoTypes, limit: '5mb', inflate: false });
  const photoLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas fotos enviadas. Aguarde uma hora e tente novamente.' } });
  const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas consultas ao formulário. Aguarde e tente novamente.' } });
  const controller = panelController({
    members, links, dashboard: new DashboardService(store.database, timezone), profile: new ProfileService(store),
  }, config);
  const router = Router();
  router.use(['/painel', '/dashboard', '/mapa', '/links', '/perfil', '/cep'], noStore, requireAuth(auth, config));
  router.get('/painel', controller.panel);
  router.get('/dashboard', controller.dashboard);
  router.get('/mapa', controller.map);
  router.get('/mapa/pendentes', map.missing);
  const locationLimiter = () => rateLimit({
    windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas consultas de localização. Aguarde e tente novamente.' },
  });
  const batchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitos lotes de localização. Aguarde 15 minutos e tente novamente.' },
  });
  router.get('/cep/:cep', locationLimiter(), map.cep);
  router.post('/mapa/localizar', batchLimiter, map.batch);
  router.get('/links', controller.listLinks);
  router.get('/links/formulario', form.adminSchema);
  router.get('/links/:id', controller.getLink);
  router.post('/links', controller.createLink);
  router.delete('/links/:id', controller.revokeLink);
  router.get('/perfil', controller.profile);
  const profileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => req.auth!.user.id,
    message: { message: 'Muitas alterações de perfil. Aguarde 15 minutos e tente novamente.' },
  });
  router.patch('/perfil', profileLimiter, controller.updateProfile);
  router.post('/perfil/senha', profileLimiter, controller.changePassword);

  const memberRoutes = Router();
  memberRoutes.use(noStore, requireAuth(auth, config));
  const member = memberController(members, timezone, locations);
  const memberWriteLimiter = locationLimiter();
  memberRoutes.get('/', member.list);
  memberRoutes.get('/filtros', member.filters);
  memberRoutes.post('/calculos', formLimiter, form.calculate);
  memberRoutes.post('/foto', photoLimiter, photoBody, form.uploadAdmin);
  memberRoutes.get('/:id', member.get);
  memberRoutes.get('/:id/foto', form.photo);
  memberRoutes.post('/', memberWriteLimiter, member.create);
  memberRoutes.patch('/:id', memberWriteLimiter, member.update);
  memberRoutes.delete('/:id', member.archive);
  memberRoutes.post('/:id/restaurar', member.restore);
  memberRoutes.post('/:id/localizar', memberWriteLimiter, map.locate);
  router.use('/usuarios', memberRoutes);
  router.use('/membros', memberRoutes);

  const registration = registrationController(links, timezone, locations);
  const publicRoutes = Router();
  publicRoutes.use(noStore);
  publicRoutes.get('/:token/formulario', formLimiter, form.publicSchema);
  publicRoutes.post('/:token/calculos', formLimiter, form.validLink, form.calculate);
  publicRoutes.post('/:token/foto', photoLimiter, form.validLink, photoBody, form.uploadPublic);
  publicRoutes.get('/:token/cep/:cep', locationLimiter(), (req, _res, next) => {
    links.publicInfo(String(req.params.token)); next();
  }, map.cep);
  publicRoutes.get('/:token', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas consultas. Aguarde e tente novamente.' },
  }), registration.info);
  publicRoutes.post('/:token', rateLimit({
    windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitos cadastros enviados. Aguarde uma hora e tente novamente.' },
  }), registration.submit);
  router.use('/cadastro', publicRoutes);
  return router;
}
