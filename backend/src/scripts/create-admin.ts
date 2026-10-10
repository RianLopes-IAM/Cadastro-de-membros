import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { AuthStore } from '../config/database.js';
import { readConfig } from '../config/env.js';
import { hashPassword } from '../services/password.js';

const adminSchema = z.object({
  name: z.string().trim().min(2, 'Informe um nome com pelo menos 2 caracteres.').max(100),
  email: z.string().trim().max(254).email('Informe um e-mail válido.').transform(value => value.toLowerCase()),
  password: z.string().min(12, 'A senha precisa ter pelo menos 12 caracteres.').max(128),
});

async function readSecret(label: string): Promise<string> {
  stdout.write(label);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('keypress', onKey); stdout.write('\n'); };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { finish(); reject(new Error('Operação cancelada.')); }
      else if (key.name === 'return') { finish(); resolve(value); }
      else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && text && !text.includes('\u001b')) value += text;
    };
    stdin.on('keypress', onKey);
  });
}

async function main() {
  if (!stdin.isTTY) throw new Error('Execute create-admin em um terminal interativo.');
  const prompts = createInterface({ input: stdin, output: stdout });
  const name = await prompts.question('Nome do administrador: ');
  const email = await prompts.question('E-mail: ');
  prompts.close();
  const password = await readSecret('Senha (mínimo 12 caracteres; não será exibida): ');
  const confirmation = await readSecret('Confirme a senha: ');
  if (password !== confirmation) throw new Error('As senhas não coincidem.');
  const result = adminSchema.safeParse({ name, email, password });
  if (!result.success) throw new Error(result.error.issues.map(issue => issue.message).join('\n'));
  const store = new AuthStore(readConfig().databasePath);
  try {
    if (store.findUserByEmail(result.data.email)) throw new Error('Já existe um administrador com este e-mail.');
    store.createUser({
      id: randomUUID(), name: result.data.name, email: result.data.email,
      password_hash: await hashPassword(result.data.password), role: 'admin',
    });
    stdout.write('Administrador criado. Você já pode entrar pela tela de login.\n');
  } finally { store.close(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Não foi possível criar o administrador.');
  process.exitCode = 1;
});
