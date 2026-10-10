import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import { hashPassword } from '../services/password.js';
import { DashboardService } from '../services/dashboard.js';
import { emptyAddress, memberSchemas } from '../models/validation.js';
import { MemberService } from '../services/members.js';
import { ProfileService } from '../services/profile.js';
import { nextBirthday, todayInTimezone } from '../services/dates.js';

const password = 'Uma-senha-forte-2026!';
const passwordHash = await hashPassword(password);
const config: AppConfig = {
  production: false, port: 3001, host: '127.0.0.1', frontendOrigins: ['http://localhost:5173'],
  jwtSecret: 'panel-tests-secret-only-12345678901234567890', databasePath: ':memory:', trustProxy: false,
  churchTimezone: 'America/Sao_Paulo',
};

async function fixture(overrides: Partial<AppConfig> = {}, seed = true) {
  const { app, store } = await createApp({ ...config, ...overrides });
  if (seed) {
    for (const [id, email] of [['admin-id', 'admin@example.test'], ['second-admin', 'second@example.test']]) {
      store.createUser({ id, email, name: 'Administrador', role: 'admin', password_hash: passwordHash });
    }
  }
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = async (email = 'admin@example.test', loginPassword = password) => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: loginPassword }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  const adminCookie = await login();
  return {
    store, login, cookie: adminCookie,
    request: (path: string, options: { method?: string; body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}) => {
      const method = options.method ?? 'GET';
      const cookie = options.cookie === undefined ? adminCookie : options.cookie;
      return fetch(base + path, {
        method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(['GET', 'HEAD'].includes(method) ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: JSON.stringify(options.body ?? {}) }),
      });
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      store.close();
    },
  };
}

async function createMember(api: Awaited<ReturnType<typeof fixture>>, body: Record<string, unknown>) {
  const response = await api.request('/api/usuarios', { method: 'POST', body });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return (await response.json()).member;
}

async function createLink(api: Awaited<ReturnType<typeof fixture>>, maxUses = 1) {
  const response = await api.request('/api/links', { method: 'POST', body: { label: 'Novos membros', maxUses } });
  assert.equal(response.status, 201);
  const data = await response.json();
  return { ...data, token: data.url.split('/').at(-1) as string };
}

test('dashboard fornece cartões reais com 50 membros, 19 missionários e 30 batizados', async t => {
  const api = await fixture(); t.after(api.close);
  const members = new MemberService(api.store.database);
  const schema = memberSchemas('America/Sao_Paulo').create;
  const categories = ['Missionário', 'MISSIONARIA', 'Missionários', 'missionárias', ' missionario '];
  for (let i = 0; i < 50; i++) {
    members.create(schema.parse({
      name: `Membro ${i + 1}`, category: i < 19 ? categories[i % categories.length] : 'Membro',
      status: i === 0 ? 'inactive' : i === 1 ? 'pending' : 'active',
      baptismDate: i < 15 || i === 15 ? '2000-01-01' : null,
      admissionType: i >= 15 && i < 30 ? 'baptism' : null,
    }));
  }
  const response = await api.request('/api/dashboard');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.counts.total, 50);
  assert.equal(data.counts.missionaries, 19);
  assert.equal(data.counts.baptized, 30);
  assert.deepEqual(data.cards, [
    { key: 'members', label: 'Membros cadastrados', value: 50 },
    { key: 'missionaries', label: 'Missionários', value: 19 },
    { key: 'baptized', label: 'Batizados', value: 30 },
  ]);
  const panel = await (await api.request('/api/painel')).json();
  assert.equal(panel.navigation.main[0].endpoint, '/api/dashboard');
});

test('dashboard retorna zero vazio e não confunde profissão ou campos incompletos com categoria e batismo', async t => {
  const api = await fixture(); t.after(api.close);
  const empty = await (await api.request('/api/dashboard')).json();
  assert.deepEqual(empty.cards.map((card: { value: number }) => card.value), [0, 0, 0]);
  const legacy = await createMember(api, { name: 'Cadastro antigo' });
  api.store.database.prepare('UPDATE members SET details_json = NULL WHERE id = ?').run(legacy.id);
  await createMember(api, { name: 'Missionário João', profession: 'Missionário', category: 'Apoio missionário', baptismChurch: 'Igreja Central', baptismPastor: 'Pastor José' });
  await createMember(api, { name: 'Maria', category: 'Membro', admissionType: 'transfer_letter' });
  const data = await (await api.request('/api/dashboard')).json();
  assert.equal(data.counts.total, 3);
  assert.equal(data.counts.missionaries, 0);
  assert.equal(data.counts.baptized, 0);
});

