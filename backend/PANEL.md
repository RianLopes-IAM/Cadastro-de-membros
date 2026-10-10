# Backend do painel da igreja

Esta entrega fornece **somente a API** da página principal. A sidebar, as telas do painel e o formulário público ficam a cargo do frontend. O login existente continua usando o cookie `church_session`.

## Executar

Na raiz do repositório, com Node.js 24+ e npm:

```sh
npm install
npm run create-admin
npm run dev -w backend
```

`create-admin` é necessário apenas para criar uma conta de acesso. As contas já existentes continuam válidas. O backend usa a porta 3001. Para iniciar também o frontend de login existente, use `npm run dev` na raiz.

As novas tabelas são criadas automaticamente no mesmo SQLite configurado por `DATABASE_PATH`, sem apagar contas, sessões ou cadastros. `CHURCH_TIMEZONE` controla as datas do dashboard e assume `America/Sao_Paulo`.

## Autenticação e formato

Todas as rotas administrativas exigem uma sessão válida. Use `credentials: 'include'` no `fetch`. Escritas (POST, PATCH e DELETE) exigem `Content-Type: application/json`; envie `{}` quando não houver campos. A API verifica a origem da requisição e retorna `Cache-Control: no-store`.

Usuários desta seção são **membros da igreja**. Eles não recebem senha ou acesso administrativo. O perfil pertence à conta administrativa autenticada. Esta versão atende uma igreja e todos os administradores têm acesso às mesmas informações.

| Item | Método e rota | Resultado |
| --- | --- | --- |
| Inicialização do painel | `GET /api/painel` | Administrador atual e itens da sidebar |
| Dashboard | `GET /api/dashboard` | Cartões de membros, missionários e batizados, demais contagens, gráficos e aniversários |
| Usuários | `GET /api/usuarios` | Membros com busca, filtros e paginação |
| Filtros dos usuários | `GET /api/usuarios/filtros` | Opções reais, contagens e ordenações |
| Usuário | `GET /api/usuarios/:id` | Detalhes do membro |
| Cadastrar usuário | `POST /api/usuarios` | Novo membro, resposta 201 |
| Editar usuário | `PATCH /api/usuarios/:id` | Atualizar somente os campos enviados |
| Remover usuário | `DELETE /api/usuarios/:id` | Arquivar o membro, resposta 204 |
| Restaurar usuário | `POST /api/usuarios/:id/restaurar` | Desfazer o arquivamento |
| Mapa | `GET /api/mapa` | GeoJSON com coordenadas dos membros |
| Link | `GET /api/links` | Lista paginada de links e situação de cada um |
| Consultar link | `GET /api/links/:id` | Detalhes de um link |
| Gerar link | `POST /api/links` | Link de cadastro público, resposta 201 |
| Revogar link | `DELETE /api/links/:id` | Invalidar o link, resposta 204 |
| Perfil | `GET /api/perfil` | Dados públicos do administrador atual |
| Editar perfil | `PATCH /api/perfil` | Alterar nome, e-mail e/ou senha na mesma transação |
| Alterar senha | `POST /api/perfil/senha` | Alterar senha e encerrar todas as sessões |
| Sair | `POST /api/auth/logout` | Revogar a sessão atual e limpar o cookie, resposta 204 |

`/api/membros` oferece os mesmos endpoints de `/api/usuarios` como alias. A rota inicial que retornava `[]` agora retorna a lista paginada real.

## Sidebar e navegação

`GET /api/painel` devolve:

```json
{
  "user": { "id": "uuid", "name": "Administrador", "email": "admin@suaigreja.com", "role": "admin" },
  "navigation": {
    "main": [
      { "key": "dashboard", "label": "Dashboard", "path": "/dashboard", "endpoint": "/api/dashboard" },
      { "key": "usuarios", "label": "Usuários", "path": "/usuarios" },
      { "key": "mapa", "label": "Mapa", "path": "/mapa" },
      { "key": "links", "label": "Link", "path": "/links" }
    ],
    "account": [
      { "key": "perfil", "label": "Perfil", "path": "/perfil", "endpoint": "/api/perfil", "passwordEndpoint": "/api/perfil/senha" },
      { "key": "sair", "label": "Sair", "action": "logout", "method": "POST", "endpoint": "/api/auth/logout" }
    ]
  }
}
```

