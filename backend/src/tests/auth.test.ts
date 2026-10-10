import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import type { AppConfig } from '../config/env.js';
import { hashPassword, verifyPassword } from '../services/password.js';

const password = 'Uma-senha-forte-2026!';
const passwordHash = await hashPassword(password);
const config: AppConfig = {
  production: false, port: 3001, host: '127.0.0.1', frontendOrigins: ['http://localhost:5173'],
  jwtSecret: 'test-secret-only-not-for-production-123456789', databasePath: ':memory:', trustProxy: false,
};

async function fixture(overrides: Partial<AppConfig> = {}, seed = true) {
  const { app, store } = await createApp({ ...config, ...overrides });
  if (seed) store.createUser({ id: 'admin-id', name: 'Administrador', email: 'admin@example.test', role: 'admin', password_hash: passwordHash });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store,
    get: (path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} }),
    post: (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
    rawPost: (body: string) => fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }),
    login: (rememberMe = false) => fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password, rememberMe }),
    }),
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      store.close();
    },
  };
}

function cookieOf(response: Response): string {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';')[0];
}

test('hashes com salt são diferentes e não guardam a senha em texto', async () => {
  assert.notEqual(await hashPassword(password), passwordHash);
  assert.equal(passwordHash.includes(password), false);
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('outra senha', passwordHash), false);
});

test('login normaliza e-mail, devolve somente dados públicos e define cookie protegido', async t => {
  const api = await fixture(); t.after(api.close);
  const response = await api.post('/api/auth/login', { email: '  ADMIN@EXAMPLE.TEST  ', password });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.user, { id: 'admin-id', name: 'Administrador', email: 'admin@example.test', role: 'admin' });
  assert.equal('token' in data, false); assert.equal('password_hash' in data.user, false);
  assert.ok(Date.parse(data.expiresAt) > Date.now());
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\/api/);
  assert.doesNotMatch(cookie, /Max-Age/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('x-content-type-options'));
});

test('conta inexistente e senha incorreta têm a mesma resposta', async t => {
  const api = await fixture(); t.after(api.close);
  const unknown = await api.post('/api/auth/login', { email: 'unknown@example.test', password });
  const incorrect = await api.post('/api/auth/login', { email: 'admin@example.test', password: 'incorreta' });
  assert.equal(unknown.status, 401); assert.equal(incorrect.status, 401);
  assert.deepEqual(await unknown.json(), await incorrect.json());
  assert.equal(incorrect.headers.has('set-cookie'), false);
});

test('payload inválido e rememberMe com tipo incorreto são rejeitados', async t => {
  const api = await fixture(); t.after(api.close);
  for (const body of [null, {}, { email: 'invalid', password: '' }, { email: 'admin@example.test', password, rememberMe: 'true' }]) {
    assert.equal((await api.post('/api/auth/login', body)).status, 400);
  }
});

test('consulta de sessão e membros exigem autenticação', async t => {
  const api = await fixture(); t.after(api.close);
  assert.equal((await api.get('/api/auth/me')).status, 401);
  assert.equal((await api.get('/api/membros')).status, 401);
  const cookie = cookieOf(await api.login());
  const me = await api.get('/api/auth/me', cookie);
  assert.equal(me.status, 200); assert.equal((await me.json()).user.id, 'admin-id');
  assert.equal((await api.get('/api/membros', cookie)).status, 200);
});

test('JSON malformado e requisições acima do limite devolvem erros controlados', async t => {
  const api = await fixture(); t.after(api.close);
  const malformed = await api.rawPost('{"email":');
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { message: 'JSON inválido.' });
  const large = await api.post('/api/auth/login', { email: 'admin@example.test', password: 'a'.repeat(9000) });
  assert.equal(large.status, 413);
  assert.deepEqual(await large.json(), { message: 'Requisição muito grande.' });
});

test('não há cadastro público de administradores', async t => {
  const api = await fixture(); t.after(api.close);
  assert.equal((await api.post('/api/auth/register', { name: 'Teste', email: 'teste@example.test', password })).status, 404);
  assert.equal(api.store.findUserByEmail('teste@example.test'), undefined);
});

