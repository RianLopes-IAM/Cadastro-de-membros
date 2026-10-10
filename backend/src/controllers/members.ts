import type { RequestHandler } from 'express';
import type { MemberService } from '../services/members.js';
import { memberSchemas, listMembersSchema } from '../models/validation.js';
import { parseInput, routeParam } from '../middlewares/errors.js';
import type { MemberLocationService } from '../services/member-location.js';

export function memberController(members: MemberService, timezone: string, locations: MemberLocationService) {
  const schemas = memberSchemas(timezone);
  const list: RequestHandler = (req, res) => { res.json(members.list(parseInput(listMembersSchema, req.query))); };
  const filters: RequestHandler = (_req, res) => { res.json(members.filterOptions()); };
  const get: RequestHandler = (req, res) => { res.json({ member: members.get(routeParam(req)) }); };
  const create: RequestHandler = async (req, res) => {
    const member = await locations.create(parseInput(schemas.create, req.body), req.auth!.user.id);
    res.location('/api/usuarios/' + member.id).status(201).json({ member });
  };
  const update: RequestHandler = async (req, res) => {
    res.json({ member: await locations.update(routeParam(req), parseInput(schemas.patch, req.body), req.auth!.user.id) });
  };
  const archive: RequestHandler = (req, res) => { members.archive(routeParam(req)); res.status(204).end(); };
  const restore: RequestHandler = (req, res) => { res.json({ member: members.restore(routeParam(req)) }); };
  return { list, filters, get, create, update, archive, restore };
}
