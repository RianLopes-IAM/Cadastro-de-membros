import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createApp } from '../app.js';
import { hashPassword } from '../services/password.js';
import { ageOn, elapsedCalendarTime, todayInTimezone } from '../services/dates.js';
import { MemberService } from '../services/members.js';
import { memberSchemas } from '../models/validation.js';
import { initializePanelSchema } from '../config/panel-schema.js';

const password = 'Senha-de-teste-formulario!';
const passwordHash = await hashPassword(password);
const photo = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#b3cce6' } })
  .withMetadata({ orientation: 6 }).png().toBuffer();

async function fixture(timezone = 'America/Sao_Paulo') {
  const { app, store } = await createApp({
    production: false, port: 3001, host: '127.0.0.1', frontendOrigins: ['http://localhost:5173'],
    jwtSecret: 'form-tests-only-secret-12345678901234567890', databasePath: ':memory:', trustProxy: false, churchTimezone: timezone,
  }, { postalFetch: async () => new Response(JSON.stringify({
    cep: '01001000', state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé',
    location: { coordinates: { latitude: '-23.5475', longitude: '-46.63611' } },
  }), { status: 200 }) });
  for (const [id, email] of [['first-admin', 'first@example.test'], ['second-admin', 'second@example.test']]) {
    store.createUser({ id, name: 'Administrador', email, role: 'admin', password_hash: passwordHash });
  }
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const login = async (email = 'first@example.test') => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0];
  };
  const cookie = await login();
  const request = (path: string, options: { method?: string; body?: unknown; cookie?: string | null; mime?: string; origin?: string } = {}) => {
    const method = options.method ?? 'GET';
    const authCookie = options.cookie === undefined ? cookie : options.cookie;
    return fetch(base + path, {
      method, headers: { ...(authCookie ? { Cookie: authCookie } : {}),
        ...(method === 'GET' ? {} : { 'Content-Type': options.mime ?? 'application/json' }), ...(options.origin ? { Origin: options.origin } : {}) },
      ...(method === 'GET' ? {} : { body: options.mime ? new Uint8Array(options.body as Buffer).buffer : JSON.stringify(options.body ?? {}) }),
    });
  };
  const link = async (maxUses = 10) => {
    const response = await request('/api/links', { method: 'POST', body: { label: 'Formulário completo', maxUses } });
    assert.equal(response.status, 201); const result = await response.json();
    return { ...result, token: result.url.split('/').at(-1) as string };
  };
  return { store, request, link, login, members: new MemberService(store.database, timezone),
    close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); } };
}

const fullInput = {
  name: 'Maria do cadastro', sex: 'female', birthDate: '1990-05-10', birthCountry: 'Brasil', birthCity: 'Campinas',
  phone: '(11) 99999-1234', email: 'MARIA@EXAMPLE.TEST', address: { postalCode: '01001-000', number: '100' },
  fatherName: 'João do cadastro', motherName: 'Ana do cadastro', profession: 'Professora', maritalStatus: 'married',
  weddingDate: '2010-09-15', spouseName: 'Paulo do cadastro', children: [
    { name: 'Filha Um', birthDate: '2012-06-20' }, { name: 'Filho Dois', birthDate: '2015-02-28' },
  ], baptismChurch: 'Igreja de origem', baptismDate: '2005-10-01', baptismPastor: 'Pastor de origem',
  admissionType: 'transfer_letter', joinedAt: '2020-01-10', leftAt: '2025-09-30',
};