Os caminhos em `navigation` são sugestões de rotas para o frontend implementar. “Sair” é uma ação de logout, e não uma página.

## Membros

Exemplo de criação:

```json
{
  "name": "Maria da Silva",
  "email": "maria@exemplo.com",
  "phone": "(11) 99999-1234",
  "birthDate": "1990-05-10",
  "joinedAt": "2026-10-01",
  "category": "Membro",
  "status": "active",
  "address": {
    "street": "Rua Exemplo",
    "number": "100",
    "complement": null,
    "neighborhood": "Centro",
    "city": "São Paulo",
    "state": "SP",
    "postalCode": "01000-000"
  },
  "location": { "latitude": -23.55, "longitude": -46.63 }
}
```

Somente `name` é obrigatório. Nome: 2–120 caracteres. E-mail é opcional, normalizado para minúsculas e único entre os registros não arquivados. Telefone: 10–15 dígitos; pode conter formatação. Datas devem existir, usar `AAAA-MM-DD`, ser a partir de 1900 e não estar no futuro.

Valores padrão: `status=active`, `category=Membro`, `joinedAt` na data atual da igreja, campos opcionais `null`. Situações: `active` (ativo), `inactive` (inativo), `pending` (aguardando aprovação). Categorias são textos livres de até 60 caracteres.

Respostas de criação, detalhe, edição e restauração: `{ "member": { ... } }`. O membro também inclui `id`, `createdAt` e `updatedAt` (datas ISO em UTC). `address` sempre contém os sete campos, mesmo quando estão vazios (`null`). `location` é um objeto completo com latitude/longitude ou `null`.

Filtros de lista:

```text
GET /api/usuarios?q=maria&status=active&category=Membro&city=São%20Paulo&page=1&pageSize=20&sort=name
```

- `q`: busca por nome, e-mail, telefone, categoria, cidade ou bairro; ignora maiúsculas, acentos e espaços extras. Combina palavras em qualquer ordem e aceita telefones com formatação. Trata `%`/`_` como texto literal.
- `status`, `category`, `city`, `neighborhood`: filtros exatos. `state`: UF de duas letras, normalizada para maiúsculas.
- `hasLocation`: string `true` para membros com coordenadas e string `false` para membros sem coordenadas.
- `page`: padrão 1. `pageSize`: padrão 20, máximo 100.
- `sort`: `name` (padrão), `name_desc`, `newest` ou `oldest`.

`GET /api/usuarios/filtros` fornece status com contagens, opções reais de categoria, cidade, UF e bairro (até 200 por grupo, com indicação `truncated`), opções de presença de localização e ordenação. As contagens são gerais e excluem arquivados. Contrato completo do CRUD e exemplos em [USERS.md](USERS.md).

Formato de lista:

