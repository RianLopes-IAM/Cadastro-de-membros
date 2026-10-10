import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { AuthStore } from '../config/database.js';
import { initializePanelSchema } from '../config/panel-schema.js';
import { PostalCodeService, type PostalFetch } from '../services/postal-code.js';
import { MemberLocationService } from '../services/member-location.js';
import { MemberService } from '../services/members.js';
import { memberSchemas } from '../models/validation.js';
import { HttpError } from '../middlewares/errors.js';
import { createApp } from '../app.js';
import { hashPassword } from '../services/password.js';

const cepPayload = (cep = '01001000', coordinates: Record<string, unknown> = { latitude: '-23.5475', longitude: '-46.63611' }) => ({
  cep, state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé', location: { type: 'Point', coordinates },
});
const input = (fields: Record<string, unknown> = {}) => memberSchemas('America/Sao_Paulo').create.parse({ name: 'Membro teste', ...fields });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixture(request: PostalFetch = async () => json(cepPayload())) {
  const store = new AuthStore(':memory:');
  const postal = new PostalCodeService(store.database, request);
  const members = new MemberService(store.database);
  return { store, postal, members, locations: new MemberLocationService(members, postal) };
}

test('CEP é normalizado, consulta é deduplicada e cache persistido é reutilizado', async t => {
  const calls: string[] = [];
  const api = fixture(async (url, options) => {
    calls.push(url); assert.ok(options.signal); assert.equal(options.redirect, 'error');
    return json(cepPayload());
  }); t.after(() => api.store.close());
  const results = await Promise.all([api.postal.lookup('01001-000'), api.postal.lookup('01001000')]);
  assert.equal(calls.length, 1); assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].postalCode, '01001000'); assert.equal(results[0].precision, 'approximate');
  assert.deepEqual(results[0].location, { latitude: -23.5475, longitude: -46.63611 });
  const restarted = new PostalCodeService(api.store.database, async () => { throw new Error('Não consultar rede'); });
  assert.deepEqual(await restarted.lookup('01001000'), results[0]);
  assert.throws(() => api.postal.lookup('../secrets'), (error: unknown) => error instanceof HttpError && error.status === 400);
  api.store.database.prepare('UPDATE postal_code_cache SET expires_at = 0').run();
  await api.postal.lookup('01001000'); assert.equal(calls.length, 2);
});

test('ViaCEP preenche endereço quando BrasilAPI falha e não fabrica coordenadas', async t => {
  const calls: string[] = [];
  const api = fixture(async url => {
    calls.push(url);
    if (url.includes('brasilapi')) throw new Error('Timeout');
    return json({ cep: '01001-000', uf: 'SP', localidade: 'São Paulo', bairro: 'Sé', logradouro: 'Praça da Sé' });
  }); t.after(() => api.store.close());
  const member = await api.locations.create(input({ address: { postalCode: '01001-000', number: '10' } }));
  assert.equal(calls.length, 2); assert.equal(member.address.city, 'São Paulo'); assert.equal(member.address.number, '10');
  assert.equal(member.location, null); assert.equal(member.geocoding.status, 'coordinates_unavailable');
  assert.equal(member.geocoding.source, 'viacep');
});

test('coordenadas nulas, vazias, inválidas ou incompletas não se transformam em ponto zero', async t => {
  for (const coordinates of [{ latitude: null, longitude: null }, { latitude: '', longitude: '0' }, { latitude: '91', longitude: '0' }, { latitude: '0' }, { latitude: 'NaN', longitude: '0' }]) {
    const api = fixture(async () => json(cepPayload('01001000', coordinates)));
    try { assert.equal((await api.postal.lookup('01001000')).location, null); }
    finally { api.store.close(); }
  }
  const api = fixture(async () => json(cepPayload('01001000', { latitude: '0', longitude: '0' })));
  t.after(() => api.store.close());
  assert.deepEqual((await api.postal.lookup('01001000')).location, { latitude: 0, longitude: 0 });
});

test('timeout cancela cada consulta e resposta de outro CEP não é aceita', async t => {
  const api = fixture(); t.after(() => api.store.close());
  const postal = new PostalCodeService(api.store.database, async (_url, options) => {
    return new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('Timeout')), { once: true });
    });
  }, 30);
  await assert.rejects(postal.lookup('01001000'), (error: unknown) => error instanceof HttpError && error.status === 503);
  const mismatch = new PostalCodeService(api.store.database, async url => url.includes('brasilapi')
    ? json(cepPayload('20040002')) : json({ cep: '01001-000', uf: 'SP', localidade: 'São Paulo', bairro: 'Sé', logradouro: 'Praça da Sé' }));
  await assert.rejects(mismatch.lookup('01001001'), (error: unknown) => error instanceof HttpError && error.status === 503);
});

