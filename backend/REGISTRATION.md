# Aba Link e formulário completo de membros

O backend fornece a aba **Link** no contrato da sidebar, gera a URL pública `/cadastro/:token`, descreve as perguntas do formulário e recebe as respostas. Esta entrega é somente backend: o frontend precisa implementar as páginas `/links` e `/cadastro/:token` e consumir os endpoints abaixo.

## Fluxo da aba Link

1. Consulte `GET /api/painel` com login. O item `key: "links"`, `label: "Link"` aponta para `/links` e informa `endpoint: "/api/links"` e `formEndpoint: "/api/links/formulario"`.
2. Gere um link com `POST /api/links`, corpo `{ "label": "Cadastro de membros", "expiresInDays": 7, "maxUses": 100 }`.
3. Exiba e permita copiar ou abrir a `url` da resposta 201. Ela aponta para `FRONTEND_ORIGIN/cadastro/TOKEN`.
4. Na página pública, consulte `GET /api/cadastro/TOKEN/formulario`: retorna rótulo do link, expiração e `form` com seções, perguntas, tipos, opções, limites e endpoints do formulário.
5. Preencha o CEP pela consulta, atualize os cálculos ao alterar as datas, envie a foto se desejado e envie as respostas por JSON.

Links possuem limite de usos e validade; podem ser revogados com `DELETE /api/links/:id`. A URL é devolvida somente na criação porque o token é armazenado como hash. A lista `GET /api/links` fornece os dados e a situação dos links, sem recuperar o token. Copie a URL quando for gerada; crie outra se precisar de uma nova URL.

## Endpoints

| Método e rota | Uso | Acesso |
| --- | --- | --- |
| `GET /api/links/formulario` | Contrato de todas as perguntas | Administrador |
| `GET /api/cadastro/:token/formulario` | Contrato com endpoints do link atual | Link válido |
| `GET /api/cadastro/:token` | Rótulo e expiração do link | Link válido |
| `GET /api/cadastro/:token/cep/:cep` | Endereço, bairro, cidade e UF pelo CEP | Link válido |
| `POST /api/cadastro/:token/calculos` | Prévia de idade, tempo de casamento e idade dos filhos | Link válido |
| `POST /api/cadastro/:token/foto` | Upload da foto | Link válido |
| `POST /api/cadastro/:token` | Enviar todas as respostas | Link válido |
| `POST /api/usuarios/calculos` | Mesma prévia no cadastro administrativo | Administrador |
| `POST /api/usuarios/foto` | Upload antes de cadastrar ou editar um membro | Administrador |
| `GET /api/usuarios/:id/foto` | Ler foto de um membro | Administrador |

O CRUD de `/api/usuarios` também aceita todos os novos campos; `/api/membros` continua sendo alias. A descrição do formulário contém `frontendPath`, `endpoints`, `defaults`, `timezone`, `asOf` e `sections`. Os campos de `type: "computed"` são somente leitura. O grupo `children` é repetível, com até 50 filhos.

## Perguntas e campos JSON

| Pergunta | Campo |
| --- | --- |
| Foto | `photoId`, recebido no upload |
| Nome | `name` |
| Sexo | `sex` |
| Data de nascimento | `birthDate` |
| Idade automática | `age`, calculado pelo servidor |
| País de nascimento | `birthCountry` |
| Cidade de nascimento | `birthCity` |
| Número de celular | `phone` |
| E-mail | `email` |
| CEP | `address.postalCode` |
| Endereço automático | `address.street` |
| Bairro automático | `address.neighborhood` |
| Cidade automática | `address.city` |
| UF automática | `address.state` |
| Número e complemento do endereço | `address.number`, `address.complement` |
| Nome do pai | `fatherName` |
| Nome da mãe | `motherName` |
| Profissão | `profession` |
| Estado civil | `maritalStatus` |
| Data do casamento | `weddingDate` |
| Tempo de casado automático | `weddingDuration`, calculado pelo servidor |
| Nome do cônjuge | `spouseName` |
| Nome dos filhos | `children[].name` |
| Nascimento dos filhos | `children[].birthDate` |
| Idade automática dos filhos | `children[].age`, calculado pelo servidor |
| Igreja em que foi batizado | `baptismChurch` |
| Data de batismo | `baptismDate` |
| Pastor que fez o batismo | `baptismPastor` |
| Admitido nesta igreja por | `admissionType` |
| Data de entrada | `joinedAt` |
| Data de saída | `leftAt` |

Somente `name` é obrigatório para preservar os cadastros existentes e permitir informações ainda desconhecidas. Os demais campos podem ser omitidos ou, quando opcionais, enviados como `null`. `children` assume `[]`; nome é obrigatório em cada filho adicionado. Datas usam `AAAA-MM-DD`, devem existir, ser a partir de 1900 e não estar no futuro. Nomes de membro/filhos têm 2–120 caracteres; os demais limites estão no contrato do formulário.

Opções de `sex`: `male` (Masculino), `female` (Feminino), `not_informed` (Não informado), ou `null`.

Opções de `maritalStatus`: `single`, `married`, `divorced`, `widowed`, `separated`, `stable_union`, ou `null`. Os rótulos em português vêm no contrato.

Opções de `admissionType`:

- `baptism`: Batismo.
- `transfer_letter`: Carta de transferência.
- `profession_of_faith`: Declaração de Fé.
- `acclamation`: Aclamação.

