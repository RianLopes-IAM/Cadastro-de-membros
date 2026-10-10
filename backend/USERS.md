# Backend da aba Usuários

CRUD e lista de membros da igreja com pesquisa, filtros, paginação e ordenação. Contas administrativas de login são separadas dos membros. Esta entrega fornece somente o backend; o frontend conecta os botões e formulários aos endpoints abaixo.

## Rotas

| Método e rota | Ação | Resposta |
| --- | --- | --- |
| `GET /api/usuarios` | Listar, pesquisar e filtrar | 200: `{ data, pagination }` |
| `GET /api/usuarios/filtros` | Carregar opções de filtros e ordenação | 200: opções e contagens |
| `GET /api/usuarios/:id` | Consultar um membro | 200: `{ member }` |
| `POST /api/usuarios` | Cadastrar membro | 201: `{ member }` |
| `PATCH /api/usuarios/:id` | Editar campos do membro | 200: `{ member }` |
| `DELETE /api/usuarios/:id` | Remover por arquivamento | 204: sem corpo |
| `POST /api/usuarios/:id/restaurar` | Restaurar arquivado | 200: `{ member }` |

`/api/membros` oferece as mesmas rotas como alias. Todas exigem login administrativo. Use `credentials: 'include'`. Escritas exigem `Content-Type: application/json`; envie `{}` à restauração. Respostas usam `Cache-Control: no-store`.

## Listagem, pesquisa e filtros

```text
GET /api/usuarios?q=jose%20silva&status=active&category=Membro&city=Campinas&state=SP&neighborhood=Centro&hasLocation=true&page=1&pageSize=20&sort=name
```

| Parâmetro | Uso |
| --- | --- |
| `q` | Até 120 caracteres: nome, e-mail, telefone, categoria, cidade ou bairro |
| `status` | `active`, `inactive` ou `pending` |
| `category` | Categoria exata, até 60 caracteres |
| `city` | Cidade exata, até 100 caracteres |
| `state` | UF de duas letras, normalizada para maiúsculas |
| `neighborhood` | Bairro exato, até 100 caracteres |
| `hasLocation` | String `true`: possui ponto; string `false`: sem ponto |
| `page` | A partir de 1; padrão 1 |
| `pageSize` | 1–100; padrão 20 |
| `sort` | `name`, `name_desc`, `newest` ou `oldest`; padrão `name` |

Os filtros podem ser combinados. Omita os parâmetros dos selects sem seleção. Categoria, cidade e bairro usam os valores exatos de `/filtros`, incluindo maiúsculas e acentos.

A pesquisa ignora maiúsculas, acentos e espaços extras. Todas as palavras precisam aparecer nos campos pesquisáveis, em qualquer ordem: `silva jose` encontra `José da Silva`. Palavras podem estar em campos diferentes, como nome e cidade. Telefones aceitam dígitos ou formatação: `(11) 99999-1234` e `11999991234`. `%`, `_` e barras são tratados como texto literal. `q` vazio equivale a não pesquisar.

Ordenação: `name` por nome crescente; `name_desc` por nome decrescente; `newest` por criação mais recente; `oldest` por criação mais antiga. O ID desempata resultados. Parâmetros inválidos, desconhecidos ou repetidos retornam 400.

Resposta da lista:

```json
{
  "data": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```

Cada item de `data` é um membro completo: `id`, `name`, `email`, `phone`, `birthDate`, `joinedAt`, `category`, `status`, `address`, `location`, `geocoding`, `createdAt`, `updatedAt`. `total` conta os resultados filtrados antes da paginação. Páginas além da última retornam `data: []` e preservam a contagem. Sem filtro de status, a lista inclui ativos, inativos e pendentes; arquivados ficam ocultos.

## Opções dos filtros

`GET /api/usuarios/filtros` fornece:

- `status`: array de `{ value, label, count }`, sempre com ativo, inativo e pendente.
- `categories`, `cities`, `states`, `neighborhoods`: cada grupo contém `{ data: [{ value, label, count }], truncated }`.
- `location`: opções `{ value: "true", label: "Com localização" }` e `{ value: "false", label: "Sem localização" }`.
- `sort`: as quatro opções de ordenação, com `value` e `label`.