test('dashboard conta batismos até a data da igreja e não duplica data com admissão', async t => {
  const api = await fixture(); t.after(api.close);
  await createMember(api, { name: 'Batizado hoje', baptismDate: '2020-01-01', admissionType: 'transfer_letter' });
  await createMember(api, { name: 'Batizado amanhã', baptismDate: '2020-01-02' });
  await createMember(api, { name: 'Admitido por batismo', baptismDate: '2020-01-02', admissionType: 'baptism' });
  const dashboard = new DashboardService(api.store.database, 'America/Sao_Paulo');
  const beforeMidnight = dashboard.summary(30, new Date('2020-01-02T02:59:59Z'));
  assert.equal(beforeMidnight.asOf, '2020-01-01');
  assert.equal(beforeMidnight.counts.baptized, 2);
  const afterMidnight = dashboard.summary(30, new Date('2020-01-02T03:00:00Z'));
  assert.equal(afterMidnight.asOf, '2020-01-02');
  assert.equal(afterMidnight.counts.baptized, 3);
});

test('edição, arquivamento e restauração atualizam os três indicadores do dashboard', async t => {
  const api = await fixture(); t.after(api.close);
  const member = await createMember(api, { name: 'Ana missionária', category: 'Missionária', baptismDate: '2000-01-01' });
  const readCards = async () => (await (await api.request('/api/dashboard')).json()).cards.map((card: { value: number }) => card.value);
  assert.deepEqual(await readCards(), [1, 1, 1]);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { category: 'Membro', baptismDate: null } })).status, 200);
  assert.deepEqual(await readCards(), [1, 0, 0]);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { category: 'Missionário', admissionType: 'baptism' } })).status, 200);
  assert.deepEqual(await readCards(), [1, 1, 1]);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await readCards(), [0, 0, 0]);
  assert.equal((await api.request('/api/usuarios/' + member.id + '/restaurar', { method: 'POST' })).status, 200);
  assert.deepEqual(await readCards(), [1, 1, 1]);
});

test('todas as áreas e escritas administrativas exigem sessão', async t => {
  const api = await fixture(); t.after(api.close);
  for (const path of ['/api/painel', '/api/dashboard', '/api/usuarios', '/api/membros', '/api/mapa', '/api/links', '/api/perfil']) {
    assert.equal((await api.request(path, { cookie: null })).status, 401);
  }
  for (const [method, path] of [['POST', '/api/usuarios'], ['PATCH', '/api/usuarios/id'], ['DELETE', '/api/usuarios/id'], ['POST', '/api/links'], ['PATCH', '/api/perfil'], ['POST', '/api/perfil/senha']]) {
    assert.equal((await api.request(path, { method, cookie: null })).status, 401);
  }
});