O backend valida as relações das datas: casamento, batismo e entrada não podem anteceder o nascimento; saída não pode anteceder a entrada; nascimento do filho não pode anteceder o nascimento do membro. A edição valida contra o registro completo, preservando campos omitidos. Para uma saída histórica, informe também a entrada histórica correspondente.

## Enviar as respostas

Exemplo de `POST /api/cadastro/TOKEN`, com `Content-Type: application/json`:

```json
{
  "photoId": null,
  "name": "Maria da Silva",
  "sex": "female",
  "birthDate": "1990-05-10",
  "birthCountry": "Brasil",
  "birthCity": "Campinas",
  "phone": "(11) 99999-1234",
  "email": "maria@exemplo.com",
  "address": { "postalCode": "01001-000", "number": "100", "complement": null },
  "fatherName": "João da Silva",
  "motherName": "Ana da Silva",
  "profession": "Professora",
  "maritalStatus": "married",
  "weddingDate": "2010-09-15",
  "spouseName": "Paulo da Silva",
  "children": [ { "name": "Filha da Silva", "birthDate": "2012-06-20" } ],
  "baptismChurch": "Igreja de origem",
  "baptismDate": "2005-10-01",
  "baptismPastor": "Pastor de origem",
  "admissionType": "transfer_letter",
  "joinedAt": "2020-01-10",
  "leftAt": null
}
```

`joinedAt` aceita a data de entrada informada e assume a data atual da igreja se omitido. O servidor mantém `status=pending` e `category=Membro`. Não envie `status`, `category`, `role`, senha, `age`, `children[].age` ou `weddingDuration`: privilégios e valores calculados não são aceitos pelo formulário público.

Resposta 202: `{ "message": "Cadastro enviado. Aguarde a confirmação da igreja." }`. Nenhuma resposta ou foto de membros existentes é exposta publicamente. O administrador consulta e aprova pelo CRUD de usuários. Informar `leftAt` registra a data histórica; não arquiva o membro nem muda automaticamente sua aprovação.

## Cálculos durante o preenchimento

Ao mudar a data de nascimento, casamento ou filhos, envie a `POST /api/cadastro/TOKEN/calculos`:

```json
{
  "birthDate": "1990-05-10",
  "weddingDate": "2010-09-15",
  "children": [ { "name": "Filha da Silva", "birthDate": "2012-06-20" } ]
}
```

A resposta contém `asOf`, `timezone`, `age`, `weddingDuration: { years, months, totalMonths }` e `children` com nome, nascimento e idade. Datas ausentes resultam em cálculos `null`. A prévia não grava membros e não consome usos do link.

Os mesmos valores são recalculados nas consultas e listas administrativas; não ficam armazenados como números que envelhecem. `calculatedAt` informa a data usada no membro. O cálculo usa `CHURCH_TIMEZONE`, anos completos e meses civis completos desde a data de casamento. Em meses curtos, o aniversário de uma data inexistente ocorre no último dia do mês; por exemplo, 29/02 usa 28/02 em anos não bissextos.

## Foto

Envie JPEG, PNG ou WebP estático de até **5 MB** e **20 megapixels**. O corpo é o próprio arquivo binário, com `Content-Type` correspondente; não use JSON, Base64 ou `multipart/form-data`.

```ts
const response = await fetch(`/api/cadastro/${token}/foto`, {
  method: 'POST',
  headers: { 'Content-Type': file.type },
  body: file,
});
if (!response.ok) throw new Error('Não foi possível enviar a foto.');
const { photoId } = await response.json();
// Enviar photoId junto às respostas do formulário.
```

A resposta 201 contém `photoId`, `contentType`, `width`, `height`, `byteLength` e `expiresAt`. O backend valida e decodifica a imagem, corrige a orientação, limita-a a 1024×1024 preservando proporções, remove metadados e salva WebP no SQLite. As fotos acompanham o banco nas cópias de segurança.

A foto precisa ser vinculada ao cadastro em até 24 horas ou antes da expiração do link. Pertence ao link que a enviou e não pode ser usada por outro link ou por dois membros. No upload administrativo, pertence ao administrador até ser associada. Fotos pendentes expiradas são limpas no próximo upload; fotos já vinculadas permanecem disponíveis para os administradores. As imagens não possuem URL pública.

O membro retorna `photoId` e `photoUrl: "/api/usuarios/ID/foto"`. Para remover a foto, envie `PATCH /api/usuarios/:id` com `{ "photoId": null }`. Para substituir, envie outra foto pelo endpoint administrativo e atualize o `photoId`. Use `credentials: 'include'` nas operações administrativas. O frontend pode usar o proxy `/api` existente; em origens separadas, pode buscar a foto com credenciais e exibi-la como Blob.

## Limites e compatibilidade

- Formulário e cálculos: limite compartilhado de 120 chamadas por IP em 15 minutos.
- Upload: 20 por IP por hora; até 10 fotos pendentes por link ou 100 por administrador.
- Envio do cadastro: permanece limitado a 10 por IP por hora.
- JSON de membros, formulários e cálculos: até 32 KB. Autenticação mantém seu limite de 8 KB.
- Os demais limites de CEP, CRUD e links continuam vigentes.
- Tokens revogados, expirados ou esgotados não acessam perguntas, cálculos, CEP ou upload. O token é verificado novamente após chamadas externas e processamento de foto.
- Migração automática acrescenta os novos campos e a tabela de fotos sem apagar dados antigos.

Depois de atualizar o código, execute `npm install` para instalar a biblioteca de processamento de fotos e `npm run build -w backend` para compilar. O servidor continua usando a mesma configuração de autenticação e SQLite. Não houve mudança nas telas do frontend.