test('idades e duração são calculadas por aniversários e meses civis, incluindo 29/02', () => {
  assert.equal(ageOn('2000-10-10', '2026-10-09'), 25); assert.equal(ageOn('2000-10-10', '2026-10-10'), 26);
  assert.equal(ageOn('2000-02-29', '2027-02-27'), 26); assert.equal(ageOn('2000-02-29', '2027-02-28'), 27);
  assert.equal(ageOn(null, '2026-10-09'), null); assert.equal(ageOn('2026-10-09', '2026-10-09'), 0);
  assert.deepEqual(elapsedCalendarTime('2020-01-31', '2026-02-28'), { years: 6, months: 1, totalMonths: 73 });
  assert.deepEqual(elapsedCalendarTime('2020-10-10', '2026-10-09'), { years: 5, months: 11, totalMonths: 71 });
  assert.deepEqual(elapsedCalendarTime('2020-10-10', '2026-10-10'), { years: 6, months: 0, totalMonths: 72 });
});

test('aba Link fornece contrato das perguntas e URL pública ligada aos endpoints do formulário', async t => {
  const api = await fixture(); t.after(api.close);
  const panel = await (await api.request('/api/painel')).json();
  const tab = panel.navigation.main.find((item: { label: string }) => item.label === 'Link');
  assert.equal(tab.path, '/links'); assert.equal(tab.endpoint, '/api/links'); assert.equal(tab.formEndpoint, '/api/links/formulario');
  assert.equal((await api.request('/api/links/formulario', { cookie: null })).status, 401);
  const link = await api.link(); assert.equal(link.url, 'http://localhost:5173/cadastro/' + link.token);
  const response = await api.request('/api/cadastro/' + link.token + '/formulario', { cookie: null });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.form.frontendPath, '/cadastro/' + link.token); assert.equal(data.form.endpoints.submit, '/api/cadastro/' + link.token);
  assert.equal(data.form.endpoints.photo, '/api/cadastro/' + link.token + '/foto');
  const fields = data.form.sections.flatMap((section: { fields: { key: string }[] }) => section.fields);
  for (const key of ['photoId', 'name', 'sex', 'birthDate', 'age', 'birthCountry', 'birthCity', 'phone', 'email', 'address.postalCode', 'address.street', 'address.neighborhood', 'address.city', 'fatherName', 'motherName', 'profession', 'maritalStatus', 'weddingDate', 'weddingDuration', 'spouseName', 'children', 'baptismChurch', 'baptismDate', 'baptismPastor', 'admissionType', 'joinedAt', 'leftAt']) {
    assert.ok(fields.some((field: { key: string }) => field.key === key), key);
  }
  assert.deepEqual(fields.find((field: { key: string }) => field.key === 'admissionType').options.map((option: { label: string }) => option.label), ['Batismo', 'Carta de transferência', 'Declaração de Fé', 'Aclamação']);
  assert.equal(fields.find((field: { key: string }) => field.key === 'age').readOnly, true);
  assert.equal('token_hash' in data, false); assert.equal('members' in data, false);
});

test('formulário completo persiste foto, família e histórico, com idades e tempo calculados', async t => {
  const api = await fixture(); t.after(api.close); const link = await api.link();
  const uploaded = await api.request('/api/cadastro/' + link.token + '/foto', { method: 'POST', cookie: null, mime: 'image/png', body: photo });
  assert.equal(uploaded.status, 201); const savedPhoto = await uploaded.json(); assert.equal(savedPhoto.contentType, 'image/webp');
  const submit = await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { ...fullInput, photoId: savedPhoto.photoId } });
  assert.equal(submit.status, 202); assert.deepEqual(Object.keys(await submit.json()), ['message']);
  const member = api.members.list({ page: 1, pageSize: 20, sort: 'name' }).data[0];
  assert.equal(member.status, 'pending'); assert.equal(member.category, 'Membro'); assert.equal(member.email, 'maria@example.test');
  for (const field of ['sex', 'birthCountry', 'birthCity', 'fatherName', 'motherName', 'profession', 'maritalStatus', 'weddingDate', 'spouseName', 'baptismChurch', 'baptismDate', 'baptismPastor', 'admissionType', 'joinedAt', 'leftAt'] as const) assert.equal(member[field], fullInput[field]);
  assert.equal(member.address.city, 'São Paulo'); assert.equal(member.address.neighborhood, 'Sé'); assert.ok(member.location);
  const today = todayInTimezone('America/Sao_Paulo');
  assert.equal(member.age, ageOn(fullInput.birthDate, today)); assert.deepEqual(member.weddingDuration, elapsedCalendarTime(fullInput.weddingDate, today));
  assert.equal(member.children.length, 2); assert.equal(member.children[0].age, ageOn(fullInput.children[0].birthDate, today));
  const persisted = String(api.store.database.prepare('SELECT details_json FROM members WHERE id = ?').get(member.id)!.details_json);
  assert.equal(persisted.includes('"age"'), false); assert.equal(persisted.includes('weddingDuration'), false);
  assert.equal(member.photoId, savedPhoto.photoId); assert.equal(member.photoUrl, '/api/usuarios/' + member.id + '/foto');
  const imageResponse = await api.request(member.photoUrl!); assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/webp'); assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
  const metadata = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  assert.equal((await api.request(member.photoUrl!, { cookie: null })).status, 401);
  assert.equal((await api.request('/api/cadastro/' + link.token + '/foto', { cookie: null })).status, 404);
  assert.equal(api.store.findUserByEmail('maria@example.test'), undefined);
});

