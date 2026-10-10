# Membros — gestão da igreja

Monorepo com React + TypeScript + Vite e Node.js + Express + TypeScript. Inclui autenticação de administradores, tela de login e backend do painel de gestão da igreja.

## Rodar localmente

Requer **Node.js 24+ e npm**. Na raiz do repositório:

```sh
npm install
npm run create-admin
npm run dev
```

O comando `create-admin` pede nome, e-mail e senha (mínimo 12 caracteres, sem exibi-la). Crie sua própria conta: não há usuário ou senha padrão, nem cadastro público de administradores. As contas de acesso são independentes dos futuros cadastros de membros.

Abra **http://localhost:5173** e entre com a conta criada. API: http://localhost:3001/api/health.

O SQLite e a chave JWT local são criados automaticamente em `backend/data/`, que está ignorado pelo Git. Contas e sessões sobrevivem ao reinício do servidor. Em desenvolvimento não é necessário configurar `.env`.

## Comandos

| Comando | Função |
| --- | --- |
| `npm run dev` | Iniciar frontend e backend |
| `npm run create-admin` | Criar uma conta administrativa pelo terminal |
| `npm run build` | Compilar frontend e backend |
| `npm run lint` | Verificar o código do frontend |
| `npm test` | Testar autenticação e proteções da API |
| `npm start` | Iniciar o backend compilado |

## Autenticação

- E-mail e senha; mensagens em português e validação do formulário.
- Senhas com scrypt (salt aleatório, N=32768, r=8, p=3), nunca em texto puro.
- JWT HS256 com emissor, público, expiração e sessão revogável no banco.
- Cookie `HttpOnly`, `SameSite=Lax`, `Path=/api` e `Secure` em produção.
- Sessão normal: até 8 horas, cookie de sessão do navegador. “Manter conectado”: até 7 dias, cookie persistente. O logout revoga a sessão imediatamente.
- Limite de 10 tentativas malsucedidas por IP em 15 minutos; as respostas 429 incluem `Retry-After`. O contador é local ao processo e reinicia com a API.
- Origens de escrita verificadas, CORS restrito e respostas de autenticação sem cache.
- Layout responsivo, mostrar/ocultar senha, estado de carregamento, orientações de acesso e confirmação após autenticar.

## Integração com o frontend

O contrato, exemplos de `fetch` e configuração de produção estão em [backend/AUTH.md](backend/AUTH.md).

O CRUD de membros, pesquisa por palavras ou telefone, filtros combinados, opções para selects e lista paginada estão em [backend/USERS.md](backend/USERS.md).

O dashboard retorna cartões com o total real de membros, missionários e batizados em `GET /api/dashboard`. Critérios de contagem e integração estão em [backend/DASHBOARD.md](backend/DASHBOARD.md).

O perfil permite editar nome, e-mail de login e senha da conta autenticada, inclusive e-mail e senha na mesma solicitação. Rotas, exemplos e encerramento de sessões estão em [backend/PROFILE.md](backend/PROFILE.md).

A aba Link, o formulário completo de dados pessoais/familiares e histórico na igreja, foto e cálculos automáticos estão em [backend/REGISTRATION.md](backend/REGISTRATION.md). O backend gera a URL e fornece as perguntas por API para a página pública `/cadastro/:token` implementada pelo frontend.

As APIs da página principal estão documentadas em [backend/PANEL.md](backend/PANEL.md): dashboard, usuários (membros), mapa, links de cadastro, perfil e saída. `GET /api/painel` fornece o administrador autenticado e os seis itens para a sidebar. O frontend do painel e a página pública de cadastro devem consumir esse contrato. A consulta de CEP, localização automática aproximada, pontos GeoJSON e tratamento de pendências estão em [backend/MAP.md](backend/MAP.md).

O frontend já oferece `authApi` em `frontend/src/services/auth.ts`, `AuthProvider` em `frontend/src/features/auth/AuthProvider.tsx` e `useAuth` em `frontend/src/features/auth/useAuth.ts`. O frontend principal pode envolver suas rotas com o provider e usar `session`, `loading`, `login` e `logout` para integrar o login. Após autenticar, esta entrega mostra a confirmação de acesso na própria página; seu frontend pode usar a presença de `session` para navegar ao painel.

Não guarde tokens no `localStorage` nem tente ler o cookie pelo JavaScript: o navegador o envia usando `credentials: 'include'`.

## Estrutura

```text
backend/src/config/       Ambiente e banco SQLite
backend/src/models/       Tipos de usuário e sessão
backend/src/services/     Senhas, JWT e persistência de sessão
backend/src/controllers/  Login, sessão e logout
backend/src/middlewares/  Validação de sessão e origem
backend/src/routes/       Rotas de autenticação
backend/src/scripts/      Criação de administrador
backend/src/tests/        Testes HTTP de autenticação
frontend/src/pages/       Tela de login
frontend/src/features/    Estado compartilhado de autenticação
frontend/src/services/    Cliente da API
```

`/api/usuarios` e seu alias `/api/membros` oferecem cadastro, consulta, edição, arquivamento e restauração de membros, com busca e paginação. O dashboard calcula estatísticas e aniversários; o mapa retorna GeoJSON paginado de todos os status. O backend consulta CEP com BrasilAPI e ViaCEP, preenche o endereço, salva coordenadas aproximadas quando disponíveis e identifica cadastros sem ponto. Os links públicos recebem novos membros como pendentes para aprovação. Categorias são campos livres do cadastro.

O perfil permite alterar nome, e-mail e senha da conta autenticada. Membros não recebem acesso administrativo. Todas as rotas de gestão exigem sessão válida. O SQLite cria as novas tabelas automaticamente sem apagar os dados existentes.
