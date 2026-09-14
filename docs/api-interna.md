# A API interna do bot

O bot expõe uma API HTTP (Hono). É por ela que o painel e o CLI de guild fazem
tudo — o painel **não** fala com o Discord diretamente. Este guia é para quem
quer falar com ela direto, ou adicionar uma rota nova.

Base: `http://localhost:3001` em dev, `https://bot.<dominio>` em produção.

## 1. Autenticação

Toda rota exige `Authorization: Bearer <INTERNAL_API_TOKEN>`. A única exceção é
`/health`.

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  http://localhost:3001/guilds/$GUILD_ID/roles
```

A comparação do token é em tempo constante (SHA-256 + `timingSafeEqual`), e a
resposta a token ausente e token errado é **a mesma** — nada diz a um scanner o
que ele acertou.

Passar de 50 respostas 401 numa hora dispara alerta operacional: isso já é
sondagem, não dedo gordo.

## 2. `actorId`: quem pediu

O Bearer prova que a chamada veio de um cliente autorizado. Ele **não** diz
quem clicou. Por isso toda escrita carrega `actorId` no corpo — o ID Discord da
pessoa responsável.

```bash
curl -X POST http://localhost:3001/guilds/$GUILD_ID/roles \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "actorId": "123456789012345678",
    "name": "Moderador",
    "color": 3447003,
    "hoist": true,
    "mentionable": false,
    "permissions": ["KickMembers", "BanMembers"],
    "reason": "criado pelo curl"
  }'
```

Com esse ID o bot resolve três coisas:

1. **Nível** — `requireActor(deps, guild, id, 'admin')`. Sem o nível, 403.
2. **Hierarquia** — `assertRoleManageable`. Ninguém edita cargo acima do seu,
   nem acima do cargo do bot.
3. **Concessão** — `assertMayGrant`. Ninguém concede permissão que ele próprio
   não tem. O dono da guild é a única exceção, porque já tem tudo.

O `reason` vai para o registro de auditoria do Discord.

## 3. Use o cliente tipado, não `fetch`

Já existe um cliente com ~45 métodos, cada um validando a resposta com o schema
Zod correspondente:

```ts
import { createInternalClient } from '@goodbot/shared';

const api = createInternalClient({
  baseUrl: 'http://localhost:3001',
  token: process.env.INTERNAL_API_TOKEN!,
  timeoutMs: 30_000, // o padrão é 10s
});