test('painel fornece os seis itens e somente dados públicos do administrador', async t => {
  const api = await fixture(); t.after(api.close);
  const response = await api.request('/api/painel');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.navigation.main.map((item: { key: string }) => item.key), ['dashboard', 'usuarios', 'mapa', 'links']);
  assert.deepEqual(data.navigation.account.map((item: { key: string }) => item.key), ['perfil', 'sair']);
  assert.equal(data.user.id, 'admin-id'); assert.equal('password_hash' in data.user, false);
  assert.equal(data.navigation.account[1].endpoint, '/api/auth/logout');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('membros são persistidos, normalizados e encontrados por filtros e busca sem acentos', async t => {
  const api = await fixture(); t.after(api.close);
  const member = await createMember(api, { name: 'José da Silva', email: '  JOSE@EXAMPLE.TEST ', phone: '(11) 99999-1234', birthDate: '1990-10-09', category: 'Liderança', address: { street: 'Rua Um', city: 'São Paulo', state: 'sp' }, location: { latitude: -23.5, longitude: -46.6 } });
  assert.equal(member.email, 'jose@example.test'); assert.equal(member.address.state, 'SP');
  assert.equal(member.address.number, null); assert.equal(member.status, 'active');
  for (const path of ['/api/usuarios?q=jose', '/api/membros?q=sao%20paulo', '/api/usuarios?status=active&category=Lideran%C3%A7a']) {
    const data = await (await api.request(path)).json();
    assert.equal(data.pagination.total, 1); assert.equal(data.data[0].id, member.id);
  }
  assert.equal((await (await api.request('/api/usuarios/' + member.id)).json()).member.name, member.name);
  const admins = await (await api.request('/api/usuarios?q=admin')).json();
  assert.equal(admins.pagination.total, 0);
});

test('paginação limita resultados, ordena nomes e pesquisa trata curingas como texto', async t => {
  const api = await fixture(); t.after(api.close);
  await createMember(api, { name: 'Bruno' }); await createMember(api, { name: 'Ana' });
  const first = await (await api.request('/api/usuarios?page=1&pageSize=1')).json();
  const second = await (await api.request('/api/usuarios?page=2&pageSize=1')).json();
  assert.equal(first.data[0].name, 'Ana'); assert.equal(second.data[0].name, 'Bruno');
  assert.equal(first.pagination.totalPages, 2);
  assert.equal((await (await api.request('/api/usuarios?q=%25')).json()).pagination.total, 0);
  assert.equal((await api.request('/api/usuarios?pageSize=10000')).status, 400);
  assert.equal((await api.request('/api/usuarios?status=superadmin')).status, 400);
  assert.equal((await api.request('/api/usuarios?sort=DROP%20TABLE')).status, 400);
});

test('pesquisa combina palavras em qualquer ordem, ignora espaços e normaliza telefone', async t => {
  const api = await fixture(); t.after(api.close);
  const jose = await createMember(api, { name: 'José da Silva', email: 'jose@example.test', phone: '+55 (11) 99999-1234', address: { city: 'São Paulo', neighborhood: 'Sé' } });
  await createMember(api, { name: 'José de Souza', phone: '(11) 98888-0000' });
  for (const q of ['silva JOSE', '  jose   silva  ', 'silva sao paulo', 'JOSE@EXAMPLE.TEST', '(11) 99999 1234', '+55 11 99999-1234', '999991234', 'sé silva']) {
    const result = await (await api.request('/api/usuarios?' + new URLSearchParams({ q }))).json();
    assert.equal(result.pagination.total, 1, q); assert.equal(result.data[0].id, jose.id, q);
  }
  assert.equal((await (await api.request('/api/usuarios?q=jose')).json()).pagination.total, 2);
  assert.equal((await (await api.request('/api/usuarios?q=silva%20souza')).json()).pagination.total, 0);
  assert.equal((await (await api.request('/api/usuarios?q=%20%20%20')).json()).pagination.total, 2);
  assert.equal((await (await api.request('/api/usuarios?' + new URLSearchParams({ q: "' OR 1=1 --" }))).json()).pagination.total, 0);
});

test('filtros de status, categoria, cidade, UF, bairro e localização podem ser combinados', async t => {
  const api = await fixture(); t.after(api.close);
  const selected = await createMember(api, { name: 'Ana selecionada', status: 'active', category: 'Liderança', address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro' }, location: { latitude: 0, longitude: 0 } });
  await createMember(api, { name: 'Ana sem ponto', status: 'active', category: 'Liderança', address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro' } });
  await createMember(api, { name: 'Ana pendente', status: 'pending', category: 'Liderança', address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro' }, location: { latitude: 1, longitude: 1 } });
  await createMember(api, { name: 'Ana outro estado', status: 'active', category: 'Membro', address: { city: 'Curitiba', state: 'PR', neighborhood: 'Centro' }, location: { latitude: 2, longitude: 2 } });
  const params = new URLSearchParams({ q: 'selecionada ana', status: 'active', category: 'Liderança', city: 'Campinas', state: 'sp', neighborhood: 'Centro', hasLocation: 'true' });
  const result = await (await api.request('/api/usuarios?' + params)).json();
  assert.equal(result.pagination.total, 1); assert.equal(result.data[0].id, selected.id);
  const without = await (await api.request('/api/usuarios?hasLocation=false')).json();
  assert.equal(without.pagination.total, 1); assert.equal(without.data[0].name, 'Ana sem ponto');
  assert.equal((await (await api.request('/api/membros?state=PR')).json()).pagination.total, 1);
  assert.equal((await (await api.request('/api/mapa?state=sp&neighborhood=Centro&hasLocation=true')).json()).features.length, 2);
  assert.equal((await (await api.request('/api/mapa/pendentes?state=SP&hasLocation=false')).json()).pagination.total, 1);
});

test('opções de filtros são protegidas, refletem cadastros e removem arquivados', async t => {
  const api = await fixture(); t.after(api.close);
  assert.equal((await api.request('/api/usuarios/filtros', { cookie: null })).status, 401);
  const empty = await (await api.request('/api/usuarios/filtros')).json();
  assert.deepEqual(empty.categories.data, []); assert.equal(empty.status.length, 3);
  assert.ok(empty.status.every((item: { count: number }) => item.count === 0));
  const archived = await createMember(api, { name: 'Arquivado', category: 'Antiga', address: { city: 'Curitiba', state: 'PR', neighborhood: 'Bairro antigo' } });
  await createMember(api, { name: 'Ativo', category: 'Membro', address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro' } });
  await createMember(api, { name: 'Pendente', status: 'pending', category: 'Membro', address: { city: 'Campinas', state: 'SP', neighborhood: 'Centro' } });
  await api.request('/api/usuarios/' + archived.id, { method: 'DELETE' });
  const response = await api.request('/api/usuarios/filtros');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const options = await response.json();
  assert.deepEqual(options.categories, { data: [{ value: 'Membro', label: 'Membro', count: 2 }], truncated: false });
  assert.deepEqual(options.cities.data, [{ value: 'Campinas', label: 'Campinas', count: 2 }]);
  assert.deepEqual(options.states.data, [{ value: 'SP', label: 'SP', count: 2 }]);
  assert.equal(options.neighborhoods.data[0].value, 'Centro');
  assert.deepEqual(options.status.map((item: { count: number }) => item.count), [1, 0, 1]);
  assert.deepEqual(options.location.map((item: { value: string }) => item.value), ['true', 'false']);
  assert.deepEqual(options.sort.map((item: { value: string }) => item.value), ['name', 'name_desc', 'newest', 'oldest']);
  assert.deepEqual(await (await api.request('/api/membros/filtros')).json(), options);
  await api.request('/api/usuarios/' + archived.id + '/restaurar', { method: 'POST' });
  assert.equal((await (await api.request('/api/usuarios/filtros')).json()).states.data.length, 2);
});

test('ordenação e paginação percorrem membros sem repetir IDs e contam apenas os filtrados', async t => {
  const api = await fixture(); t.after(api.close);
  const bruno = await createMember(api, { name: 'Bruno', status: 'active' });
  const ana = await createMember(api, { name: 'Ana', status: 'active' });
  await createMember(api, { name: 'Carlos', status: 'inactive' });
  api.store.database.prepare('UPDATE members SET created_at = ? WHERE id = ?').run(1000, bruno.id);
  api.store.database.prepare('UPDATE members SET created_at = ? WHERE id = ?').run(2000, ana.id);
  for (const [sort, expected] of [['name', ana.id], ['name_desc', bruno.id], ['newest', ana.id], ['oldest', bruno.id]]) {
    const result = await (await api.request(`/api/usuarios?status=active&pageSize=1&sort=${sort}`)).json();
    assert.equal(result.data[0].id, expected); assert.equal(result.pagination.total, 2); assert.equal(result.pagination.totalPages, 2);
    const second = await (await api.request(`/api/usuarios?status=active&pageSize=1&page=2&sort=${sort}`)).json();
    assert.notEqual(result.data[0].id, second.data[0].id);
  }
  const beyond = await (await api.request('/api/usuarios?status=active&page=3&pageSize=1')).json();
  assert.deepEqual(beyond.data, []); assert.equal(beyond.pagination.total, 2);
});

test('filtros inválidos e parâmetros repetidos não são aceitos como filtros verdadeiros', async t => {
  const api = await fixture(); t.after(api.close);
  for (const query of ['hasLocation=0', 'hasLocation=1', 'hasLocation=FALSE', 'hasLocation=', 'hasLocation=true&hasLocation=false', 'state=Brasil', 'state=', 'neighborhood=', 'category=', 'page=0', 'pageSize=101', 'q=' + 'a'.repeat(121), 'sort=name&sort=newest']) {
    assert.equal((await api.request('/api/usuarios?' + query)).status, 400, query);
  }
});

test('editar contato e filtro atualiza pesquisa, detalhe e opções; excluir e restaurar atualiza a lista', async t => {
  const api = await fixture(); t.after(api.close);
  const member = await createMember(api, { name: 'Pessoa antiga', email: 'antiga@example.test', phone: '(11) 99999-1111', category: 'Antiga' });
  const updated = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { name: 'Pessoa nova', email: 'nova@example.test', phone: '(11) 98888-2222', category: 'Nova', status: 'inactive' } });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).member.id, member.id);
  const detail = await (await api.request('/api/usuarios/' + member.id)).json();
  assert.equal(detail.member.email, 'nova@example.test');
  for (const q of ['antiga@example.test', '999991111']) assert.equal((await (await api.request('/api/usuarios?' + new URLSearchParams({ q }))).json()).pagination.total, 0);
  for (const q of ['nova pessoa', '988882222']) assert.equal((await (await api.request('/api/usuarios?' + new URLSearchParams({ q }))).json()).data[0].id, member.id);
  assert.equal((await (await api.request('/api/usuarios/filtros')).json()).categories.data[0].value, 'Nova');
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'DELETE' })).status, 204);
  assert.equal((await api.request('/api/usuarios/' + member.id)).status, 404);
  assert.equal((await (await api.request('/api/usuarios?q=nova')).json()).pagination.total, 0);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'DELETE' })).status, 204);
  assert.equal((await api.request('/api/usuarios/' + member.id + '/restaurar', { method: 'POST' })).status, 200);
  assert.equal((await (await api.request('/api/usuarios?status=inactive&category=Nova')).json()).data[0].id, member.id);
});