test('prévia calcula idades sem gravar membro ou consumir link e respeita fuso configurado', async t => {
  const api = await fixture('Pacific/Kiritimati'); t.after(api.close); const link = await api.link();
  const response = await api.request('/api/cadastro/' + link.token + '/calculos', { method: 'POST', cookie: null,
    body: { birthDate: fullInput.birthDate, weddingDate: fullInput.weddingDate, children: fullInput.children } });
  assert.equal(response.status, 200); const data = await response.json();
  assert.equal(data.timezone, 'Pacific/Kiritimati'); assert.equal(data.asOf, todayInTimezone(data.timezone));
  assert.equal(data.age, ageOn(fullInput.birthDate, data.asOf)); assert.equal(data.children[1].age, ageOn(fullInput.children[1].birthDate, data.asOf));
  assert.equal(api.members.list({ page: 1, pageSize: 20, sort: 'name' }).pagination.total, 0);
  assert.equal((await (await api.request('/api/links/' + link.link.id)).json()).link.usedCount, 0);
  const empty = await (await api.request('/api/usuarios/calculos', { method: 'POST' })).json();
  assert.equal(empty.age, null); assert.equal(empty.weddingDuration, null); assert.deepEqual(empty.children, []);
});

test('campos calculados, privilégios e datas incompatíveis são rejeitados', async t => {
  const api = await fixture(); t.after(api.close); const link = await api.link();
  const schema = memberSchemas('America/Sao_Paulo').publicRegistration;
  for (const fields of [
    { age: 10 }, { weddingDuration: { years: 100 } }, { status: 'active' }, { category: 'Admin' }, { sex: 'invalid' }, { maritalStatus: 'invalid' }, { admissionType: 'invalid' },
    { birthDate: '2000-02-30' }, { weddingDate: '2999-01-01' }, { birthDate: '2000-01-01', weddingDate: '1990-01-01' },
    { birthDate: '2000-01-01', baptismDate: '1990-01-01' }, { joinedAt: '2020-01-01', leftAt: '2010-01-01' },
    { birthDate: '2000-01-01', joinedAt: '1990-01-01' }, { birthDate: '2000-01-01', children: [{ name: 'Filho', birthDate: '1999-01-01' }] },
    { children: [{ name: 'Filho', birthDate: '2010-01-01', age: 999 }] }, { children: Array.from({ length: 51 }, () => ({ name: 'Filho', birthDate: null })) },
  ]) {
    assert.equal(schema.safeParse({ name: 'Teste', ...fields }).success, false, JSON.stringify(fields));
  }
  for (const fields of [{ age: 10 }, { joinedAt: '2020-01-01', leftAt: '2010-01-01' }, { birthDate: '2000-01-01', children: [{ name: 'Filho', birthDate: '1999-01-01' }] }]) {
    assert.equal((await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Teste', ...fields } })).status, 400);
  }
  assert.equal((await (await api.request('/api/links/' + link.link.id)).json()).link.usedCount, 0);
});

test('edição parcial valida datas contra registro existente e preserva família omitida', async t => {
  const api = await fixture(); t.after(api.close);
  const created = await api.request('/api/usuarios', { method: 'POST', body: fullInput });
  assert.equal(created.status, 201); const member = (await created.json()).member;
  const invalid = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { birthDate: '2015-01-01' } });
  assert.equal(invalid.status, 400); assert.equal(api.members.get(member.id).birthDate, fullInput.birthDate);
  const changed = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { profession: 'Arquiteta', admissionType: 'acclamation' } });
  assert.equal(changed.status, 200); const updated = (await changed.json()).member;
  assert.equal(updated.profession, 'Arquiteta'); assert.deepEqual(updated.children, member.children); assert.equal(updated.fatherName, fullInput.fatherName);
  const cleared = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { children: [], weddingDate: null, spouseName: null } });
  assert.equal(cleared.status, 200); assert.equal((await cleared.json()).member.weddingDuration, null);
  for (const admissionType of ['baptism', 'transfer_letter', 'profession_of_faith', 'acclamation']) {
    assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { admissionType } })).status, 200);
  }
});

