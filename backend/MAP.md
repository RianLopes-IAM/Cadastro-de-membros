# Backend do mapa e consulta de CEP

O backend consulta o CEP ao cadastrar um membro ou alterar seu endereço, preenche os campos vazios e salva um ponto quando o provedor entrega coordenadas válidas. Não é preciso chave de API. O frontend escolhe a biblioteca do mapa e desenha os pontos do GeoJSON.

## Precisão dos pontos

A BrasilAPI v2 fornece endereço e coordenadas aproximadas. O provedor pode localizar o logradouro, a região do CEP ou a cidade. **Essas coordenadas não comprovam a posição da casa e não consideram o número.** A resposta sempre marca `precision: "approximate"`. Membros com o mesmo CEP podem ter pontos sobrepostos; cada ponto mantém o ID próprio do membro.

Para uma posição informada pelo administrador ou escolhida no mapa, envie `location: { latitude, longitude }`. Essas coordenadas são preservadas e recebem `source: "manual"`, `precision: "manual"`; essa marca significa apenas que foram fornecidas, sem garantia automática de precisão. Não há geocodificação da casa pelo número nesta entrega.

Se a BrasilAPI falhar, o backend tenta o ViaCEP para preencher o endereço. O ViaCEP não fornece coordenadas. Se nenhum ponto válido estiver disponível, o cadastro continua sendo salvo, com `location: null` e o motivo em `geocoding`. Não são inventados pontos nem usados valores zero como substitutos.

## Endpoints

| Método e rota | Uso |
| --- | --- |
| `GET /api/cep/:cep` | Consultar CEP e preencher o formulário; exige login |
| `POST /api/usuarios` | Cadastrar membro e localizar automaticamente pelo CEP |
| `PATCH /api/usuarios/:id` | Atualizar endereço e recalcular localização quando necessário |
| `GET /api/mapa` | Pontos GeoJSON de todos os membros não arquivados |
| `GET /api/mapa/pendentes` | Lista paginada de membros sem ponto, com o motivo |
| `POST /api/usuarios/:id/localizar` | Tentar localizar um membro já cadastrado, sem coordenadas |
| `POST /api/mapa/localizar` | Tentar localizar até 20 IDs por chamada |
| `GET /api/cadastro/:token/cep/:cep` | Consulta pública de CEP somente com link de cadastro válido |
| `POST /api/cadastro/:token` | Cadastro público também recebe localização automática pelo CEP |

`/api/membros` é alias de `/api/usuarios`. As rotas administrativas exigem o cookie de sessão existente. Use `credentials: 'include'`. Escritas exigem `Content-Type: application/json`, inclusive quando o corpo é `{}`. As respostas administrativas de mapa e CEP usam `Cache-Control: no-store`.

## Consultar CEP

Aceita `01001000` ou `01001-000`, sempre normalizados para oito dígitos na resposta:

```json
{
  "postalCode": "01001000",
  "address": {
    "postalCode": "01001000",
    "street": "Praça da Sé",
    "neighborhood": "Sé",
    "city": "São Paulo",
    "state": "SP"
  },
  "location": { "latitude": -23.5475, "longitude": -46.63611 },
  "source": "brasilapi",
  "precision": "approximate"
}
```

O exemplo é ilustrativo e a resposta pode variar com o provedor. A consulta não retorna número ou complemento; esses campos são preenchidos pela pessoa.

Erros: 400 para formato inválido; 404 para CEP inexistente; 503 para indisponibilidade dos provedores. Respostas usam `{ "message": "..." }`. Um CEP com endereço válido, mas sem coordenadas, retorna 200 com `location: null`.

## Cadastrar e editar membro

Exemplo de `POST /api/usuarios`:

```json
{
  "name": "Maria da Silva",
  "address": {
    "postalCode": "01001-000",
    "number": "100",
    "complement": "Apartamento 2"
  }
}
```

Não é necessário enviar latitude ou longitude. O backend preenche rua, bairro, cidade e UF que estiverem vazios. Valores informados são preservados. Se eles divergirem do endereço do CEP, o backend evita atribuir aquele ponto automaticamente e retorna `address_conflict`; corrija o CEP/endereço ou informe coordenadas manualmente.

Ao alterar o CEP, campos antigos de rua, bairro, cidade e UF omitidos no PATCH são limpos e preenchidos com o novo CEP. Número e complemento permanecem, salvo alteração explícita. Alterar o endereço invalida as coordenadas anteriores, inclusive as manuais, e tenta localizar novamente; envie novas coordenadas no mesmo PATCH para preservar uma posição escolhida para o novo endereço.

Um PATCH que muda somente nome, categoria ou status preserva endereço e ponto. `address: null` limpa o endereço e remove o ponto anterior. `location: null` remove explicitamente as coordenadas sem consulta automática nessa edição. O endpoint `/localizar` pode tentar recuperá-las depois.

Uma edição concorrente durante a consulta externa retorna 409, evitando sobrescrever dados mais recentes. Falhas de consulta de CEP não impedem o cadastro: o membro fica com o motivo de localização pendente.

Cada membro inclui:

```json
{
  "location": { "latitude": -23.5475, "longitude": -46.63611 },
  "geocoding": {
    "status": "located",
    "source": "brasilapi",
    "precision": "approximate",
    "checkedAt": "2026-10-09T00:00:00.000Z"
  }
}
```

| `geocoding.status` | Significado |
| --- | --- |
| `located` | Possui coordenadas válidas |
| `missing_postal_code` | Não tem CEP nem coordenadas informadas |
| `not_requested` | Cadastro antigo ainda não consultado ou coordenadas removidas explicitamente |
| `not_found` | CEP não encontrado |
| `unavailable` | Provedores indisponíveis ou fila de consulta cheia |
| `coordinates_unavailable` | Endereço encontrado, mas sem coordenadas válidas |
| `address_conflict` | Endereço informado diverge do endereço do CEP |