test('atualizações parciais preservam endereço; null limpa localização e endereço', async t => {
  const api = await fixture(); t.after(api.close);
  const member = await createMember(api, { name: 'Ana', address: { street: 'Rua Um', city: 'Campinas' }, location: { latitude: 0, longitude: 0 } });
  let response = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { address: { number: '20' }, status: 'inactive' } });
  assert.equal(response.status, 200);
  const updated = (await response.json()).member;
  assert.equal(updated.address.street, 'Rua Um'); assert.equal(updated.address.city, 'Campinas'); assert.equal(updated.address.number, '20');
  response = await api.request('/api/usuarios/' + member.id, { method: 'PATCH', body: { address: null, location: null } });
  const cleared = (await response.json()).member;
  assert.deepEqual(cleared.address, emptyAddress); assert.equal(cleared.location, null);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'PATCH' })).status, 400);
});

test('validação rejeita datas inexistentes, futuros, coordenadas e campos de administração', async t => {
  const api = await fixture(); t.after(api.close);
  for (const fields of [{ birthDate: '2025-02-30' }, { birthDate: '2999-01-01' }, { location: { latitude: 91, longitude: 0 } }, { location: { latitude: 0 } }, { address: { state: 'Brasil' } }, { phone: '123' }, { role: 'admin' }, { password: 'member-password' }]) {
    assert.equal((await api.request('/api/usuarios', { method: 'POST', body: { name: 'Teste', ...fields } })).status, 400);
  }
  assert.equal((await api.request('/api/usuarios/missing')).status, 404);
});