test('manter conectado cria cookie persistente e sessão de sete dias', async t => {
  const api = await fixture(); t.after(api.close);
  const response = await api.login(true);
  assert.match(response.headers.get('set-cookie')!, /Max-Age=604800/);
  const { expiresAt } = await response.json();
  const remaining = Date.parse(expiresAt) - Date.now();
  assert.ok(remaining > 604_790_000 && remaining <= 604_800_000);
});

test('logout revoga o token no servidor e é idempotente', async t => {
  const api = await fixture(); t.after(api.close);
  const cookie = cookieOf(await api.login());
  const logout = await api.post('/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await api.get('/api/auth/me', cookie)).status, 401);
  assert.equal((await api.post('/api/auth/logout', {})).status, 204);
});

test('novo login revoga a sessão anterior do mesmo navegador', async t => {
  const api = await fixture(); t.after(api.close);
  const oldCookie = cookieOf(await api.login());
  const response = await api.post('/api/auth/login', { email: 'admin@example.test', password }, { Cookie: oldCookie });
  assert.equal(response.status, 200);
  assert.equal((await api.get('/api/auth/me', oldCookie)).status, 401);
  assert.equal((await api.get('/api/auth/me', cookieOf(response))).status, 200);
});

test('tokens adulterados, expirados, com outro público ou sem sessão são rejeitados', async t => {
  const api = await fixture(); t.after(api.close);
  const cookie = cookieOf(await api.login());
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const payload = jwt.decode(token) as jwt.JwtPayload;
  const wrongAudience = jwt.sign({}, config.jwtSecret, { subject: 'admin-id', jwtid: payload.jti, issuer: 'cadastro-de-membros', audience: 'other-app', expiresIn: 3600 });
  const expired = jwt.sign({}, config.jwtSecret, { subject: 'admin-id', jwtid: payload.jti, issuer: 'cadastro-de-membros', audience: 'church-administration', expiresIn: -1 });
  const untracked = jwt.sign({}, config.jwtSecret, { subject: 'admin-id', jwtid: randomUUID(), issuer: 'cadastro-de-membros', audience: 'church-administration', expiresIn: 3600 });
  for (const value of [token + 'tampered', 'malformed', expired, wrongAudience, untracked]) {
    assert.equal((await api.get('/api/auth/me', 'church_session=' + value)).status, 401);
  }
  api.store.database.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
  assert.equal((await api.get('/api/auth/me', cookie)).status, 401);
});

test('origens externas e envio de formulário não podem realizar login ou logout', async t => {
  const api = await fixture(); t.after(api.close);
  const response = await api.post('/api/auth/login', { email: 'admin@example.test', password }, { Origin: 'https://untrusted.example' });
  assert.equal(response.status, 403); assert.equal(response.headers.has('access-control-allow-origin'), false);
  assert.equal((await api.post('/api/auth/logout', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api.post('/api/auth/logout', {}, { 'Content-Type': 'text/plain' })).status, 415);
  const allowed = await api.post('/api/auth/login', { email: 'admin@example.test', password }, { Origin: 'http://localhost:5173' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
});

test('limite de tentativas bloqueia força bruta com 429', async t => {
  const api = await fixture(); t.after(api.close);
  for (let i = 0; i < 10; i++) assert.equal((await api.post('/api/auth/login', { email: 'admin@example.test', password: 'wrong' })).status, 401);
  const blocked = await api.login();
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.has('retry-after'));
});

test('produção usa cookie Secure', async t => {
  const api = await fixture({ production: true }); t.after(api.close);
  assert.match((await api.login()).headers.get('set-cookie')!, /; Secure/);
});

test('contas e sessões continuam válidas depois de reiniciar a API', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'church-auth-test-'));
  const databasePath = join(directory, 'auth.sqlite');
  let first: Awaited<ReturnType<typeof fixture>> | undefined;
  let second: Awaited<ReturnType<typeof fixture>> | undefined;
  t.after(async () => {
    await first?.close(); await second?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('church-auth-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  first = await fixture({ databasePath });
  const cookie = cookieOf(await first.login(true));
  await first.close(); first = undefined;
  second = await fixture({ databasePath }, false);
  assert.equal((await second.get('/api/auth/me', cookie)).status, 200);
  assert.equal((await second.login()).status, 200);
});
