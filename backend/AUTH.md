# Contrato de autenticação

Base: `/api/auth`. Todas as requisições de escrita devem enviar `Content-Type: application/json`. O navegador precisa de `credentials: 'include'`.

## Iniciar localmente

Com Node.js 24+ e npm, execute na raiz do repositório:

```sh
npm install
npm run create-admin
npm run dev
```

Crie sua própria conta pelo terminal: o comando pede nome, e-mail, senha (mínimo de 12 caracteres, sem exibir o conteúdo) e confirmação. Abra http://localhost:5173. Não existe conta ou senha padrão. Em desenvolvimento o banco SQLite e a chave JWT são criados automaticamente em `backend/data/`, ignorado pelo Git. Consulte o README do repositório para mais detalhes.

## Login — POST /api/auth/login

```json
{
  "email": "administrador@suaigreja.com",
  "password": "senha-da-conta",
  "rememberMe": false
}
```

`rememberMe` é opcional e assume `false`. O e-mail é normalizado; a senha não sofre trim nem normalização.

Resposta 200, junto do cookie de sessão:

```json
{
  "user": {
    "id": "uuid",
    "name": "Nome do administrador",
    "email": "administrador@suaigreja.com",
    "role": "admin"
  },
  "expiresAt": "2026-10-09T12:00:00.000Z"
}
```

O horário acima é ilustrativo. O token não é retornado no JSON. A senha e seu hash nunca aparecem nas respostas.

## Sessão — GET /api/auth/me

Resposta 200 com o mesmo formato do login quando a sessão está válida. Retorna 401 e limpa o cookie quando a sessão não existe, expirou ou foi revogada. Consulte esta rota ao inicializar o frontend.

## Logout — POST /api/auth/logout

Envie `{}` no corpo. Revoga a sessão no SQLite, limpa o cookie e retorna **204 sem corpo**. Pode ser chamado mesmo quando não há sessão válida.

## Erros

| Status | Situação |
| --- | --- |
| 400 | Campos inválidos ou JSON malformado |
| 401 | Credenciais incorretas ou sessão inválida |
| 403 | Origem de escrita não permitida |
| 409 | E-mail em conflito ou edição concorrente |
| 413 | Corpo maior que 8 KB |
| 415 | Escrita sem `application/json` |
| 429 | Limite de tentativas excedido; use `Retry-After` |
| 500 | Falha interna; resposta sem detalhes sensíveis |

Formato: `{ "message": "Mensagem em português" }`. Erros de validação também incluem `errors`, por exemplo `{ "email": ["Informe um e-mail válido."] }`. A resposta de login é idêntica para conta inexistente e senha incorreta.

## Exemplo de integração

```ts
const response = await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, rememberMe }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.message);
// result.user pode alimentar o contexto e a navegação do seu frontend.
```

No React deste repositório, prefira `authApi` ou `useAuth()` para aproveitar o tratamento de erros existente. O backend continua exigindo a sessão em todas as rotas protegidas, independentemente das proteções visuais do frontend.

## Desenvolvimento e produção

O proxy do Vite já encaminha `/api` ao backend na porta 3001. Se alterar `PORT`, ajuste o proxy em `frontend/vite.config.ts`.

Para configurar, copie `backend/.env.example` para `backend/.env`. Os caminhos relativos de `DATABASE_PATH` são resolvidos a partir da pasta `backend`, inclusive no código compilado.

Em produção:

1. Configure `NODE_ENV=production`, `JWT_SECRET` (aleatório, pelo menos 32 caracteres) e `FRONTEND_ORIGIN=https://seu-dominio.com` (sem barra final).
2. Use HTTPS, publique `frontend/dist` e encaminhe `/api` ao backend por um proxy reverso no **mesmo domínio**. Se o backend estiver em outro subdomínio, ambos precisam pertencer ao mesmo site; a implantação padrão evita cookies de terceiros.
3. Configure `HOST=0.0.0.0` se seu provedor exigir escuta externa. Só habilite `TRUST_PROXY=true` atrás de exatamente um proxy reverso confiável e com o backend protegido contra acesso direto.
4. Use um disco persistente para `DATABASE_PATH` e guarde backups do SQLite. Esta implementação usa uma instância de backend; para múltiplas instâncias, migre a persistência e o limitador para serviços compartilhados.
5. Crie o administrador com `npm run create-admin` no ambiente que usa esse mesmo banco e execute `npm run build` / `npm start`.

Não existe endpoint público de criação de administradores ou recuperação de senha por e-mail nesta etapa.

O painel, o perfil e os links de cadastro de membros estão documentados em `backend/PANEL.md`. O cadastro público por link cria registros de membros pendentes, sem conceder acesso administrativo. A alteração autenticada de senha encerra todas as sessões da conta.

Referências usadas: [JWT](https://github.com/auth0/node-jsonwebtoken), [SQLite no Node.js](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