`source`: `brasilapi`, `viacep`, `manual` ou `null`. `precision`: `approximate`, `manual` ou `null`. `checkedAt` é uma data ISO em UTC ou `null` quando ainda não houve tentativa. Metadados são gerados pelo servidor; não envie `geocoding` no cadastro.

## Carregar todos os pontos

```text
GET /api/mapa?limit=500&page=1
```

Sem filtro de status, inclui ativos, inativos e pendentes. Membros arquivados ficam ocultos. Suporta `q`, `status`, `category`, `city`, `state`, `neighborhood`, `hasLocation` e `bounds=longitudeMin,latitudeMin,longitudeMax,latitudeMax`. `limit`: 1–1000, padrão 500; `page`: padrão 1. Pesquisa e filtros usam o mesmo comportamento da lista de usuários, documentado em [USERS.md](USERS.md).

Resposta GeoJSON `FeatureCollection`; cada feature contém `id`, `geometry.type: "Point"`, `geometry.coordinates: [longitude, latitude]` e `properties` com `id`, `name`, `category`, `status`, `address`, `city`, `neighborhood`, `geocoding`. A ordem GeoJSON é longitude primeiro.

`meta` informa `total`, `located`, `withoutLocation`, `withinBounds`, `returned`, `truncated`, `page`, `totalPages`, `nextPage`. As três primeiras contagens são anteriores ao recorte por bounds. `truncated` informa que há mais de uma página; siga `nextPage` até `null` para carregar todos os pontos. Use o ID do membro como chave; não remova pontos só porque têm coordenadas iguais.

```ts
async function carregarMapa() {
  const features = new Map();
  let page: number | null = 1;
  while (page !== null) {
    const response = await fetch(`/api/mapa?limit=500&page=${page}`, { credentials: 'include' });
    if (!response.ok) throw new Error('Não foi possível carregar o mapa.');
    const result = await response.json();
    for (const feature of result.features) features.set(feature.id, feature);
    page = result.meta.nextPage;
  }
  return { type: 'FeatureCollection', features: [...features.values()] };
}
```

## Localizar membros antigos

`GET /api/mapa/pendentes?page=1&pageSize=20` aceita os filtros da lista de membros e retorna `{ data, pagination }`. Cada membro inclui endereço e `geocoding`. Corrija primeiro cadastros sem CEP ou com endereço conflitante.

Depois envie a `POST /api/mapa/localizar`:

```json
{ "ids": ["UUID-DO-MEMBRO-1", "UUID-DO-MEMBRO-2"] }
```

IDs precisam ser UUIDs, únicos, em lotes de 1–20. O backend consulta sequencialmente e responde `{ data, processed, located }`. Cada item contém `id`, `location`, `geocoding`, ou `id` e `error: { status, message }` se o membro não existir ou mudar durante a consulta. Falhas de um membro não cancelam os demais. Coordenadas já presentes são preservadas.

Para um único membro, envie `{}` a `POST /api/usuarios/:id/localizar`; a resposta é `{ member }`. Essas tentativas usam o cache e não forçam nova consulta quando ele ainda é válido. Carregar `GET /api/mapa` nunca dispara chamadas externas.

## Cadastro público

Use `GET /api/cadastro/TOKEN/cep/01001000` para preencher o formulário público. O link precisa estar ativo, não expirado e com usos disponíveis. Tokens inválidos recebem a mesma mensagem 404 do cadastro. Nenhuma lista de membros ou localização individual é exposta nessa rota.

O POST do cadastro público faz a mesma consulta automática e mantém a resposta genérica 202 sem devolver informações do membro. A consulta externa termina antes da transação de gravação; o link é validado novamente para impedir uso após revogação, expiração ou esgotamento durante a espera.

## Cache, limites e configuração

- Timeout por provedor: `POSTAL_TIMEOUT_MS=5000` por padrão, configurável entre 500 e 10000 ms no `.env` do backend. Um fallback pode usar dois timeouts, além da espera na fila.
- Cache persistente no SQLite: 7 dias para CEP com coordenadas; 1 hora para endereço sem coordenadas; 10 minutos para CEP inexistente; 30 segundos para indisponibilidade.
- Consultas concorrentes do mesmo CEP compartilham uma chamada. Requisições externas são sequenciais e espaçadas por pelo menos 250 ms; a fila aceita até 20 CEPs diferentes.
- Consulta de CEP: 60 solicitações em 15 minutos por IP. Criação, edição e localização individual compartilham outro limite de 60 por IP em 15 minutos. Leitura de membros permanece independente.
- Lotes de localização: 5 chamadas em 15 minutos por IP. Os limites de envio do cadastro público existente continuam valendo. Os contadores de requisição são locais ao processo.
- Apenas o CEP é enviado aos provedores; nome, e-mail, telefone, número e complemento permanecem no backend.
- Migração automática acrescenta metadados de localização sem apagar os cadastros ou as coordenadas existentes.

As APIs externas não garantem endereço ou coordenadas para todo CEP. Registros sem localização continuam visíveis na lista de pendências, para correção ou posicionamento manual.

Fontes dos provedores: [BrasilAPI](https://brasilapi.com.br/docs), [implementação oficial do CEP v2](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/api/cep/v2/%5Bcep%5D.js), [origem das coordenadas aproximadas](https://github.com/BrasilAPI/BrasilAPI/blob/main/lib/fetchGeocoordinateFromBrazilLocation.js), [ViaCEP](https://viacep.com.br/).