// Sem contagem de membros por cargo, que é o que quase todo chamador quer.
const roles = await api.roles(guildId);
// Com contagem: custa uma varredura por REST no Discord, e o discord.js
// serializa essa rota, então peça só onde a contagem aparece na tela.
const comContagem = await api.roles(guildId, { counts: true });
const canal = await api.createChannel(guildId, {
  actorId,
  name: 'geral',
  type: 0,
  parentId: null,
  topic: null,
  nsfw: false,
  slowmodeSeconds: 0,
});
```

Erros vêm como `InternalApiError`, com `status`, `code`, `issues` (as falhas de
validação Zod) e `retryAfter` quando o 503 veio de rate limit.

## 4. Rotas

| Grupo         | O que dá                                                         |
| ------------- | ---------------------------------------------------------------- |
| `guild`       | perfil, settings, ícone, banner, audit log                       |
| `bot-profile` | apelido, foto, capa e bio do bot **neste** servidor              |
| `channels`    | listar, criar, editar, apagar, lock/unlock, slowmode, overrides  |
| `roles`       | listar (`?counts=1` conta membros), criar, editar, apagar, mover |
| `members`     | listar, detalhe, cargos de um membro                             |
| `messages`    | enviar, histórico, apagar, publicar/despublicar painel           |
| `moderation`  | ban, unban, listar bans, ações de moderação                      |
| `cases`       | listar, editar e apagar caso                                     |
| `invites`     | listar, criar, revogar                                           |
| `events`      | eventos agendados: listar, criar, editar, apagar                 |
| `expressions` | emojis e stickers: criar, editar, apagar                         |
| `automod`     | estado e ativação do modo anti-raid                              |
| `config`      | invalidar o cache de config de um módulo                         |
| `commands`    | listar os comandos registrados                                   |
| `social`      | contas de rede social e teste de anúncio                         |
| `squads`      | retrato do módulo, mensagem fixa, match, arquivar e renomear     |
| `admin`       | painel do dono: guilds, expulsar, broadcast, manutenção, resync  |
| `registry`    | o aviso por DM a quem convidou o bot (ciclo de vida do convite)  |
| `metrics`     | contadores em formato Prometheus                                 |
| `health`      | **sem auth** — estado do gateway, banco e último backup          |

Os schemas de request e response de cada uma estão em
`packages/shared/src/api/`.

### 4.1 `/admin` e `/registry` são as exceções que confirmam a regra

Todo o resto da API vive sob `/guilds/:guildId` e é autorizado pelo **nível do
`actorId` naquele servidor**. Estas duas não podem ser: elas existem justamente
para tratar as guilds que o bot **não** atende — a fila de aprovação e os
avisos de recusa —, e um middleware que exigisse guild atendida esconderia
exatamente o que elas precisam ver.

O que muda é só contra o que o `actorId` é conferido — `OWNER_DISCORD_ID`, a
variável, em vez da hierarquia de cargos de uma guild:

```bash
curl -X POST http://localhost:3001/admin/maintenance \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"actorId": "'"$OWNER_DISCORD_ID"'", "enabled": true, "message": "volto já"}'
```

Sem `OWNER_DISCORD_ID` no ambiente do bot **toda escrita em `/admin` responde
403** (`OWNER_NOT_CONFIGURED`). Fechado por ausência é a única leitura possível
de uma variável faltando: o contrário transformaria um `.env` incompleto em
painel admin aberto para qualquer `actorId` que chegasse com o Bearer certo.

### 4.2 `/registry` não tem `actorId`, e é de propósito

`POST /registry/:guildId/notice` é o que faz o bot mandar a DM de ciclo de vida
do convite (entrou em demo, demo acabando, entrou na fila, aprovado, recusado).
Ela não carrega `actorId` porque **não existe ator**: quem convidou já foi
provado pela troca do `code` no OAuth, e nada na chamada escolhe quem recebe —
o destinatário é o `invited_by` da linha do registro. O corpo só escolhe qual
texto de uma lista fechada sai, e o texto mora no bot
(`apps/bot/src/lib/inviter-dm.ts`).

```bash
curl -X POST http://localhost:3001/registry/$GUILD_ID/notice \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind": "queued"}'
```

Ela existe como rota porque o bot **não sabe por qual link a pessoa veio**: o
Discord adiciona o bot no clique em "Autorizar", então o `guildCreate` chega
antes de o painel trocar o `code`. Quem sabe o fluxo é o painel.

A resposta diz se a DM chegou (`delivered`) — `false` é resultado normal, DM
fechada é comum — e para quem ela foi (`userId`, nulo nas linhas semeadas pelo
`GUILD_IDS`).

### 4.3 Broadcast

O `POST /admin/broadcast` pede ainda um `confirm: "ENVIAR"` no corpo. A palavra
é digitada na tela, mas a conferência é aqui: uma trava que só existe no
navegador protege contra o clique errado, não contra a chamada solta — e é o
único endpoint do projeto que escreve em servidores de terceiros. Antes de
enviar, `dryRun: true` devolve em que canal a mensagem cairia em cada servidor,
sem mandar nada.

## 5. Rate limit

| Quem                     | Por IP  | Por rota |
| ------------------------ | ------- | -------- |
| com `INTERNAL_API_TOKEN` | 600/min | 600/min  |
| sem token                | 60/min  | 100/min  |

Mandar mensagem tem teto próprio: **10/min por guild**. É o endpoint mais fácil
de abusar, e ninguém escreve dez mensagens à mão por minuto.

Estourar devolve 503 com `retryAfter` em segundos.

O teto alto para quem tem o token é deliberado: quem tem o token já pode fazer
tudo que a API oferece, e racioná-lo não protege de nada — a defesa contra
vazamento é rotacionar, não racionar. O balde apertado existe contra scanner
anônimo.

## 6. Limites de corpo

256 KB por padrão. As rotas que carregam imagem (ícone e banner da guild, foto
e capa do bot na guild, capa de evento, emoji, sticker) aceitam 12 MB, porque
uma imagem de 8 MB — o limite do Discord — vira ~11 MB depois da base64.

## 7. Adicionar uma rota

Três coisas são obrigatórias, sem exceção:

1. **Schema Zod em `packages/shared/src/api/`** para o corpo e para a resposta,
   exportado pelo barrel `api/index.ts`.
2. **A rota em `apps/bot/src/api/routes/`**, montada no `server.ts`, usando
   `validate('json', SeuSchema)` e `requireActor(...)` se escreve.
3. **O método no cliente** (`packages/shared/src/api/client.ts`), para o painel
   e o CLI não montarem `fetch` na mão.

Checklist antes de considerar pronta:

- [ ] passa por `bearerAuth` (só `/health` não passa)
- [ ] valida o corpo com Zod
- [ ] se escreve, exige `actorId` e checa nível + hierarquia
- [ ] entra no rate limit
- [ ] tem método no cliente tipado
- [ ] tem teste

## 8. Health

```bash
curl -s http://localhost:3001/health
```

Responde sem autenticação — é o que o Caddy, o Docker e o monitor externo usam.
Traz o estado do gateway, do Postgres e a data do último backup. Não traz nada
que sirva a um atacante.
