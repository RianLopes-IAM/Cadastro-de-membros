import { z } from 'zod';
import { isCalendarDate, todayInTimezone } from '../services/dates.js';
import { timelineErrors } from './member-details.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable();
const name = z.string().trim().min(2, 'Informe um nome com pelo menos 2 caracteres.').max(120);
const email = z.string().trim().max(254).email('Informe um e-mail válido.').transform(value => value.toLowerCase()).nullable();
const phone = z.string().trim().max(40).refine(value => /^[+\d\s().-]+$/.test(value) && /^\d{10,15}$/.test(value.replace(/\D/g, '')), 'Informe um telefone com 10 a 15 dígitos.').nullable();
export const memberStatusSchema = z.enum(['active', 'inactive', 'pending']);
const category = z.string().trim().min(1).max(60);
const addressFields = {
  street: nullableText(160), number: nullableText(20), complement: nullableText(100),
  neighborhood: nullableText(100), city: nullableText(100),
  state: z.string().trim().regex(/^[a-zA-Z]{2}$/, 'Informe a UF com duas letras.').transform(value => value.toUpperCase()).nullable(),
  postalCode: z.string().trim().regex(/^\d{5}-?\d{3}$/, 'Informe um CEP válido.').nullable(),
};
export const emptyAddress = { street: null, number: null, complement: null, neighborhood: null, city: null, state: null, postalCode: null };
const address = z.strictObject({
  street: addressFields.street.default(null), number: addressFields.number.default(null), complement: addressFields.complement.default(null),
  neighborhood: addressFields.neighborhood.default(null), city: addressFields.city.default(null),
  state: addressFields.state.default(null), postalCode: addressFields.postalCode.default(null),
});
const location = z.strictObject({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable();

export function memberSchemas(timezone: string) {
  const date = z.string().refine(value => isCalendarDate(value) && value <= todayInTimezone(timezone), 'Informe uma data válida, sem estar no futuro (AAAA-MM-DD).');
  const details = {
    photoId: z.string().uuid().nullable(), sex: z.enum(['male', 'female', 'not_informed']).nullable(),
    birthCountry: nullableText(100), birthCity: nullableText(100), fatherName: nullableText(120), motherName: nullableText(120),
    profession: nullableText(120), maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed', 'separated', 'stable_union']).nullable(),
    weddingDate: date.nullable(), spouseName: nullableText(120),
    children: z.array(z.strictObject({ name, birthDate: date.nullable().default(null) })).max(50),
    baptismChurch: nullableText(160), baptismDate: date.nullable(), baptismPastor: nullableText(120),
    admissionType: z.enum(['baptism', 'transfer_letter', 'profession_of_faith', 'acclamation']).nullable(), leftAt: date.nullable(),
  };
  const defaults = {
    photoId: details.photoId.default(null), sex: details.sex.default(null),
    birthCountry: details.birthCountry.default(null), birthCity: details.birthCity.default(null),
    fatherName: details.fatherName.default(null), motherName: details.motherName.default(null), profession: details.profession.default(null),
    maritalStatus: details.maritalStatus.default(null), weddingDate: details.weddingDate.default(null), spouseName: details.spouseName.default(null),
    children: details.children.default([]), baptismChurch: details.baptismChurch.default(null), baptismDate: details.baptismDate.default(null),
    baptismPastor: details.baptismPastor.default(null), admissionType: details.admissionType.default(null), leftAt: details.leftAt.default(null),
  };
  const publicFields = { ...defaults, name, email: email.default(null), phone: phone.default(null), birthDate: date.nullable().default(null), address: address.default(emptyAddress), location: location.default(null), joinedAt: date.default(() => todayInTimezone(timezone)) };
  const timeline = (value: z.infer<z.ZodObject<typeof publicFields>>, ctx: z.RefinementCtx) => {
    for (const [path, messages] of Object.entries(timelineErrors(value))) ctx.addIssue({ code: 'custom', path: path.split('.'), message: messages[0] });
  };
  return {
    create: z.strictObject({ ...publicFields, category: category.default('Membro'), status: memberStatusSchema.default('active') }).superRefine(timeline),
    publicRegistration: z.strictObject(publicFields).superRefine(timeline),
    calculations: z.strictObject({ birthDate: date.nullable().default(null), weddingDate: date.nullable().default(null), children: details.children.default([]) })
      .superRefine((value, ctx) => { for (const [path, messages] of Object.entries(timelineErrors(value))) ctx.addIssue({ code: 'custom', path: path.split('.'), message: messages[0] }); }),
    patch: z.strictObject({
      ...z.strictObject(details).partial().shape,
      name: name.optional(), email: email.optional(), phone: phone.optional(), birthDate: date.nullable().optional(),
      joinedAt: date.optional(), category: category.optional(), status: memberStatusSchema.optional(),
      address: z.strictObject(addressFields).partial().nullable().optional(), location: location.optional(),
    }).refine(value => Object.keys(value).length > 0, 'Informe pelo menos um campo para atualizar.'),
  };
}

const filters = {
  q: z.string().trim().max(120).optional(), status: memberStatusSchema.optional(),
  category: z.string().trim().min(1).max(60).optional(), city: z.string().trim().min(1).max(100).optional(),
  state: addressFields.state.unwrap().optional(),
  neighborhood: z.string().trim().min(1).max(100).optional(),
  hasLocation: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
};
const pagination = { page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const listMembersSchema = z.strictObject({ ...filters, ...pagination, sort: z.enum(['name', 'name_desc', 'newest', 'oldest']).default('name') });
export const listLinksSchema = z.strictObject(pagination);
export const mapQuerySchema = z.strictObject({
  ...filters,
  page: pagination.page,
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  bounds: z.string().refine(value => value.split(',').length === 4 && value.split(',').every(part => part.trim() !== ''),
    'Informe quatro coordenadas para os limites do mapa.').transform(value => value.split(',').map(Number)).refine(values =>
    values.length === 4 && values.every(Number.isFinite) && values[0] >= -180 && values[2] <= 180 &&
    values[1] >= -90 && values[3] <= 90 && values[0] <= values[2] && values[1] <= values[3],
  'Use bounds=longitudeMin,latitudeMin,longitudeMax,latitudeMax.').optional(),
});
export const createLinkSchema = z.strictObject({
  label: z.string().trim().min(2).max(120),
  expiresInDays: z.number().int().min(1).max(90).default(7),
  maxUses: z.number().int().min(1).max(1000).default(1),
});
const newPassword = z.string().min(12, 'A nova senha precisa ter pelo menos 12 caracteres.').max(128);
export const profileSchema = z.strictObject({
  name: name.optional(), email: email.unwrap().optional(), currentPassword: z.string().min(1).max(128).optional(),
  newPassword: newPassword.optional(),
}).refine(value => value.name !== undefined || value.email !== undefined || value.newPassword !== undefined, 'Informe nome, e-mail ou nova senha para atualizar.')
  .superRefine((value, ctx) => {
    if (value.newPassword === undefined) return;
    if (!value.currentPassword) ctx.addIssue({ code: 'custom', path: ['currentPassword'], message: 'Informe sua senha atual para alterar a senha.' });
    if (value.newPassword === value.currentPassword) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'A nova senha deve ser diferente da senha atual.' });
  });
export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword,
}).refine(value => value.newPassword !== value.currentPassword, 'A nova senha deve ser diferente da senha atual.');
export const dashboardQuerySchema = z.strictObject({ birthdayDays: z.coerce.number().int().min(0).max(90).default(30) });
