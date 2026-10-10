# Backend do perfil

A aba Perfil permite consultar e editar a conta administrativa autenticada. O e-mail é usado no login. As rotas usam o cookie `church_session`, exigem sessão válida e retornam `Cache-Control: no-store`.

| Método e rota | Uso |
| --- | --- |
| `GET /api/perfil` | Consultar nome, e-mail e identificação da conta atual |
| `PATCH /api/perfil` | Editar nome, e-mail, senha ou os três juntos |
| `POST /api/perfil/senha` | Trocar apenas a senha, compatível com a rota existente |

`GET /api/painel` informa `endpoint: "/api/perfil"` e `passwordEndpoint: "/api/perfil/senha"` no item Perfil da sidebar.

## Consultar

`GET /api/perfil` retorna:

```json
{
  "user": {
    "id": "uuid-do-administrador",
    "name": "Administrador",
    "email": "admin@exemplo.com",
    "role": "admin"
  }
}
```

A API nunca devolve senha ou hash. O alvo é sempre a conta autenticada; não envie `id`, `role` ou campos de membros.

## Editar e-mail e senha

Exemplo de corpo de `PATCH /api/perfil`:

```json
{
  "email": "novo@exemplo.com",
  "currentPassword": "senha-atual-da-conta",
  "newPassword": "nova-senha-com-12-ou-mais-caracteres"
}
```

Pode incluir `name`. Envie somente os campos que deseja alterar. Para alterar só o e-mail, omita `newPassword`; para alterar só a senha, omita `email`. Para alterar apenas nome, envie `{ "name": "Nome atualizado" }`, sem precisar de senha atual.

E-mail deve ser válido e único entre as contas administrativas; espaços nas extremidades são removidos e letras são convertidas para minúsculas. Alterar o e-mail exige a senha atual correta. Uma troca apenas de maiúsculas ou espaços do mesmo e-mail não é uma alteração de credencial.

A nova senha deve ter 12–128 caracteres e ser diferente da atual. Ela exige `currentPassword` e é armazenada com hash scrypt e salt aleatório. Senhas não recebem trim nem conversão de letras. Quando não quiser trocar a senha, omita `newPassword` em vez de enviar uma string vazia.

Resposta 200 de `PATCH /api/perfil`:

```json
{
  "user": { "id": "uuid-do-administrador", "name": "Administrador", "email": "novo@exemplo.com", "role": "admin" },
  "requiresLogin": true
}
```

`requiresLogin` é `true` quando a senha foi alterada: todas as sessões são revogadas e o cookie atual é limpo. O frontend deve limpar seu estado de autenticação e voltar ao login; entre com o e-mail e a senha novos. Quando apenas nome ou e-mail mudam, `requiresLogin` é `false`. Alterar o e-mail revoga as outras sessões e preserva a atual; atualize o estado do frontend com `user` da resposta.

O salvamento de nome, e-mail, senha e revogação de sessões ocorre na mesma transação. E-mail duplicado, senha atual incorreta ou conflito com outra edição impedem toda a alteração. Se a sessão expirar ou for revogada durante a operação, a solicitação é rejeitada.

`POST /api/perfil/senha` aceita `{ "currentPassword": "...", "newPassword": "..." }` e retorna 200 com `{ "message": "Senha alterada. Entre novamente com sua nova senha.", "requiresLogin": true }`. Também revoga todas as sessões e limpa o cookie.

## Integração e erros

Use `credentials: 'include'`. Escritas exigem `Content-Type: application/json` e uma origem permitida em `FRONTEND_ORIGIN`.

```ts
const response = await fetch('/api/perfil', {
  method: 'PATCH',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, currentPassword, newPassword }),
});
const result = await response.json();
// Verifique response.ok antes de usar result.user ou result.requiresLogin.
```

| Status | Significado |
| --- | --- |
| 400 | Dados inválidos, senha atual incorreta ou nova senha igual à atual |
| 401 | Sessão ausente, expirada ou revogada |
| 403 | Origem da escrita não autorizada |
| 409 | E-mail de outra conta ou conflito com edição concorrente |
| 429 | Limite de alterações atingido; respeite `Retry-After` |

Erros retornam `{ "message": "..." }` e, quando disponível, `errors` por campo (`email`, `currentPassword`, `newPassword`). Não envie campos extras. As duas rotas de escrita compartilham um limite de 10 solicitações por administrador a cada 15 minutos, incluindo tentativas inválidas. Consultar o perfil continua disponível. O limitador é local ao processo.

Para executar e configurar a API, consulte [PANEL.md](PANEL.md) e [AUTH.md](AUTH.md). A implementação desta etapa é somente backend.
