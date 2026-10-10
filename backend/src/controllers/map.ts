import type { RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput, routeParam, HttpError } from '../middlewares/errors.js';
import { listMembersSchema } from '../models/validation.js';
import type { PostalCodeService } from '../services/postal-code.js';
import type { MemberLocationService } from '../services/member-location.js';
import type { MemberService } from '../services/members.js';

const batchSchema = z.strictObject({ ids: z.array(z.string().uuid()).min(1).max(20) })
  .refine(input => new Set(input.ids).size === input.ids.length, 'Não repita membros no lote.');

export function mapController(postal: PostalCodeService, locations: MemberLocationService, members: MemberService) {
  const cep: RequestHandler = async (req, res) => { res.json(await postal.lookup(routeParam(req, 'cep'))); };
  const missing: RequestHandler = (req, res) => { res.json(members.missingLocations(parseInput(listMembersSchema, req.query))); };
  const locate: RequestHandler = async (req, res) => { res.json({ member: await locations.locate(routeParam(req)) }); };
  const batch: RequestHandler = async (req, res) => {
    const { ids } = parseInput(batchSchema, req.body);
    const data = [];
    for (const id of ids) {
      try {
        const member = await locations.locate(id);
        data.push({ id, location: member.location, geocoding: member.geocoding });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        data.push({ id, error: { status: error.status, message: error.message } });
      }
    }
    res.json({ data, processed: data.length, located: data.filter(item => 'location' in item && item.location).length });
  };
  return { cep, missing, locate, batch };
}
