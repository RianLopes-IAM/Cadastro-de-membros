import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import type { DashboardService } from '../services/dashboard.js';
import type { MemberService } from '../services/members.js';
import type { RegistrationLinkService } from '../services/links.js';
import type { ProfileService } from '../services/profile.js';
import { cookieOptions, sessionCookie } from '../middlewares/auth.js';
import { parseInput, routeParam } from '../middlewares/errors.js';
import { changePasswordSchema, createLinkSchema, dashboardQuerySchema, listLinksSchema, mapQuerySchema, profileSchema } from '../models/validation.js';

export function panelController(services: {
  dashboard: DashboardService;
  members: MemberService;
  links: RegistrationLinkService;
  profile: ProfileService;
}, config: AppConfig) {
  const panel: RequestHandler = (req, res) => {
    res.json({
      user: req.auth!.user,
      navigation: {
        main: [
          { key: 'dashboard', label: 'Dashboard', path: '/dashboard', endpoint: '/api/dashboard' },
          { key: 'usuarios', label: 'Usuários', path: '/usuarios' },
          { key: 'mapa', label: 'Mapa', path: '/mapa' },
          { key: 'links', label: 'Link', path: '/links', endpoint: '/api/links', formEndpoint: '/api/links/formulario' },
        ],
        account: [
          { key: 'perfil', label: 'Perfil', path: '/perfil', endpoint: '/api/perfil', passwordEndpoint: '/api/perfil/senha' },
          { key: 'sair', label: 'Sair', action: 'logout', method: 'POST', endpoint: '/api/auth/logout' },
        ],
      },
    });
  };
  const dashboard: RequestHandler = (req, res) => {
    res.json(services.dashboard.summary(parseInput(dashboardQuerySchema, req.query).birthdayDays));
  };
  const map: RequestHandler = (req, res) => { res.json(services.members.map(parseInput(mapQuerySchema, req.query))); };
  const listLinks: RequestHandler = (req, res) => { res.json(services.links.list(parseInput(listLinksSchema, req.query))); };
  const getLink: RequestHandler = (req, res) => { res.json({ link: services.links.get(routeParam(req)) }); };
  const createLink: RequestHandler = (req, res) => {
    const result = services.links.create(parseInput(createLinkSchema, req.body), req.auth!.user.id);
    res.location('/api/links/' + result.link.id).status(201).json(result);
  };
  const revokeLink: RequestHandler = (req, res) => { services.links.revoke(routeParam(req)); res.status(204).end(); };
  const profile: RequestHandler = (req, res) => { res.json({ user: services.profile.get(req.auth!.user.id) }); };
  const updateProfile: RequestHandler = async (req, res) => {
    const result = await services.profile.update(req.auth!.user.id, req.auth!.id, parseInput(profileSchema, req.body));
    if (result.requiresLogin) res.clearCookie(sessionCookie, cookieOptions(config));
    res.json(result);
  };
  const changePassword: RequestHandler = async (req, res) => {
    await services.profile.changePassword(req.auth!.user.id, req.auth!.id, parseInput(changePasswordSchema, req.body));
    res.clearCookie(sessionCookie, cookieOptions(config));
    res.json({ message: 'Senha alterada. Entre novamente com sua nova senha.', requiresLogin: true });
  };
  return { panel, dashboard, map, listLinks, getLink, createLink, revokeLink, profile, updateProfile, changePassword };
}