test('e-mails duplicados causam 409 e arquivamento pode ser desfeito', async t => {
  const api = await fixture(); t.after(api.close);
  const member = await createMember(api, { name: 'Ana', email: 'ana@example.test' });
  const duplicate = await api.request('/api/usuarios', { method: 'POST', body: { name: 'Outra Ana', email: 'ANA@example.test' } });
  assert.equal(duplicate.status, 409);
  assert.equal((await api.request('/api/usuarios/' + member.id, { method: 'DELETE' })).status, 204);
  assert.equal((await api.request('/api/usuarios/' + member.id)).status, 404);
  assert.equal((await (await api.request('/api/usuarios')).json()).pagination.total, 0);
  assert.equal((await (await api.request('/api/dashboard')).json()).counts.total, 0);
  assert.equal((await api.request('/api/usuarios/' + member.id + '/restaurar', { method: 'POST' })).status, 200);
  assert.equal((await api.request('/api/usuarios/' + member.id)).status, 200);
});

test('restauração não sobrescreve um cadastro novo com o mesmo e-mail', async t => {
  const api = await fixture(); t.after(api.close);
  const old = await createMember(api, { name: 'Ana antiga', email: 'ana@example.test' });
  await api.request('/api/usuarios/' + old.id, { method: 'DELETE' });
  const current = await createMember(api, { name: 'Ana nova', email: 'ana@example.test' });
  assert.equal((await api.request('/api/usuarios/' + old.id + '/restaurar', { method: 'POST' })).status, 409);
  const data = await (await api.request('/api/usuarios')).json();
  assert.equal(data.pagination.total, 1); assert.equal(data.data[0].id, current.id);
});

test('dashboard calcula contagens, categorias, série mensal e aniversários reais', async t => {
  const api = await fixture(); t.after(api.close);
  await createMember(api, { name: 'José', birthDate: '1990-10-09', joinedAt: '2026-10-01', category: 'Liderança', location: { latitude: 0, longitude: 0 } });
  await createMember(api, { name: 'Ana', birthDate: '2000-10-08', joinedAt: '2026-09-10', status: 'inactive' });
  const summary = new DashboardService(api.store.database, 'America/Sao_Paulo').summary(7, new Date('2026-10-08T12:00:00Z'));
  assert.deepEqual(summary.counts, { total: 2, active: 1, inactive: 1, pending: 0, withLocation: 1, withoutLocation: 1, activeLinks: 0, missionaries: 0, baptized: 0 });
  assert.equal(summary.birthdays.total, 1); assert.equal(summary.birthdays.data[0].daysUntil, 1); assert.equal(summary.birthdays.data[0].turningAge, 36);
  assert.equal(summary.membershipByMonth.length, 12);
  assert.deepEqual(summary.membershipByMonth.at(-1), { month: '2026-10', count: 1 });
  assert.equal(summary.byCategory.find(row => row.label === 'Liderança')!.count, 1);
  assert.equal((await api.request('/api/dashboard?birthdayDays=900')).status, 400);
});

test('datas respeitam o fuso da igreja, virada de ano e aniversário em 29/02', () => {
  assert.equal(todayInTimezone('America/Sao_Paulo', new Date('2026-10-09T01:00:00Z')), '2026-10-08');
  assert.deepEqual(nextBirthday('2000-02-29', '2027-02-27'), { date: '2027-02-28', daysUntil: 1, turningAge: 27 });
  assert.equal(nextBirthday('2000-02-29', '2028-02-28').date, '2028-02-29');
  assert.equal(nextBirthday('2000-01-02', '2026-12-31').date, '2027-01-02');
});

