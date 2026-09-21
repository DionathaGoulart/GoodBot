# Documentação do Goodbot

## Comece por aqui

| Se você quer...                     | Leia                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| rodar o projeto pela primeira vez   | [primeiros-passos.md](primeiros-passos.md)                   |
| entender como o código é organizado | [`../.harness/architecture.md`](../.harness/architecture.md) |
| saber o que o produto faz e por quê | [`../.harness/prd.md`](../.harness/prd.md)                   |
| escrever código no projeto          | [`../CONTRIBUTING.md`](../CONTRIBUTING.md)                   |

## Guias

| Guia                                         | Assunto                                            |
| -------------------------------------------- | -------------------------------------------------- |
| [primeiros-passos.md](primeiros-passos.md)   | do zero ao bot respondendo na sua máquina          |
| [modulos.md](modulos.md)                     | o que cada módulo faz e como configurar            |
| [guild-como-codigo.md](guild-como-codigo.md) | configurar um servidor por arquivo, não por clique |
| [api-interna.md](api-interna.md)             | falar com a API do bot; adicionar rota             |
| [banco-de-dados.md](banco-de-dados.md)       | schema, migrations, repositories, backup           |
| [deploy.md](deploy.md)                       | hospedar em produção: provedores, segredos, deploy |
| [runbook.md](runbook.md)                     | operação: incidentes, rollback, plantão            |

## Fora daqui

- [`../.harness/architecture.md`](../.harness/architecture.md): o mapa do
  código, camadas, fluxos de ponta a ponta, invariantes, onde mexer.
- [`../.harness/prd.md`](../.harness/prd.md): requisitos, modelo de dados,
  permissões, decisões arquiteturais.
- [`../.harness/styleguide.md`](../.harness/styleguide.md): guia visual do
  painel.
- [`../CLAUDE.md`](../CLAUDE.md): convenções para agentes.

## Um mapa mental rápido

```
   painel (Vercel) ──HTTPS+Bearer──▶ API do bot ──▶ Discord
   CLI de guild ────────────────────▶     │
                                          ▼
                                     Postgres
```

O painel **não** fala com o Discord. Ele fala com a API do bot, que é o único
processo com sessão de gateway aberta. O CLI de guild usa a mesma API, e por
isso herda as mesmas checagens de permissão, hierarquia e rate limit.
