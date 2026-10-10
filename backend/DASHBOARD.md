# Backend do dashboard

`GET /api/dashboard` fornece os indicadores para a aba Dashboard. Exige login administrativo e usa o cookie `church_session`. A resposta usa `Cache-Control: no-store`.

## Indicadores

| Indicador | Campo | Regra |
| --- | --- | --- |
| Membros cadastrados | `counts.total` | Todos os membros não arquivados |
| Missionários | `counts.missionaries` | Categoria Missionário, Missionária, Missionários ou Missionárias |
| Batizados | `counts.baptized` | Data de batismo até hoje ou admissão por Batismo (`admissionType: "baptism"`) |

As categorias de missionários ignoram maiúsculas, acentos e espaços nas extremidades. Informe `category: "Missionário"` ou `category: "Missionária"` no CRUD; nome e profissão não definem essa categoria. O formulário público cria a categoria padrão Membro, que o administrador pode alterar na aprovação.

Para batizados, basta `baptismDate` preenchida com uma data válida até hoje, ou `admissionType: "baptism"`. Ter apenas igreja ou pastor do batismo preenchidos não conta. Um membro com data e admissão por Batismo conta uma única vez. A data de referência considera `CHURCH_TIMEZONE`, por padrão `America/Sao_Paulo`.

Os três indicadores incluem ativos, inativos e pendentes e excluem arquivados. Contas administrativas não entram na contagem. Missionários e batizados são subconjuntos dos membros e podem se sobrepor; não some os cartões para obter o total.

Cada consulta reflete os cadastros atuais: criação, edição, arquivamento e restauração alteram as contagens. Sem cadastros, os valores são zero. Os números 50, 19 e 30 abaixo são um exemplo de resposta, sem criar dados no banco.

## Resposta para os cartões

Trecho da resposta quando os cadastros correspondem ao exemplo:

```json
{
  "counts": {
    "total": 50,
    "missionaries": 19,
    "baptized": 30
  },
  "cards": [
    { "key": "members", "label": "Membros cadastrados", "value": 50 },
    { "key": "missionaries", "label": "Missionários", "value": 19 },
    { "key": "baptized", "label": "Batizados", "value": 30 }
  ]
}
```

O frontend pode renderizar o array `cards` diretamente ou usar os campos de `counts`. Exemplo de consulta:

```ts
const response = await fetch('/api/dashboard', { credentials: 'include' });
if (!response.ok) throw new Error('Não foi possível carregar as estatísticas.');
const dashboard = await response.json();
// dashboard.cards contém key, label e value de cada cartão.
```

`GET /api/painel` também informa `endpoint: "/api/dashboard"` no item Dashboard da navegação.

Os campos existentes continuam disponíveis: `asOf`, `timezone`, demais contagens de `counts`, `byCategory`, `byCity`, `membershipByMonth`, `birthdays` e `latestMembers`. `birthdayDays` é opcional, vai de 0 a 90 e assume 30. Os demais parâmetros são rejeitados. O contrato geral está em [PANEL.md](PANEL.md).

## Verificação

Na raiz do repositório, execute `npm run build -w backend` e `npm test -w backend`. Os testes verificam 50 membros/19 missionários/30 batizados em banco temporário, variações de categoria, cadastros antigos, contagem sem duplicações, fuso horário, edição, arquivamento, restauração e autenticação.