test('mapa entrega GeoJSON, mantém coordenadas zero e informa localização ausente', async t => {
  const api = await fixture(); t.after(api.close);
  await createMember(api, { name: 'Origem', location: { latitude: 0, longitude: 0 } });
  const brazil = await createMember(api, { name: 'Brasil', location: { latitude: -23.5, longitude: -46.6 } });
  await createMember(api, { name: 'Sem coordenadas' });
  await createMember(api, { name: 'Inativo', status: 'inactive', location: { latitude: 1, longitude: 1 } });
  const map = await (await api.request('/api/mapa')).json();
  assert.equal(map.type, 'FeatureCollection'); assert.equal(map.features.length, 3); assert.equal(map.meta.withoutLocation, 1);
  assert.ok(map.features.some((feature: { geometry: { coordinates: number[] } }) => feature.geometry.coordinates.every(value => value === 0)));
  const bounded = await (await api.request('/api/mapa?bounds=-50,-30,-40,-20')).json();
  assert.equal(bounded.features.length, 1); assert.equal(bounded.features[0].id, brazil.id);
  assert.deepEqual(bounded.features[0].geometry.coordinates, [-46.6, -23.5]);
  assert.equal((await (await api.request('/api/mapa?limit=1')).json()).meta.truncated, true);
  for (const bounds of ['200,0,210,10', '10,10,0,0', ',,,', 'NaN,0,1,1']) assert.equal((await api.request('/api/mapa?bounds=' + bounds)).status, 400);
});

test('link não armazena token em texto e cadastro público cria membro pendente sem conta', async t => {
  const api = await fixture(); t.after(api.close);
  const link = await createLink(api);
  const stored = api.store.database.prepare('SELECT * FROM registration_links WHERE id = ?').get(link.link.id)!;
  assert.notEqual(stored.token_hash, link.token); assert.equal(JSON.stringify(stored).includes(link.token), false);
  const info = await api.request('/api/cadastro/' + link.token, { cookie: null });
  assert.equal(info.status, 200); assert.deepEqual(Object.keys(await info.json()).sort(), ['expiresAt', 'label']);
  const submit = await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Novo membro', email: 'novo@example.test' } });
  assert.equal(submit.status, 202);
  assert.deepEqual(Object.keys(await submit.json()), ['message']);
  const members = await (await api.request('/api/usuarios?status=pending')).json();
  assert.equal(members.pagination.total, 1); assert.equal(members.data[0].category, 'Membro');
  assert.equal(api.store.findUserByEmail('novo@example.test'), undefined);
  assert.equal((await api.request('/api/cadastro/' + link.token, { cookie: null })).status, 404);
  const list = await (await api.request('/api/links')).json();
  assert.equal(list.data[0].usedCount, 1); assert.equal(list.data[0].status, 'exhausted');
  assert.equal('url' in list.data[0], false); assert.equal('token_hash' in list.data[0], false);
});

test('cadastro público rejeita privilégios e uso concorrente não excede limite do link', async t => {
  const api = await fixture(); t.after(api.close);
  const link = await createLink(api);
  assert.equal((await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Teste', status: 'active', role: 'admin' } })).status, 400);
  const responses = await Promise.all(['Pessoa Um', 'Pessoa Dois'].map(name => api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name } })));
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 404]);
  assert.equal((await (await api.request('/api/usuarios')).json()).pagination.total, 1);
  assert.equal((await (await api.request('/api/links/' + link.link.id)).json()).link.usedCount, 1);
});