```json
{
  "data": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

Na edição, campos omitidos são preservados. Envie `null` para limpar campos opcionais, `location: null` para remover as coordenadas e `address: null` para limpar o endereço. Um endereço parcial, como `{ "address": { "number": "200" } }`, preserva o restante. `name`, `joinedAt`, `category` e `status` não aceitam `null`. Campos desconhecidos são rejeitados.

Arquivar oculta o membro da lista, do dashboard e do mapa, preservando seus dados para restauração. Se outro cadastro passar a usar o mesmo e-mail, a restauração retorna 409 até o conflito ser resolvido.

## Dashboard

`GET /api/dashboard?birthdayDays=30`, com `birthdayDays` entre 0 e 90, retorna:

- `asOf` e `timezone`: data usada nos cálculos e fuso da igreja.
- `counts`: `total`, `active`, `inactive`, `pending`, `withLocation`, `withoutLocation`, `activeLinks`, `missionaries`, `baptized`.
- `cards`: três objetos `{ key, label, value }` para membros cadastrados (`members`), missionários (`missionaries`) e batizados (`baptized`).
- `byCategory` e `byCity`: arrays de `{ label, count }`.
- `membershipByMonth`: os últimos 12 meses em `{ month: "AAAA-MM", count }`, contando a data de entrada `joinedAt` dos membros.
- `birthdays`: `{ windowDays, total, data, truncated }`. Cada aniversário contém `id`, `name`, `birthDate`, `nextBirthday`, `daysUntil`, `turningAge`.
- `latestMembers`: os cinco cadastros mais recentes.

Aniversários incluem apenas membros ativos, a partir de hoje e até o prazo indicado, inclusive. São retornados até 100 itens; `total` informa a quantidade real. Para nascidos em 29/02, a lembrança ocorre em 28/02 nos anos não bissextos. Registros arquivados não entram nas estatísticas. Membros pendentes e inativos entram nas contagens gerais.

Missionários são identificados pela categoria Missionário/Missionária, incluindo os plurais, sem distinção de acentos ou maiúsculas. Batizados têm `baptismDate` até hoje ou `admissionType: "baptism"`; cada pessoa conta uma vez. Os cartões refletem os dados atuais do banco e retornam zero quando não há cadastros. Critérios e exemplo para o frontend em [DASHBOARD.md](DASHBOARD.md).

## Mapa

```text
GET /api/mapa?status=active&limit=500&bounds=-50,-30,-40,-20
```

Suporta `q`, `status`, `category`, `city`, `state`, `neighborhood` e `hasLocation`. Sem filtro de status, mostra membros ativos, inativos e pendentes. `limit` vai de 1 a 1000 (padrão 500); `page` começa em 1. `bounds` é opcional e usa `longitudeMin,latitudeMin,longitudeMax,latitudeMax`; os limites devem estar ordenados e não atravessar o antimeridiano.

Resposta: GeoJSON `FeatureCollection`. Cada ponto possui `id`, `geometry.coordinates` em ordem **[longitude, latitude]** e `properties` com `id`, `name`, `category`, `status`, `address`, `city`, `neighborhood`, `geocoding`.

`meta` contém `total`, `withoutLocation`, `located` (todos antes do recorte por bounds), `withinBounds`, `returned`, `truncated`, `page`, `totalPages`, `nextPage`. Siga `nextPage` até `null` para carregar todos os pontos. Membros sem coordenadas aparecem em `GET /api/mapa/pendentes`.

Ao cadastrar ou alterar o endereço de um membro, o backend consulta BrasilAPI e usa ViaCEP como fallback, preenche campos vazios e salva coordenadas disponíveis. Pontos derivados do CEP são **aproximados**, sem identificar a casa pelo número. Coordenadas informadas manualmente são preservadas. Mudanças de endereço invalidam o ponto anterior e tentam recalcular; edições que só alteram nome, categoria ou status preservam o ponto. Falhas dos provedores não impedem salvar o cadastro e são registradas em `geocoding`.

`GET /api/cep/:cep` consulta o CEP com login. `POST /api/usuarios/:id/localizar` tenta localizar um registro sem coordenadas; `POST /api/mapa/localizar` recebe `{ ids: [...] }` com até 20 membros. Para o formulário público, existe `GET /api/cadastro/:token/cep/:cep` com link válido. Contrato completo, precisão, cache e exemplos em [MAP.md](MAP.md).

## Links e cadastro público

Criar link:

```json
{ "label": "Novos membros", "expiresInDays": 7, "maxUses": 1 }
```

`label` tem 2–120 caracteres. `expiresInDays`: 1–90, padrão 7. `maxUses`: 1–1000, padrão 1. A resposta contém `{ link, url }`, com URL no formato `FRONTEND_ORIGIN/cadastro/TOKEN`.

**Copie a URL no momento da criação.** O token é armazenado somente como hash; a API não devolve a URL na lista ou consulta posterior. Para obter outra URL, gere um novo link e revogue o antigo se necessário.

O objeto `link` contém `id`, `label`, `expiresAt`, `maxUses`, `usedCount`, `status`, `createdAt`, `revokedAt`. Situações: `active`, `expired`, `revoked`, `exhausted`. `GET /api/links` aceita `page` e `pageSize` e usa o mesmo formato de paginação dos membros.

O frontend precisa criar a página pública `/cadastro/:token` e conectar as rotas abaixo, que **não exigem login**, mas validam o token do link:

| Método e rota | Uso |
| --- | --- |
| `GET /api/cadastro/:token` | Validar o link; retorna somente `{ label, expiresAt }` |
| `GET /api/cadastro/:token/formulario` | Perguntas, opções, campos calculados e endpoints do formulário |
| `POST /api/cadastro/:token/calculos` | Prévia das idades e do tempo de casamento |
| `POST /api/cadastro/:token/foto` | Enviar foto JPEG, PNG ou WebP e obter `photoId` |
| `POST /api/cadastro/:token` | Enviar dados pessoais, familiares, endereço, foto e histórico na igreja |

Na submissão, só `name` é obrigatório. `joinedAt` aceita a data de entrada informada e assume a data atual se omitido. Não envie `status`, `category`, `role`, senha ou valores calculados de idade e casamento. O servidor define `status=pending`, `category=Membro`. Resposta 202: `{ "message": "Cadastro enviado. Aguarde a confirmação da igreja." }`. Todos os campos, cálculos e upload estão documentados em [REGISTRATION.md](REGISTRATION.md). `GET /api/links/formulario` fornece o contrato das perguntas para o administrador.

O administrador aprova o cadastro usando `PATCH /api/usuarios/:id` com `{ "status": "active" }`. Nenhuma conta administrativa é criada por esse formulário. E-mails já existentes recebem a mesma confirmação pública, preservando o registro existente e contabilizando o uso do link, para não revelar se a pessoa já está cadastrada.

Links inválidos, expirados, revogados ou esgotados retornam 404 com mensagem genérica. A gravação e o consumo de uso são atômicos, inclusive em envios simultâneos. As rotas públicas têm limites por IP: 100 consultas em 15 minutos e 10 envios em uma hora. Esses limites são locais ao processo.

## Perfil e saída

`GET /api/perfil` retorna `{ user }` sem senha ou hash. Edição de nome:

```json
{ "name": "Nome atualizado" }
```

Alterar e-mail exige a senha atual:

```json
{ "email": "novo@exemplo.com", "currentPassword": "senha-atual" }
```

Ao alterar o e-mail, as outras sessões da conta são revogadas; a sessão atual continua válida. Atualize o estado do frontend com `user` da resposta ou consulte `/api/auth/me` novamente.

`PATCH /api/perfil` também aceita `newPassword` com `currentPassword`, permitindo salvar e-mail e senha juntos em uma transação. A resposta contém `{ user, requiresLogin }`: `requiresLogin=true` se a senha mudou, caso em que todas as sessões são encerradas e o cookie é limpo; em alterações apenas de nome/e-mail, o valor é `false`. Campos não enviados são preservados. Contrato completo e erros em [PROFILE.md](PROFILE.md).

Para trocar a senha, envie a `POST /api/perfil/senha`:

```json
{ "currentPassword": "senha-atual", "newPassword": "nova-senha-com-12-ou-mais-caracteres" }
```

A nova senha precisa ser diferente da atual e ter 12–128 caracteres. A resposta 200 confirma a alteração com `message` e `requiresLogin: true` e limpa o cookie. Todas as sessões são revogadas; o frontend deve voltar para o login. Alterações de perfil e senha compartilham um limite de 10 solicitações por administrador em 15 minutos.

Para “Sair”, envie `POST /api/auth/logout` com `{}`. Após a resposta 204, limpe o estado de autenticação no frontend e navegue ao login.

## Exemplo de consumo

```ts
const response = await fetch('/api/dashboard', { credentials: 'include' });
if (response.status === 401) {
  // Voltar ao login.
} else {
  const dashboard = await response.json();
  // Alimentar os cartões e gráficos com dashboard.counts e os demais campos.
}
```

As respostas de erro usam `{ message }`; validações também podem incluir `errors`. Status principais: 400 (dados inválidos), 401 (sessão inválida), 403 (origem não autorizada), 404 (registro/link indisponível), 409 (conflito de e-mail/edição), 429 (limite de solicitações) e 500 (falha interna). Não tente interpretar corpo em respostas 204.

Configuração de HTTPS, proxy, cookie, disco persistente e múltiplas instâncias: consulte `backend/AUTH.md` no repositório.