test('CEP inexistente e indisponibilidade são distintos e não impedem salvar membro', async t => {
  for (const missing of [true, false]) {
    const api = fixture(async url => url.includes('brasilapi') ? json({}, 503) : missing ? json({ erro: true }) : json({}, 503));
    try {
      await assert.rejects(api.postal.lookup('99999999'), (error: unknown) => error instanceof HttpError && error.status === (missing ? 404 : 503));
      const member = await api.locations.create(input({ address: { postalCode: '99999999' } }));
      assert.equal(member.location, null); assert.equal(member.geocoding.status, missing ? 'not_found' : 'unavailable');
      assert.equal(api.members.map({ limit: 100 }).meta.withoutLocation, 1);
    } finally { api.store.close(); }
  }
  const api = fixture(); t.after(() => api.store.close());
  const member = await api.locations.create(input());
  assert.equal(member.geocoding.status, 'missing_postal_code');
});

test('membros no mesmo CEP têm pontos próprios e todos os status aparecem no mapa', async t => {
  const api = fixture(); t.after(() => api.store.close());
  const ids = [];
  for (const status of ['active', 'inactive', 'pending']) {
    const member = await api.locations.create(input({ name: 'Membro ' + status, status, address: { postalCode: '01001-000', number: '20', complement: 'Apto 1' } }));
    assert.equal(member.geocoding.precision, 'approximate'); assert.equal(member.address.complement, 'Apto 1'); ids.push(member.id);
  }
  const first = api.members.map({ limit: 2 }); const second = api.members.map({ limit: 2, page: 2 });
  assert.equal(first.meta.total, 3); assert.equal(first.meta.nextPage, 2); assert.equal(second.meta.nextPage, null);
  const features = [...first.features, ...second.features];
  assert.deepEqual(features.map(point => point.id).sort(), ids.sort());
  assert.ok(features.every(point => point.geometry.coordinates[0] === -46.63611));
  assert.equal(api.members.map({ limit: 10, status: 'active' }).features.length, 1);
});

test('coordenadas manuais são preservadas e conflito de endereço impede ponto automático', async t => {
  const api = fixture(); t.after(() => api.store.close());
  const member = await api.locations.create(input({ address: { postalCode: '01001000' }, location: { latitude: 0, longitude: 0 } }));
  assert.deepEqual(member.location, { latitude: 0, longitude: 0 }); assert.equal(member.geocoding.source, 'manual');
  const formatted = await api.locations.update(member.id, { address: { postalCode: '01001-000' } });
  assert.deepEqual(formatted.location, member.location); assert.equal(formatted.geocoding.source, 'manual');
  assert.deepEqual((await api.locations.locate(member.id)).location, member.location);
  const conflict = await api.locations.create(input({ address: { postalCode: '01001000', city: 'Campinas' } }));
  assert.equal(conflict.address.city, 'Campinas'); assert.equal(conflict.location, null);
  assert.equal(conflict.geocoding.status, 'address_conflict');
});

test('alterar CEP refaz localização e não mantém ponto ou rua do endereço anterior', async t => {
  const api = fixture(async url => json(url.includes('20040002') ? { ...cepPayload('20040002'), state: 'RJ', city: 'Rio de Janeiro', street: 'Rua Nova', neighborhood: 'Centro', location: { coordinates: { latitude: '-22.9', longitude: '-43.2' } } } : cepPayload()));
  t.after(() => api.store.close());
  const member = await api.locations.create(input({ address: { postalCode: '01001000', number: '5' } }));
  const updated = await api.locations.update(member.id, { address: { postalCode: '20040-002' } });
  assert.equal(updated.address.street, 'Rua Nova'); assert.equal(updated.address.city, 'Rio de Janeiro'); assert.equal(updated.address.number, '5');
  assert.deepEqual(updated.location, { latitude: -22.9, longitude: -43.2 });
  const cleared = await api.locations.update(member.id, { address: null });
  assert.equal(cleared.location, null); assert.equal(cleared.geocoding.status, 'missing_postal_code');
});

test('edição explícita pode limpar coordenadas e mudanças de perfil do membro preservam localização', async t => {
  const api = fixture(); t.after(() => api.store.close());
  const member = await api.locations.create(input({ address: { postalCode: '01001000' } }));
  const renamed = await api.locations.update(member.id, { name: 'Novo nome' });
  assert.deepEqual(renamed.location, member.location);
  const cleared = await api.locations.update(member.id, { location: null });
  assert.equal(cleared.location, null); assert.equal(cleared.geocoding.status, 'not_requested');
  assert.deepEqual((await api.locations.locate(member.id)).location, member.location);
});

