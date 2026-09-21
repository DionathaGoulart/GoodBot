# Banco de dados

Postgres com Drizzle (16 em dev e na CI, 17 no Supabase de produção). Tudo que toca o banco vive em `packages/db` — nenhum
outro pacote escreve SQL.

## 1. Layout

```
packages/db/
  src/
    client.ts       createDb(url)
    migrate.ts      aplica as migrations
    env.ts          Zod sobre a DATABASE_URL
    schema/         a definição das tabelas (15 arquivos)
    repositories/   uma função por consulta (18 arquivos)
  drizzle/          as migrations SQL, versionadas
```

`schema/` descreve as tabelas. `repositories/` é a única porta de entrada:
comandos, eventos e rotas chamam uma função de repository, nunca montam query.

## 2. As tabelas

34 no total.

| Grupo         | Tabelas                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor      | `guilds`, `guild_registry`, `guild_settings`, `module_configs`, `meta`                                                                   |
| Moderação     | `cases`, `scheduled_actions`, `channel_locks`                                                                                            |
| Automod       | `automod_rules`, `automod_hits`                                                                                                          |
| Logs          | `log_configs`, `audit_logs`, `message_cache`                                                                                             |
| Comunidade    | `welcome_configs`, `autorole_configs`, `reaction_role_panels`, `reaction_role_items`, `tickets`, `ticket_types`, `ticket_panels`, `tags` |
| Utilidades    | `polls`, `reminders`                                                                                                                     |
| Estatísticas  | `stat_buckets`                                                                                                                           |
| Redes sociais | `social_accounts`, `social_posts`                                                                                                        |
| Squads        | `squad_games`, `squad_profiles`, `squads`, `squad_members`, `squad_proposals`, `squad_join_requests`, `squad_sessions`, `squad_session_attendance` |

Duas convenções que valem em todas:

- **`guildId` é `string`** e entra em **todo** filtro. Snowflake nunca vira
  `Number` — a precisão se perde em silêncio.
- **Config de módulo é `jsonb`** em `module_configs`, validado pelo schema Zod
  correspondente em `packages/shared/src/config/`. O banco guarda; o Zod é quem
  garante a forma.

## 3. Mudar o schema

```bash
# 1. edite packages/db/src/schema/*.ts

# 2. gere o SQL
pnpm --filter @goodbot/db db:generate

# 3. LEIA o SQL gerado em packages/db/drizzle/
#    O Drizzle às vezes propõe drop + create onde um ALTER bastava.

# 4. aplique
pnpm --filter @goodbot/db db:migrate
```

Regras que não se dobram:

- **Migration já aplicada nunca é editada.** Se está errada, a correção é uma
  migration nova.
- **`db:push` não é usado fora de dev.** Ele altera o banco sem deixar rastro
  em `drizzle/`, e aí o próximo `db:generate` gera um diff mentiroso.
- **Coluna `NOT NULL` nova em tabela com linhas entra em três passos**: nula,
  `UPDATE` de backfill, `SET NOT NULL`. O `db:generate` escreve um
  `ADD COLUMN ... NOT NULL` sem default, que falha em produção no primeiro
  registro existente (a `0015`, dos tamanhos do jogo, é o exemplo).
- **Valor novo de enum não entra em índice nem em `UPDATE` da mesma
  migration.** O migrator aplica tudo numa transação só, e o Postgres recusa
  usar um valor de `ADD VALUE` antes do commit. Escreva a condição pelos
  valores que já existiam (a `0016` cobre `invited` e `pending` com
  `status not in ('accepted', 'declined', 'expired')`).
- **Renomear ou apagar coluna que o código publicado lê leva três deploys.** A
  migration roda antes do deploy do bot e do painel, e o Drizzle nomeia toda
  coluna declarada no schema em cada `select` e `returning`. Então: (1) a
  coluna velha fica nula e sem escrita; (2) um deploy **sem migration** a tira
  de `src/schema/*.ts`; (3) só depois dele no ar, `db:generate` escreve o
  `DROP COLUMN`. Pular o passo 2 quebra toda query da tabela entre a migration
  e a subida do código novo. Foi o caminho de `squads.day`/`block`,
  `squad_games.squad_size` e `squad_sessions.reminder_message_id`, que saíram
  na `0018`.
- **Migration não roda no boot do bot.** É um passo da CI (`deploy.yml`), com a
  conexão direta do Supabase. Um bot que reiniciasse aplicando migration
  transformaria um restart em risco de schema.

## 4. Índices

Campo que entra em `WHERE` frequente ganha índice. Os que já existem cobrem os
acessos quentes: `cases` por `(guildId, userId)` e por número, `automod_hits`
por `(guildId, createdAt)`, `stat_buckets` por `(guildId, bucket)`,
`scheduled_actions` por `runAt`.

Se você adicionar uma consulta nova que varre tabela grande, o índice faz parte
da mesma migration — não de um "depois".

## 5. Retenção

O job `retention` (`apps/bot/src/jobs/retention.ts`) apaga o que passou do
prazo configurado por módulo: `message_cache`, `automod_hits` e
`stat_buckets` antigos. Sem ele o banco cresce sem teto — a VM Always Free não
tem folga para isso.

## 6. Ambientes

| Ambiente | Onde         | Conexão                                             |
| -------- | ------------ | --------------------------------------------------- |
| dev      | Docker local | `postgres://goodbot:goodbot@localhost:5432/goodbot` |
| produção | Supabase     | **duas** strings distintas                          |

Em produção há duas porque os dois consumidores são diferentes:

- **bot** → conexão direta, porta `5432`, pool longo. O processo é único e
  duradouro.
- **painel** → pooler pgBouncer, porta `6543`. A Vercel é serverless e abriria
  uma conexão por invocação, esgotando o limite do Postgres.

  O teto de conexões do painel **não** pode ser 1. Em modo transação o pooler
  empresta uma conexão de servidor por transação e não sabe atender duas
  consultas emendadas na mesma conexão de cliente; com teto 1, um render que
  dispare duas consultas ao mesmo tempo fica pendurado até a função da Vercel
  estourar em 504. Ver `apps/web/lib/db.ts`.

Ambas com `?sslmode=require`.

## 7. Backup

O serviço `backup` do Compose roda `pg_dump` diário na hora definida por
`BACKUP_HOUR` (UTC). Os dumps ficam num volume que o bot lê **só para leitura**,
para reportar a data do último no `/health`.

Restaurar: `infra/scripts/restore.sh`. Testar a restauração faz parte do
runbook — backup que nunca foi restaurado não é backup.

## 8. Testes

`repositories.integration.test.ts` precisa de um Postgres de verdade. Sem ele,
os casos são pulados (é o `1 skipped` da suíte). Para rodá-los:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm --filter @goodbot/db test
```
