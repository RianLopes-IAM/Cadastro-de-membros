import type { MemberAddress, MemberGeocoding, MemberInput, MemberPatch } from '../models/member.js';
import { emptyAddress } from '../models/validation.js';
import { HttpError } from '../middlewares/errors.js';
import type { MemberService } from './members.js';
import { normalizePostalCode, type PostalCodeService } from './postal-code.js';

export class MemberLocationService {
  constructor(private members: MemberService, private postal: PostalCodeService) {}

  async enrich(input: MemberInput): Promise<MemberInput> {
    const address: MemberAddress = { ...input.address };
    const metadata = (status: MemberGeocoding['status'], source: MemberGeocoding['source'] = null): MemberGeocoding => ({
      status: input.location ? 'located' : status,
      source: input.location ? 'manual' : source,
      precision: input.location ? 'manual' : null,
      checkedAt: new Date().toISOString(),
    });
    if (!address.postalCode) return { ...input, address, geocoding: metadata('missing_postal_code') };
    address.postalCode = normalizePostalCode(address.postalCode);
    try {
      const result = await this.postal.lookup(address.postalCode);
      for (const key of ['street', 'neighborhood', 'city', 'state'] as const) {
        if (!address[key]) address[key] = result.address[key];
      }
      // A supplied address that conflicts with the CEP cannot safely use the CEP marker.
      const normalize = (value: string | null) => (value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
      const conflict = (['street', 'neighborhood', 'city', 'state'] as const)
        .some(key => address[key] && result.address[key] && normalize(address[key]) !== normalize(result.address[key]));
      const location = input.location ?? (conflict ? null : result.location);
      return {
        ...input, address, location,
        geocoding: input.location ? metadata('located') : {
          status: conflict ? 'address_conflict' : location ? 'located' : 'coordinates_unavailable',
          source: result.source, precision: location ? result.precision : null, checkedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      if (!(error instanceof HttpError) || ![404, 503].includes(error.status)) throw error;
      return { ...input, address, geocoding: metadata(error.status === 404 ? 'not_found' : 'unavailable') };
    }
  }

  async create(input: MemberInput, actorUserId?: string) { return this.members.create(await this.enrich(input), null, actorUserId); }

  async update(id: string, patch: MemberPatch, actorUserId?: string) {
    const current = this.members.get(id);
    if (patch.address === undefined && patch.location === undefined) return this.members.update(id, patch, actorUserId);
    const address = patch.address === null ? { ...emptyAddress } : { ...current.address, ...patch.address };
    if (address.postalCode) address.postalCode = normalizePostalCode(address.postalCode);
    const cepChanged = (address.postalCode?.replace('-', '') ?? null) !== (current.address.postalCode?.replace('-', '') ?? null);
    if (cepChanged && patch.address) {
      // Drop old CEP-derived address fields, while keeping newly supplied values and the house number.
      for (const key of ['street', 'neighborhood', 'city', 'state'] as const) {
        if (patch.address[key] === undefined) address[key] = null;
      }
    }
    const previousAddress = { ...current.address, postalCode: current.address.postalCode?.replace('-', '') ?? null };
    const changed = JSON.stringify(address) !== JSON.stringify(previousAddress);
    if (!changed && patch.location === undefined) return this.members.update(id, { ...patch, address }, actorUserId);
    const input: MemberInput = { ...current, ...patch, address, location: patch.location ?? null };
    const enriched = patch.location === null
      ? { ...input, geocoding: { status: 'not_requested', source: null, precision: null, checkedAt: null } as MemberGeocoding }
      : await this.enrich(input);
    this.assertUnchanged(id, current.updatedAt);
    return this.members.update(id, enriched, actorUserId);
  }

  async locate(id: string) {
    const current = this.members.get(id);
    if (current.location) return current;
    const enriched = await this.enrich(current);
    this.assertUnchanged(id, current.updatedAt);
    return this.members.update(id, enriched);
  }

  private assertUnchanged(id: string, updatedAt: string): void {
    if (this.members.get(id).updatedAt !== updatedAt) throw new HttpError(409, 'O membro foi alterado durante a consulta. Atualize os dados e tente novamente.');
  }
}