test('consulta lenta não sobrescreve edição concorrente', async t => {
  let started!: () => void; let finish!: (response: Response) => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const api = fixture(async () => { started(); return new Promise<Response>(resolve => { finish = resolve; }); });
  t.after(() => api.store.close());
  const member = api.members.create(input({ address: { postalCode: '01001000' } }));
  const lookup = api.locations.locate(member.id);
  await startedPromise;
  api.members.update(member.id, { name: 'Nome alterado' });
  finish(json(cepPayload()));
  await assert.rejects(lookup, (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal(api.members.get(member.id).name, 'Nome alterado'); assert.equal(api.members.get(member.id).location, null);
});

test('migração acrescenta metadados sem apagar membros e pode rodar novamente', t => {
  const api = fixture(); t.after(() => api.store.close());
  const member = api.members.create(input({ location: { latitude: 0, longitude: 0 } }));
  api.store.database.exec('ALTER TABLE members DROP COLUMN geocoding_json');
  initializePanelSchema(api.store.database); initializePanelSchema(api.store.database);
  assert.equal(api.members.get(member.id).name, member.name);
  assert.equal(api.members.get(member.id).geocoding.source, 'manual');
});

const password = 'Teste-mapa-senha-forte!';
const passwordHash = await hashPassword(password);

test('rotas HTTP protegem CEP e mapa, permitem lookup público apenas com link e localizam registros antigos', async t => {
  const calls: string[] = [];
  let hold = false; let started!: () => void; let finish!: (response: Response) => void;
  const startedPromise = new Promise<void>(resolve => { started = resolve; });
  const { app, store } = await createApp({
    production: false, port: 3001, host: '127.0.0.1', frontendOrigins: ['http://localhost:5173'],
    jwtSecret: 'test-map-only-secret-12345678901234567890', databasePath: ':memory:', trustProxy: false,
  }, { postalFetch: async url => {
    calls.push(url);
    if (hold) { started(); return new Promise<Response>(resolve => { finish = resolve; }); }
    return json(cepPayload());
  } });
  store.createUser({ id: 'map-admin', name: 'Admin', email: 'map@example.test', role: 'admin', password_hash: passwordHash });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'map@example.test', password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const request = (path: string, body?: unknown, authenticated = true) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const path of ['/api/cep/01001000', '/api/mapa', '/api/mapa/pendentes']) assert.equal((await request(path, undefined, false)).status, 401);
  assert.equal((await request('/api/mapa/localizar', { ids: [] }, false)).status, 401);
  assert.equal((await request('/api/cep/123')).status, 400); assert.equal(calls.length, 0);
  assert.equal((await request('/api/cadastro/invalid/cep/01001000', undefined, false)).status, 404); assert.equal(calls.length, 0);
  assert.equal((await request('/api/cep/01001-000')).status, 200);
  const members = new MemberService(store.database);
  const old = members.create(input({ address: { postalCode: '01001000' } }));
  const missing = members.create(input({ name: 'Sem CEP' }));
  assert.equal((await (await request('/api/mapa/pendentes')).json()).pagination.total, 2);
  const result = await request('/api/mapa/localizar', { ids: [old.id, missing.id] });
  assert.equal(result.status, 200); assert.equal((await result.json()).located, 1);
  assert.equal((await request('/api/usuarios/' + old.id + '/localizar', {})).status, 200);
  assert.equal((await request('/api/mapa/localizar', { ids: [old.id, old.id] })).status, 400);
  assert.equal((await request('/api/mapa/localizar', { ids: Array.from({ length: 21 }, () => old.id) })).status, 400);
  const map = await (await request('/api/mapa')).json();
  assert.equal(map.features[0].properties.geocoding.precision, 'approximate'); assert.equal(map.meta.withoutLocation, 1);
  const linkResponse = await request('/api/links', { label: 'Cadastro mapa', maxUses: 2 });
  const token = (await linkResponse.json()).url.split('/').at(-1);
  assert.equal((await request('/api/cadastro/' + token + '/cep/01001000', undefined, false)).status, 200);
  const submit = await request('/api/cadastro/' + token, { name: 'Pessoa pelo link', address: { postalCode: '01001000', number: '100' } }, false);
  assert.equal(submit.status, 202); assert.deepEqual(Object.keys(await submit.json()), ['message']);
  const registered = members.list({ page: 1, pageSize: 10, sort: 'name', status: 'pending' }).data[0];
  assert.equal(registered.address.number, '100'); assert.equal(registered.geocoding.status, 'located');
  const created = await request('/api/usuarios', { name: 'Cadastro administrador', address: { postalCode: '01001-000', number: '12' } });
  assert.equal(created.status, 201); assert.equal((await created.json()).member.geocoding.status, 'located');
  assert.equal(calls.length, 1); assert.equal(calls[0], 'https://brasilapi.com.br/api/cep/v2/01001000');
  hold = true;
  const inProgress = request('/api/cadastro/' + token, { name: 'Durante revogação', address: { postalCode: '20040002' } }, false);
  await startedPromise;
  store.database.prepare('UPDATE registration_links SET revoked_at = ?').run(Date.now());
  finish(json(cepPayload('20040002')));
  assert.equal((await inProgress).status, 404);
  assert.equal(members.list({ page: 1, pageSize: 10, sort: 'name', status: 'pending' }).pagination.total, 1);
  assert.equal(store.database.prepare('SELECT used_count FROM registration_links').get()!.used_count, 1);
});