test('foto de outro link e foto já utilizada não podem ser associadas ao cadastro', async t => {
  const api = await fixture(); t.after(api.close); const first = await api.link(); const second = await api.link();
  const response = await api.request('/api/cadastro/' + first.token + '/foto', { method: 'POST', cookie: null, mime: 'image/png', body: photo });
  const { photoId } = await response.json();
  assert.equal((await api.request('/api/cadastro/' + second.token, { method: 'POST', cookie: null, body: { name: 'Tentativa outro link', photoId } })).status, 400);
  assert.equal((await (await api.request('/api/links/' + second.link.id)).json()).link.usedCount, 0);
  assert.equal((await api.request('/api/cadastro/' + first.token, { method: 'POST', cookie: null, body: { name: 'Primeira pessoa', photoId } })).status, 202);
  assert.equal((await api.request('/api/cadastro/' + first.token, { method: 'POST', cookie: null, body: { name: 'Outra pessoa', photoId } })).status, 400);
  assert.equal((await (await api.request('/api/links/' + first.link.id)).json()).link.usedCount, 1);
});

test('foto administrativa pertence ao autor até associação e pode ser removida por edição', async t => {
  const api = await fixture(); t.after(api.close);
  assert.equal((await api.request('/api/usuarios/foto', { method: 'POST', mime: 'image/png', body: photo, cookie: null })).status, 401);
  const uploaded = await api.request('/api/usuarios/foto', { method: 'POST', mime: 'image/png', body: photo });
  assert.equal(uploaded.status, 201); const { photoId } = await uploaded.json();
  const secondCookie = await api.login('second@example.test');
  assert.equal((await api.request('/api/usuarios', { method: 'POST', cookie: secondCookie, body: { name: 'Outro autor', photoId } })).status, 400);
  const created = await api.request('/api/usuarios', { method: 'POST', body: { name: 'Autor correto', photoId } });
  assert.equal(created.status, 201); const member = (await created.json()).member;
  assert.equal((await api.request('/api/membros/' + member.id + '/foto')).status, 200);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH', cookie: secondCookie, body: { profession: 'Professor' } })).status, 200);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { photoId: null } })).status, 200);
  assert.equal((await api.request('/api/usuarios/' + member.id + '/foto')).status, 404);
});