Valores e contagens vêm dos membros não arquivados e são gerais, independentes da pesquisa atual. Grupos omitem textos vazios e são ordenados por texto. Cada grupo retorna até 200 opções; `truncated=true` indica mais valores. Um valor fora desse recorte ainda pode ser usado diretamente no filtro.

## Cadastrar e editar

Exemplo de `POST /api/usuarios`:

```json
{
  "name": "Maria da Silva",
  "email": "maria@exemplo.com",
  "phone": "(11) 99999-1234",
  "birthDate": "1990-05-10",
  "category": "Membro",
  "status": "active",
  "address": { "postalCode": "01001-000", "number": "100" }
}
```

Somente `name` é obrigatório (2–120 caracteres). Padrões: `category=Membro`, `status=active` e `joinedAt` na data atual da igreja. Contatos opcionais podem ser `null`. E-mail é normalizado para minúsculas e único entre membros não arquivados. Datas devem existir, ser a partir de 1900 e não estar no futuro. Campos desconhecidos, senhas e permissões administrativas são rejeitados.

O backend consulta o CEP, preenche campos vazios e salva coordenadas aproximadas disponíveis. Falhas do provedor não bloqueiam o cadastro; o motivo fica em `geocoding`. O contrato de endereço e precisão está no guia do mapa.

Use o ID da linha em `GET /api/usuarios/:id` para abrir os detalhes. Em `PATCH /api/usuarios/:id`, envie somente as alterações:

```json
{ "name": "Maria da Silva Santos", "phone": "(11) 98888-4321", "category": "Liderança", "status": "active" }
```

Campos omitidos são preservados. `email: null`, `phone: null` e `birthDate: null` limpam o campo. `address: null` limpa endereço e ponto; `location: null` remove explicitamente as coordenadas. Endereço parcial preserva os demais campos, com o tratamento especial de troca de CEP descrito no guia do mapa. PATCH vazio retorna 400. Editar somente nome, contato, categoria ou status preserva a localização.

Ao salvar, pesquisa e opções de filtros refletem os valores atualizados.

O CRUD também recebe foto, sexo, local de nascimento, pais, profissão, estado civil, casamento, cônjuge, filhos, batismo, forma de admissão e saída. Consultas devolvem `age`, `weddingDuration`, idades dos filhos, `photoId`, `photoUrl` e `calculatedAt`, além dos campos existentes. Cálculos e upload administrativo estão detalhados em [REGISTRATION.md](REGISTRATION.md); a idade e a duração são recalculadas pelo servidor a partir das datas.

## Remover e restaurar

`DELETE /api/usuarios/:id` arquiva o membro e retorna 204. Ele sai da lista, das pesquisas, dos filtros, do dashboard e do mapa; os dados permanecem para restauração. Repetir a remoção do mesmo registro também retorna 204. Não leia JSON em resposta 204.

`POST /api/usuarios/:id/restaurar` com `{}` restaura o registro. Se outro membro usar seu e-mail, retorna 409. Membro arquivado ou inexistente retorna 404 na consulta e na edição.

## Integração com o frontend

```ts
const params = new URLSearchParams({ page: '1', pageSize: '20', sort: 'name' });
params.set('q', 'silva jose');
params.set('status', 'active');
const response = await fetch(`/api/usuarios?${params}`, { credentials: 'include' });
if (!response.ok) throw new Error('Não foi possível carregar os membros.');
const { data, pagination } = await response.json();
```

Ao mudar pesquisa, filtro ou ordenação, volte à página 1. Após cadastrar, editar, remover ou restaurar, atualize a lista e `/api/usuarios/filtros`. Use o ID como chave da linha e nos endpoints dos botões. Um atraso curto na pesquisa e cancelamento de chamadas anteriores evitam que uma resposta antiga substitua a busca atual.

Erros usam `{ message }`, com `errors` adicionais em validações: 400 (dados inválidos), 401 (sessão inválida), 403 (origem não permitida), 404 (membro indisponível), 409 (e-mail duplicado ou edição concorrente) e 429 (limite de escritas). Criação, edição e localização individual compartilham o limite existente de 60 chamadas por IP em 15 minutos; leituras da lista e dos filtros ficam independentes.
