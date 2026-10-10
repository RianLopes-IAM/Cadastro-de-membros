import type { RequestHandler } from 'express';
import type { RegistrationLinkService } from '../services/links.js';
import { memberSchemas } from '../models/validation.js';
import { parseInput, routeParam } from '../middlewares/errors.js';
import type { MemberLocationService } from '../services/member-location.js';

export function registrationController(links: RegistrationLinkService, timezone: string, locations: MemberLocationService) {
  const schema = memberSchemas(timezone).publicRegistration;
  const info: RequestHandler = (req, res) => { res.json(links.publicInfo(routeParam(req, 'token'))); };
  const submit: RequestHandler = async (req, res) => {
    const token = routeParam(req, 'token');
    links.publicInfo(token);
    const input = parseInput(schema, req.body);
    const enriched = await locations.enrich({ ...input, status: 'pending', category: 'Membro' });
    // External lookups finish before entering the atomic link-consumption transaction.
    links.submit(token, enriched);
    res.status(202).json({ message: 'Cadastro enviado. Aguarde a confirmação da igreja.' });
  };
  return { info, submit };
}