test('upload rejeita arquivo falso, truncado, formato indevido, origem externa e tamanho excessivo', async t => {
  const api = await fixture(); t.after(api.close); const link = await api.link(); const path = '/api/cadastro/' + link.token + '/foto';
  for (const [buffer, mime, status] of [[Buffer.from('<script>bad</script>'), 'image/png', 400], [photo, 'image/jpeg', 400], [photo.subarray(0, 40), 'image/png', 400], [photo, 'image/svg+xml', 415], [Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 413]] as const) {
    assert.equal((await api.request(path, { method: 'POST', cookie: null, mime, body: buffer })).status, status);
  }
  assert.equal((await api.request(path, { method: 'POST', cookie: null, mime: 'image/png', body: photo, origin: 'https://outside.example' })).status, 403);
  assert.equal((await api.request('/api/auth/login', { method: 'POST', mime: 'image/png', body: photo })).status, 415);
  assert.equal(api.store.database.prepare('SELECT COUNT(*) AS total FROM member_photos').get()!.total, 0);
});

test('links revogados ou expirados bloqueiam perguntas, cálculo e upload', async t => {
  const api = await fixture(); t.after(api.close); const link = await api.link();
  await api.request('/api/links/' + link.link.id, { method: 'DELETE' });
  for (const token of [link.token, 'invalid']) {
    assert.equal((await api.request('/api/cadastro/' + token + '/formulario', { cookie: null })).status, 404);
    assert.equal((await api.request('/api/cadastro/' + token + '/calculos', { method: 'POST', cookie: null })).status, 404);
    assert.equal((await api.request('/api/cadastro/' + token + '/foto', { method: 'POST', cookie: null, mime: 'image/png', body: photo })).status, 404);
  }
  const expired = await api.link();
  api.store.database.prepare('UPDATE registration_links SET expires_at = 0 WHERE id = ?').run(expired.link.id);
  assert.equal((await api.request('/api/cadastro/' + expired.token + '/formulario', { cookie: null })).status, 404);
});

test('foto pendente expirada é rejeitada e limpa sem apagar foto já vinculada', async t => {
  const api = await fixture(); t.after(api.close);
  const uploaded = await api.request('/api/usuarios/foto', { method: 'POST', mime: 'image/png', body: photo });
  const expired = await uploaded.json(); api.store.database.prepare('UPDATE member_photos SET expires_at = 0').run();
  assert.equal((await api.request('/api/usuarios', { method: 'POST', body: { name: 'Foto expirada', photoId: expired.photoId } })).status, 400);
  const second = await (await api.request('/api/usuarios/foto', { method: 'POST', mime: 'image/png', body: photo })).json();
  assert.equal(api.store.database.prepare('SELECT id FROM member_photos WHERE id = ?').get(expired.photoId), undefined);
  const created = await api.request('/api/usuarios', { method: 'POST', body: { name: 'Vinculado', photoId: second.photoId } });
  const member = (await created.json()).member; api.store.database.prepare('UPDATE member_photos SET expires_at = 0').run();
  assert.equal((await api.request('/api/usuarios/foto', { method: 'POST', mime: 'image/png', body: photo })).status, 201);
  assert.equal((await api.request('/api/usuarios/' + member.id + '/foto')).status, 200);
});

test('migração mantém os registros antigos e todos os campos podem ser adicionados depois', async t => {
  const api = await fixture(); t.after(api.close);
  const member = api.members.create(memberSchemas('America/Sao_Paulo').create.parse({ name: 'Cadastro antigo' }));
  api.store.database.exec('DROP INDEX members_unique_photo; ALTER TABLE members DROP COLUMN photo_id; ALTER TABLE members DROP COLUMN details_json;');
  initializePanelSchema(api.store.database); initializePanelSchema(api.store.database);
  assert.equal(api.members.get(member.id).name, 'Cadastro antigo'); assert.equal(api.members.get(member.id).sex, null);
  assert.deepEqual(api.members.get(member.id).children, []); assert.equal(api.members.get(member.id).photoId, null);
  const changed = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: fullInput });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).member.baptismChurch, fullInput.baptismChurch);
});