test('links revogados, expirados ou inválidos não permitem cadastro', async t => {
  const api = await fixture(); t.after(api.close);
  const revoked = await createLink(api);
  assert.equal((await api.request('/api/links/' + revoked.link.id, { method: 'DELETE' })).status, 204);
  const expired = await createLink(api);
  api.store.database.prepare('UPDATE registration_links SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, expired.link.id);
  for (const token of [revoked.token, expired.token, 'invalid-token']) {
    assert.equal((await api.request('/api/cadastro/' + token, { cookie: null })).status, 404);
    assert.equal((await api.request('/api/cadastro/' + token, { method: 'POST', cookie: null, body: { name: 'Teste' } })).status, 404);
  }
  assert.equal((await api.request('/api/links', { method: 'POST', body: { label: 'Teste', maxUses: 0 } })).status, 400);
});

test('falha ao persistir cadastro desfaz a reserva do link e permite nova tentativa', async t => {
  const api = await fixture(); t.after(api.close);
  const link = await createLink(api);
  api.store.database.exec(`CREATE TRIGGER test_reject_member BEFORE INSERT ON members
    BEGIN SELECT RAISE(ABORT, 'Falha de teste na persistência'); END;`);
  const response = await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Membro novo' } });
  assert.equal(response.status, 500);
  assert.equal((await (await api.request('/api/links/' + link.link.id)).json()).link.usedCount, 0);
  assert.equal((await (await api.request('/api/usuarios')).json()).pagination.total, 0);
  api.store.database.exec('DROP TRIGGER test_reject_member');
  assert.equal((await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Membro novo' } })).status, 202);
});

test('rotas de cadastro público limitam abuso sem bloquear consultas administrativas', async t => {
  const api = await fixture(); t.after(api.close);
  for (let i = 0; i < 10; i++) {
    assert.equal((await api.request('/api/cadastro/invalid-token', { method: 'POST', cookie: null, body: { name: 'Teste' } })).status, 404);
  }
  const blocked = await api.request('/api/cadastro/invalid-token', { method: 'POST', cookie: null, body: { name: 'Teste' } });
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.has('retry-after'));
  assert.equal((await api.request('/api/usuarios')).status, 200);
});

test('confirmação pública não revela e-mail existente nem sobrescreve os dados', async t => {
  const api = await fixture(); t.after(api.close);
  const existing = await createMember(api, { name: 'Pessoa original', email: 'same@example.test' });
  const link = await createLink(api, 2);
  const duplicate = await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Outro nome', email: 'same@example.test' } });
  const fresh = await api.request('/api/cadastro/' + link.token, { method: 'POST', cookie: null, body: { name: 'Novo nome', email: 'fresh@example.test' } });
  assert.equal(duplicate.status, 202); assert.equal(fresh.status, 202);
  assert.deepEqual(await duplicate.json(), await fresh.json());
  assert.equal((await (await api.request('/api/usuarios/' + existing.id)).json()).member.name, 'Pessoa original');
  assert.equal((await (await api.request('/api/links/' + link.link.id)).json()).link.usedCount, 2);
});

test('perfil retorna somente a conta autenticada e fornece endpoints na navegação', async t => {
  const api = await fixture(); t.after(api.close);
  const response = await api.request('/api/perfil');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { user: { id: 'admin-id', name: 'Administrador', email: 'admin@example.test', role: 'admin' } });
  const secondCookie = await api.login('second@example.test');
  assert.equal((await (await api.request('/api/perfil', { cookie: secondCookie })).json()).user.id, 'second-admin');
  const panel = await (await api.request('/api/painel')).json();
  assert.equal(panel.navigation.account[0].endpoint, '/api/perfil');
  assert.equal(panel.navigation.account[0].passwordEndpoint, '/api/perfil/senha');
});

test('perfil salva e-mail e senha juntos e permite login somente com as novas credenciais', async t => {
  const api = await fixture(); t.after(api.close);
  const otherSession = await api.login();
  const otherAdmin = api.store.findUserById('second-admin');
  const newPassword = 'Outra-senha-segura-2026!';
  const response = await api.request('/api/perfil', { method: 'PATCH', body: {
    name: 'Rian Administrador', email: '  NOVO@EXAMPLE.TEST  ', currentPassword: password, newPassword,
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.deepEqual(await response.json(), {
    user: { id: 'admin-id', name: 'Rian Administrador', email: 'novo@example.test', role: 'admin' }, requiresLogin: true,
  });
  assert.notEqual(api.store.findUserById('admin-id')!.password_hash, newPassword);
  assert.deepEqual(api.store.findUserById('second-admin'), otherAdmin);
  assert.equal((await api.request('/api/auth/me')).status, 401);
  assert.equal((await api.request('/api/auth/me', { cookie: otherSession })).status, 401);
  for (const credentials of [{ email: 'admin@example.test', password }, { email: 'novo@example.test', password }]) {
    assert.equal((await api.request('/api/auth/login', { method: 'POST', cookie: null, body: credentials })).status, 401);
  }
  await api.login('novo@example.test', newPassword);
});

test('e-mail duplicado ou senha atual incorreta não altera nenhum campo nem revoga sessões', async t => {
  const api = await fixture(); t.after(api.close);
  const otherSession = await api.login();
  const original = api.store.findUserById('admin-id');
  const duplicate = await api.request('/api/perfil', { method: 'PATCH', body: {
    name: 'Nome diferente', email: 'SECOND@EXAMPLE.TEST', currentPassword: password, newPassword: 'Uma-nova-senha-segura!',
  } });
  assert.equal(duplicate.status, 409);
  assert.deepEqual((await duplicate.json()).errors.email, ['E-mail já cadastrado.']);
  assert.deepEqual(api.store.findUserById('admin-id'), original);
  const wrongPassword = await api.request('/api/perfil', { method: 'PATCH', body: {
    name: 'Nome diferente', email: 'novo@example.test', currentPassword: 'Senha-errada!', newPassword: 'Uma-nova-senha-segura!',
  } });
  assert.equal(wrongPassword.status, 400);
  assert.ok((await wrongPassword.json()).errors.currentPassword);
  assert.deepEqual(api.store.findUserById('admin-id'), original);
  assert.equal((await api.request('/api/auth/me')).status, 200);
  assert.equal((await api.request('/api/auth/me', { cookie: otherSession })).status, 200);
});

test('perfil rejeita dados inválidos, privilégios e senha nova sem senha atual', async t => {
  const api = await fixture(); t.after(api.close);
  const original = api.store.findUserById('admin-id');
  for (const body of [
    {}, { currentPassword: password }, { email: 'invalido' }, { newPassword: 'curta', currentPassword: password },
    { newPassword: password, currentPassword: password }, { newPassword: 'Uma-nova-senha-segura!' },
    { name: 'Outra pessoa', role: 'admin' }, { name: 'Outra pessoa', id: 'second-admin' }, { email: null },
  ]) {
    assert.equal((await api.request('/api/perfil', { method: 'PATCH', body })).status, 400);
    assert.deepEqual(api.store.findUserById('admin-id'), original);
  }
});

test('perfil bloqueia origem externa e limita escritas por administrador', async t => {
  const api = await fixture(); t.after(api.close);
  assert.equal((await api.request('/api/perfil', { method: 'PATCH', headers: { Origin: 'https://externo.example.test' }, body: { name: 'Outro nome' } })).status, 403);
  assert.equal((await api.request('/api/perfil/senha', { method: 'POST', headers: { Origin: 'https://externo.example.test' }, body: { currentPassword: password, newPassword: 'Uma-nova-senha-segura!' } })).status, 403);
  for (let i = 0; i < 10; i++) {
    const path = i % 2 === 0 ? '/api/perfil' : '/api/perfil/senha';
    assert.equal((await api.request(path, { method: i % 2 === 0 ? 'PATCH' : 'POST', body: {} })).status, 400);
  }
  const limited = await api.request('/api/perfil', { method: 'PATCH', body: { name: 'Outro nome' } });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.equal((await api.request('/api/perfil')).status, 200);
  const secondCookie = await api.login('second@example.test');
  assert.equal((await api.request('/api/perfil', { method: 'PATCH', cookie: secondCookie, body: { name: 'Segundo administrador' } })).status, 200);
});

test('sessão revogada durante uma edição não permite salvar credenciais', async t => {
  const api = await fixture(); t.after(api.close);
  const original = api.store.findUserById('admin-id');
  const session = api.store.database.prepare('SELECT id FROM sessions WHERE user_id = ?').get('admin-id')!;
  const service = new ProfileService(api.store);
  const updating = service.update('admin-id', String(session.id), { email: 'novo@example.test', currentPassword: password, newPassword: 'Uma-nova-senha-segura!' });
  api.store.deleteSession(String(session.id));
  await assert.rejects(updating, { status: 401 });
  assert.deepEqual(api.store.findUserById('admin-id'), original);
});

test('perfil atualiza nome; trocar e-mail exige senha e revoga outras sessões', async t => {
  const api = await fixture(); t.after(api.close);
  const otherSession = await api.login();
  const nameResponse = await api.request('/api/perfil', { method: 'PATCH', body: { name: 'Rian Administrador' } });
  assert.equal(nameResponse.status, 200); assert.equal((await nameResponse.json()).user.name, 'Rian Administrador');
  assert.equal((await api.request('/api/perfil', { method: 'PATCH', body: { email: 'novo-admin@example.test' } })).status, 400);
  assert.equal((await api.request('/api/perfil', { method: 'PATCH', body: { email: 'second@example.test', currentPassword: password } })).status, 409);
  const changed = await api.request('/api/perfil', { method: 'PATCH', body: { email: 'NOVO-ADMIN@EXAMPLE.TEST', currentPassword: password } });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).user.email, 'novo-admin@example.test');
  assert.equal((await api.request('/api/auth/me')).status, 200);
  assert.equal((await api.request('/api/auth/me', { cookie: otherSession })).status, 401);
  await api.login('novo-admin@example.test');
});

test('alteração de senha exige a atual e encerra todas as sessões', async t => {
  const api = await fixture(); t.after(api.close);
  const otherSession = await api.login();
  const newPassword = 'Uma-nova-senha-segura!';
  assert.equal((await api.request('/api/perfil/senha', { method: 'POST', body: { currentPassword: 'errada', newPassword } })).status, 400);
  assert.equal((await api.request('/api/perfil/senha', { method: 'POST', body: { currentPassword: password, newPassword: 'curta' } })).status, 400);
  const changed = await api.request('/api/perfil/senha', { method: 'POST', body: { currentPassword: password, newPassword } });
  assert.equal(changed.status, 200); assert.match(changed.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api.request('/api/auth/me')).status, 401);
  assert.equal((await api.request('/api/auth/me', { cookie: otherSession })).status, 401);
  const oldLogin = await api.request('/api/auth/login', { method: 'POST', cookie: null, body: { email: 'admin@example.test', password } });
  assert.equal(oldLogin.status, 401);
  await api.login('admin@example.test', newPassword);
});

test('membros e links sobrevivem ao reinício sem recriar dados existentes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'church-panel-test-'));
  let first: Awaited<ReturnType<typeof fixture>> | undefined;
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  t.after(async () => {
    await first?.close(); await second?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('church-panel-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const databasePath = join(directory, 'church.sqlite');
  first = await fixture({ databasePath });
  const member = await createMember(first, { name: 'Persistente' });
  const link = await createLink(first);
  await first.close(); first = undefined;
  second = await fixture({ databasePath }, false);
  assert.equal((await second.request('/api/usuarios/' + member.id)).status, 200);
  assert.equal((await second.request('/api/cadastro/' + link.token, { cookie: null })).status, 200);
  const summary = await (await second.request('/api/dashboard')).json();
  assert.equal(summary.counts.total, 1); assert.equal(summary.counts.activeLinks, 1);
});
