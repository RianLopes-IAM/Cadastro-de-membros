import type { RequestHandler } from 'express';
import type { MemberService } from '../services/members.js';
import type { RegistrationLinkService } from '../services/links.js';
import type { PhotoService } from '../services/photos.js';
import { registrationForm } from '../models/registration-form.js';
import { memberSchemas } from '../models/validation.js';
import { ageOn, elapsedCalendarTime, todayInTimezone } from '../services/dates.js';
import { HttpError, parseInput, routeParam } from '../middlewares/errors.js';

export function formController(members: MemberService, links: RegistrationLinkService, photos: PhotoService, timezone: string) {
  const schema = memberSchemas(timezone).calculations;
  const calculate: RequestHandler = (req, res) => {
    const input = parseInput(schema, req.body);
    const today = todayInTimezone(timezone);
    res.json({
      asOf: today, timezone, age: ageOn(input.birthDate, today),
      weddingDuration: input.weddingDate ? elapsedCalendarTime(input.weddingDate, today) : null,
      children: input.children.map(child => ({ ...child, age: ageOn(child.birthDate, today) })),
    });
  };
  const adminSchema: RequestHandler = (_req, res) => { res.json({ form: registrationForm(timezone) }); };
  const publicSchema: RequestHandler = (req, res) => {
    const token = routeParam(req, 'token');
    res.json({ ...links.publicInfo(token), form: registrationForm(timezone, token) });
  };
  const validLink: RequestHandler = (req, _res, next) => { links.publicInfo(routeParam(req, 'token')); next(); };
  const buffer = (body: unknown) => {
    if (!Buffer.isBuffer(body)) throw new HttpError(415, 'Envie o arquivo da foto como JPEG, PNG ou WebP, sem JSON ou multipart.');
    return body;
  };
  const uploadAdmin: RequestHandler = async (req, res) => {
    res.status(201).json(await photos.upload(buffer(req.body), req.get('content-type')!.split(';')[0].trim(), { userId: req.auth!.user.id }));
  };
  const uploadPublic: RequestHandler = async (req, res) => {
    const token = routeParam(req, 'token');
    const context = links.publicContext(token);
    res.status(201).json(await photos.upload(buffer(req.body), req.get('content-type')!.split(';')[0].trim(),
      { linkId: context.id, expiresAt: context.expiresAt }, () => { links.publicInfo(token); }));
  };
  const photo: RequestHandler = (req, res) => {
    const member = members.get(routeParam(req));
    if (!member.photoId) throw new HttpError(404, 'Este membro não possui foto.');
    res.type('image/webp').set('Content-Disposition', 'inline').send(Buffer.from(photos.get(member.photoId)));
  };
  return { calculate, adminSchema, publicSchema, validLink, uploadAdmin, uploadPublic, photo };
}
