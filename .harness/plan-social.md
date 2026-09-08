# CoBot — Plano: notificações de redes sociais v2 (só YouTube)

Plano **separado** do `.harness/plan.md` principal, só para o módulo `social`.
Mesmas regras: cada etapa cabe em uma sessão com contexto limpo; leia só o
"Contexto mínimo"; atualize a tabela **Estado** ao iniciar e ao terminar;
`⚠️ AÇÃO MANUAL` = pare e peça ao usuário; toda etapa termina com
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` e a linha final.

Quando este plano for aprovado, adicione uma linha na tabela Estado do
`plan.md` principal apontando para cá (ex.: `27 · Redes sociais v2 → ver
plan-social.md`). Não misture as duas tabelas.

---

## Estado

| #  | Etapa                                                            | Status   |
| -- | ---------------------------------------------------------------- | -------- |
| S1 | Detector YouTube v2 sem API key (vídeo, short, live, agendada)    | concluída · 2026-09-08 |
| S2 | Poda: só YouTube — shared, db, job, rotas, env                    | concluída · 2026-09-08 |
| S3 | Painel e `/social` v2                                            | concluída · 2026-09-08 |
| S4 | Docs, deploy e validação em produção                             | em andamento |

---

## 0. Diagnóstico do que existe hoje (Etapa 21, 2026-09-07)

~2.400 linhas em 20 arquivos, para um requisito que hoje é "avisar quando o
canal do YouTube publica vídeo, short ou live".

**O que está bom e fica:**

- `social_posts` com unique `(account_id, external_id)` e *claim antes de
  enviar* — a trava contra anúncio duplicado. Funciona, tem teste.
- Primeira passada de conta nova só marca o que já existe (não despeja o
  feed no canal).
- Parser do RSS por regex com fixture real (sem lib de XML).
- `HEAD /shorts/<id>` para separar short de vídeo (verificado em
  2026-09-08: vídeo comum responde `303`, short responde `200`).
- `buildSocialMessage`: template + capa como imagem do embed +
  `allowedMentions` restrito ao cargo.
- Contador de falhas no banco, desligamento no 10º erro com alerta.
- Painel escreve via API do bot (é o bot que sabe se enxerga o canal).

**O que atrapalha:**

1. **Live depende da Data API v3** (`search`, 100 unidades/chamada, teto
   10.000/dia). Consequências: chave manual no Google Cloud, throttle de 15
   min em memória, live avisada até 15 min atrasada, e sem chave o painel
   esconde o tipo `live`. É exatamente o tipo que mais importa em tempo real.
2. **Quatro plataformas para uma em uso.** `twitch.ts`, `instagram.ts`,
   `tiktok.ts`, registro `SocialProviders`, `statuses()`,
   `SOCIAL_KINDS_BY_PLATFORM`, `SOCIAL_EXTERNAL_ID`, painel de
   pré-requisitos, seletor de plataforma no formulário, 5 variáveis de
   ambiente. Tudo isso é superfície de manutenção sem usuário.
3. **Job mais sofisticado que a carga:** intervalo por conta + query de
   "vencidas" + lote de 10 + jitter + backoff exponencial em memória. Para
   ≤ 20 contas numa VM só, um laço simples resolve.
4. **Bug real: retenção de 90 dias em `social_posts` re-anuncia vídeo
   antigo.** O RSS traz as 15 últimas publicações e o job olha as 5 mais
   novas. Um canal que publica menos de 5 vídeos em 90 dias tem a linha
   podada e o vídeo volta a ser "novo" na passada seguinte.
5. **Cadastro exige `UC…` de 24 caracteres.** Ninguém sabe o ID do próprio
   canal de cabeça; o que a pessoa tem é a URL ou o `@handle`.
6. **Um template para três tipos.** `"{author} publicou: {url}"` fica
   estranho para live ("publicou" uma live?).
7. `poll_interval_s`, `last_external_id`, `display_name`, `announceBacklog`,
   `maxAccounts` configurável: campos e opções que ninguém vai mexer.

**Verificado empiricamente em 2026-09-08 (curl, sem chave, sem cookie):**

| Requisição                                             | Resultado                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET youtube.com/channel/UC…/live` (canal ao vivo)      | `200`, ~1,3 MB (345 KB gzip). `<link rel="canonical" href=".../watch?v=ID">` e `"isLive":true` no `ytInitialPlayerResponse`   |
| `GET youtube.com/channel/UC…/live` (canal sem live)     | `200`, canonical aponta para `.../channel/UC…`. Nenhum `"isLive"`                                                             |
| `GET youtube.com/watch?v=ID` (live em andamento)        | `"isLive":true`, `"isLiveContent":true`, `liveBroadcastDetails.isLiveNow:true`, `<meta itemprop="isLiveBroadcast">`, `startDate` |
| `GET youtube.com/watch?v=ID` (vídeo comum)              | `"isLiveContent":false`, `<meta itemprop="duration">`, sem `"isLive"`                                                         |
| `HEAD youtube.com/shorts/ID` (vídeo comum)              | `303`                                                                                                                         |
| `GET youtube.com/@handle`                               | `200`, canonical `.../channel/UC…`, `og:title` = nome do canal, `og:image` = avatar                                            |
| `GET youtube.com/embed/live_stream?channel=UC…`         | "unavailable" sem JS — **não serve**                                                                                          |
| `Range: bytes=0-65535`                                  | ignorado (`200`, corpo inteiro)                                                                                               |
| RSS do canal                                            | 15 entradas; a live em andamento **aparece** no feed (id igual ao do canonical do `/live`)                                    |

**Não verificado (validar na S1 com fixture real):** o HTML do `/live` e do
`watch` para uma live **agendada** (esperado: canonical `watch?v=` +
`"isUpcoming":true`, sem `"isLive":true`).

---

## 1. Decisões da v2

- **Só YouTube.** Twitch, Instagram e TikTok saem do código. O enum
  `social_platform` no Postgres **fica como está** (remover valor de enum
  exige recriar o tipo; não vale a migration). O Zod passa a aceitar só
  `'youtube'`. Quando outra plataforma voltar, ela entra como um novo
  serviço ao lado do do YouTube — sem o registro genérico.
- **Zero API key.** Descoberta e classificação saem de três páginas
  públicas do próprio YouTube: RSS, `watch?v=` e `/live`. Sem cota, sem
  Google Cloud, sem `YOUTUBE_API_KEY`. É o mesmo argumento do parser de
  RSS: formato fixo, um servidor só, fixture real no teste avisa se mudar.
- **Um laço, um intervalo.** Job roda a cada `pollIntervalSeconds`
  (config do módulo; padrão 180 s, mín. 60, máx. 1800), passa por **todas**
  as contas ligadas em sequência, com 500 ms entre contas. Sem intervalo
  por conta, sem query de vencidas, sem lote, sem jitter, sem backoff
  exponencial. Fica: try/catch por conta, `failure_count`, desligamento no
  10º erro seguido com alerta, reset no primeiro sucesso.
- **`social_posts` não é podado.** Uma linha por publicação vista; um canal
  ativo gera dezenas de linhas por ano. Sai do job de retenção.
- **Cadastro por URL ou `@handle`.** O bot resolve para `UC…`, guarda nome e
  avatar, e recusa na hora o que não existir.
- **Variável `{headline}`** no template: "publicou um vídeo novo",
  "publicou um short", "está ao vivo". Um template por conta continua, mas
  o texto padrão fica certo para os três tipos.
- **Live agendada não é anunciada.** Fica "em espera" (não entra em
  `social_posts`) e é reavaliada a cada passada até virar live de verdade.
  Premiere se comporta igual (é uma transmissão) e é anunciada como live.
- **Live que terminou não vira "vídeo novo".** O VOD tem o mesmo `videoId`;
  a unique em `social_posts` já bloqueia.

**Fora de escopo (fica para depois):** Twitch, Instagram, TikTok; template
por tipo; múltiplos canais Discord por conta; leitura parcial do HTML
(streaming com abort) — só se o consumo na VM justificar.

---

## 2. Como o detector v2 funciona (referência para S1)

Por conta, a cada passada:

1. **RSS** `feeds/videos.xml?channel_id=UC…` → 5 entradas mais novas.
2. **Sonda de live** `GET /channel/UC…/live` → se o canonical for
   `watch?v=ID` **e** o HTML tiver `"isLive":true`, `ID` é candidato a
   `live` (título, autor e capa vêm do próprio HTML: `og:title`,
   `og:image`, `"author":"…"`; ou do RSS se o ID estiver lá).
   Canonical apontando para o canal, ou `"isUpcoming":true` → nada.
3. Junta os IDs do RSS com o candidato da sonda. Para cada ID **que ainda
   não está em `social_posts`**:
   - `HEAD /shorts/ID` → `200` = **short** (cache em memória por ID, é
     imutável);
   - senão `GET watch?v=ID` → `"isUpcoming":true` = **em espera** (não grava,
     não cacheia); `"isLive":true` = **live**; senão = **vídeo**. Cache do
     resultado final em memória por ID.
   - Erro de rede na classificação → trata como **vídeo** (errar o rótulo é
     melhor que não avisar), como já é hoje no `isShort`.
4. Filtra pelos `kinds` da conta, anuncia em ordem cronológica com claim
   antes de enviar. Primeira passada só grava.

Custo por conta por passada: 1 GET pequeno (RSS) + 1 GET de ~350 KB gzip
(`/live`) + N pequenas classificações só para IDs novos (raro). Com 5
contas a 3 min: ~2.400 requisições/dia, ~1 GB/dia de entrada. Cabe na VM e
no Always Free com folga.

Riscos e mitigação:

- **YouTube mudar o HTML** → o teste com fixture quebra; o job passa a
  contar falha (canonical ausente = erro, não "sem live") e desliga a conta
  com alerta em vez de ficar mudo.
- **Parede de consentimento (IPs da UE)** → redirect para
  `consent.youtube.com`. A VM está fora da UE; mesmo assim, mandar o cookie
  `SOCS=CAI` em todas as requisições ao YouTube custa nada e evita o caso.
- **`429`/`403` do YouTube** → é falha da conta; 10 seguidas desligam. Com
  500 ms entre contas e intervalo mínimo de 60 s não deve acontecer.

---

## Etapa S1 — Detector YouTube v2 sem API key

**Contexto mínimo:** `CLAUDE.md`, este arquivo (§0–§2),
`apps/bot/src/services/social/youtube.ts`, `youtube.test.ts`, `http.ts`,
`types.ts`, `announce.ts`, `apps/bot/src/jobs/social.ts` (só para ver como
`fetchLatest` é chamado — não alterar), `packages/shared/src/constants.ts`
(bloco social), `packages/shared/src/templates.ts` (variáveis).

**Objetivo:** o provider do YouTube passa a detectar vídeo, short, live e
"agendada" sem `YOUTUBE_API_KEY`, e a resolver URL/`@handle` para `UC…`.
Nada além de `services/social/youtube*.ts`, `http.ts`, `announce.ts` e
`index.ts` (bot) muda nesta etapa; o job e o painel continuam funcionando
com a interface atual.

**Pré-requisitos:** nenhum. Etapa puramente aditiva.

**Tarefas:**

- [x] `http.ts`: enviar cookie `SOCS=CAI` e `Accept-Language: pt-BR` nas
      requisições ao YouTube; manter timeout de 10 s e `User-Agent`.
- [x] `youtube.ts` — novos parsers puros, cada um com fixture **recortada**
      (só o trecho relevante, não o HTML de 1,3 MB) em `__fixtures__/`:
      - `parseCanonical(html)` → URL do `<link rel="canonical">` ou `null`;
      - `parseWatchState(html)` → `{ isLive, isUpcoming, isLiveContent,
        title, author, thumbnail }` a partir de `"isLive":`, `"isUpcoming":`,
        `og:title`, `og:image`, `"author":"…"`;
      - `parseChannelPage(html)` → `{ channelId, title, handle, avatarUrl }`
        a partir do canonical, `og:title`, `og:image` e
        `"canonicalBaseUrl":"/@…"`.
      Todos tolerantes: campo ausente → `null`, nunca exceção.
- [x] `youtube.ts` — `YouTubeProvider` v2:
      - `fetchLatest(account)` implementa o fluxo do §2 (RSS + sonda de
        `/live` + classificação só de IDs desconhecidos). Para saber quais
        IDs são desconhecidos sem consultar o banco de dentro do provider,
        `fetchLatest` recebe um `isKnown(externalId) => Promise<boolean>`
        no `SocialAccountRef` (o job passa uma consulta a `social_posts`);
      - `classify(videoId)`: `HEAD /shorts` → short; senão `watch` →
        upcoming / live / video; cache em memória (≤ 500 IDs, descarta o
        mais antigo) só de resultados finais (nunca `upcoming`);
      - `probeLive(channelId)`: canonical `watch?v=` + `"isLive":true` →
        `SocialItem` de tipo `live`; canonical do canal → `null`; canonical
        ausente → `SocialProviderError` ("a página do canal mudou");
      - `resolveChannel(input)`: aceita `UC…`, `@handle`, `youtube.com/@…`,
        `/channel/UC…`, `/c/…`, `/user/…` (com ou sem `https://`,
        `www.`, `m.`, `youtu.be` não se aplica); `UC…` direto só valida
        via RSS (`200` = existe); o resto busca a página e usa
        `parseChannelPage`; devolve `{ channelId, title, handle,
        avatarUrl }` ou lança `SocialProviderError` com mensagem em pt-BR
        ("Não encontrei esse canal no YouTube.").
      - Remover `apiKey`, `fetchLive` da Data API, `lastLiveCheck`,
        `liveUnavailableReason`; `YOUTUBE_API_URL` e
        `YOUTUBE_LIVE_POLL_SECONDS` somem (constante em `shared` também).
- [x] `types.ts`: `SocialItem` ganha `headline: string`; `SocialAccountRef`
      ganha `isKnown`. `SocialProvider` continua igual no resto.
- [x] `announce.ts`: `KIND_HEADLINE` (`video` → "publicou um vídeo novo",
      `short` → "publicou um short", `live` → "está ao vivo") e a variável
      `{headline}` em `socialVars`. `sampleSocialItem` preenche.
- [x] `apps/bot/src/index.ts`: parar de passar `youtubeApiKey`;
      `SocialProviders.kindsFor` deixa de filtrar `live` (o registro
      genérico inteiro morre na S2 — aqui só o mínimo para compilar).
- [x] `apps/bot/src/jobs/social.ts`: única mudança — passar `isKnown`
      (consulta `social_posts` por `(accountId, externalId)`; adicionar
      `hasSocialPost` em `packages/db/src/repositories/social.ts`).
- [x] Testes (Vitest) com fixtures recortadas:
      - `parseCanonical`, `parseWatchState` (live, agendada, vídeo comum,
        VOD de live), `parseChannelPage` (`@handle`, `/channel/`, página
        sem canonical);
      - `classify`: short (`200`), vídeo (`303`), live, agendada (não
        cacheia e some do resultado), erro de rede → vídeo;
      - `probeLive`: com live, sem live, agendada, canonical ausente;
      - `resolveChannel`: cada formato de entrada aceito e dois inválidos;
      - `fetchLatest`: ID já conhecido não é classificado (zero chamadas
        extras), live da sonda que também está no RSS aparece uma vez só;
      - `{headline}` em `buildSocialMessage`.
- [x] `.env.example`: remover `YOUTUBE_API_KEY` e o comentário da cota.
- [x] ⚠️ **AÇÃO MANUAL** ao final: pedir ao usuário uma live **agendada**
      pública qualquer (ou criar uma no canal de teste) para recortar a
      fixture real de "agendada" — é o único caso não verificado. Se não
      houver como, deixar a fixture marcada como sintética e registrar
      nas notas de execução.

**Critérios de aceite:**

- `pnpm test` cobre os quatro estados (vídeo, short, live, agendada) e a
  resolução de canal sem tocar a rede.
- Rodando o bot em dev contra o canal `UCSJ4gkVC6NrvII8umztf0Ow` (Lofi
  Girl, sempre ao vivo) com `kinds: [live]`, a primeira passada só grava e
  não anuncia; forçar `DELETE` da linha da live em `social_posts` faz a
  passada seguinte anunciar **uma** live, e a seguinte não anuncia nada.
- Nenhuma referência a `YOUTUBE_API_KEY` sobra no repo (`grep`).

**Comandos de validação:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
grep -rn YOUTUBE_API_KEY --exclude-dir=node_modules . ; # vazio
```

**Notas de execução (2026-09-08):**

- **O `/live` não serve `og:`.** Colhendo as páginas com o `User-Agent` do bot
  descobriu-se que `GET /channel/<id>/live` — ao contrário de `watch?v=` e da
  página de canal — não traz nenhuma metatag `og:`. `parseWatchState` passou a
  buscar o título em três fontes, nesta ordem: `og:title`,
  `<meta name="title">` e `videoDetails.title` do `ytInitialPlayerResponse`.
- Pela mesma razão não há capa na sonda: `probeLive` usa a do RSS quando o
  vídeo está no feed e, senão, deduz `i.ytimg.com/vi/<id>/hqdefault.jpg`
  (`youtubeThumbnailUrl`), que existe para todo vídeo — inclusive live — e não
  vem com os parâmetros de assinatura que o HTML gruda nas URLs. Conferido:
  `200` na capa da live da Lofi Girl.
- **Fixtures são recortes reais** colhidos por `curl` em 2026-09-08 com o
  mesmo `User-Agent`, cookie `SOCS=CAI` e `Accept-Language` do provider:
  `/live` da Lofi Girl (transmitindo), `/live` do Google for Developers (sem
  transmissão), `watch?v=jNQXAC9IVRw` (vídeo comum) e `/@LofiGirl`. O feed
  Atom continua sintético, porque o valor dele no teste são os casos de
  entidade (`&amp;`, `&#186;`).
- **A fixture de live agendada continua sintética** — não havia live agendada
  pública à mão. É o único dos quatro estados sem recorte real; está marcada
  com `⚠️` no arquivo. Ver a ação manual pendente logo abaixo.
- **Validação real, sem Discord:** um script descartável exercitou o provider
  contra o YouTube de verdade. `resolveChannel` acertou `@LofiGirl`,
  `UCSJ4gkVC6NrvII8umztf0Ow` e `youtube.com/c/LofiGirl` (todos →
  `UCSJ4gkVC6NrvII8umztf0Ow`, "Lofi Girl", avatar), recusou
  `@naoexiste-xyz-cobot` com a mensagem em pt-BR; `probeLive` devolveu a live
  em andamento com título, autor e capa; `classify` separou dois shorts de uma
  live no feed do canal. **Falta** a validação com o bot em dev contra o
  Discord (canal, primeira passada, `DELETE` da linha em `social_posts`), que
  depende de token e banco.
- `grep -rn YOUTUBE_API_KEY` só encontra os dois documentos de plano — este,
  que precisa nomear a variável que está removendo, e o registro histórico da
  Etapa 21 em `plan.md`. Código, `.env.example` e README estão limpos.
- O ambiente da sessão estava em Node 24 e sem `node_modules`; rodou-se
  `nvm use 22` (o repo pede `>=22 <23`) e `pnpm install` antes de validar.
- Ficou para a S2, como o plano prevê: `SocialProviders`/`statuses()` ainda
  existem (só para o painel compilar), Twitch/Instagram/TikTok ganharam
  `headline` no item apenas para passar no typecheck, e `SOCIAL_KINDS`/
  `SOCIAL_KINDS_BY_PLATFORM` continuam com as quatro plataformas.

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa S2 — Poda: só YouTube (shared, db, job, rotas, env)

**Contexto mínimo:** `CLAUDE.md`, este arquivo (§0–§1),
`packages/shared/src/constants.ts` (bloco social),
`packages/shared/src/config/social.ts`, `packages/shared/src/api/social.ts`,
`packages/db/src/schema/social.ts`, `packages/db/src/repositories/social.ts`,
`apps/bot/src/services/social/index.ts`, `apps/bot/src/jobs/social.ts` e
`social.test.ts`, `apps/bot/src/api/routes/social.ts`, `apps/bot/src/env.ts`,
`apps/bot/src/index.ts` (blocos social e retenção),
`apps/bot/src/commands/community/social.ts`, `apps/web/lib/social.ts`,
`apps/web/lib/internal-api.ts` (métodos social),
`apps/web/app/g/[guildId]/config/social/*` (só para manter compilando).

**Objetivo:** apagar Twitch/Instagram/TikTok e o registro genérico,
simplificar schema, config e job, e expor `POST /social/resolve`. Ao fim, o
painel **compila e funciona** com o formulário antigo menos o seletor de
plataforma; o redesenho fica para a S3.

**Pré-requisitos:** S1 concluída.

**Tarefas:**

- [x] `packages/shared`:
      - `SOCIAL_PLATFORMS` fica (alimenta o enum do Postgres), com comentário
        de que só `youtube` está ativo; `SocialPlatformSchema = z.literal('youtube')`;
      - remover `SOCIAL_KINDS_BY_PLATFORM`, `SOCIAL_EXTERNAL_ID`,
        `SocialPlatformStatusSchema`, `platforms` do `SocialOverviewSchema`,
        `YOUTUBE_LIVE_POLL_SECONDS`, `SOCIAL_MIN/MAX_POLL_SECONDS` por conta;
      - `SOCIAL_KINDS` vira `['video', 'short', 'live']` no Zod (o enum do
        banco mantém `post`);
      - `SocialAccountInputSchema`: `platform` (literal), `externalId`
        (`UC…`, regex atual), `handle`, `displayName`, `avatarUrl`
        (URL `https://` ou `null`), `discordChannelId`, `kinds` (1..3),
        `template`, `mentionRoleId`, `enabled`. Sem `pollIntervalSeconds`;
      - `SocialConfigSchema`: `enabled` + `pollIntervalSeconds` (180,
        60..1800). Sem `maxAccounts` (constante `MAX_SOCIAL_ACCOUNTS = 20`
        fica) e sem `announceBacklog`;
      - novo `SocialResolveInputSchema { input: string }` e
        `SocialResolveResultSchema { channelId, title, handle, avatarUrl }`;
      - um `SOCIAL_DEFAULT_TEMPLATE` só: `content: "{author} {headline}"`,
        `embed: { title: "{title}", url: "{url}", timestamp: true }`
        (capa vira imagem do embed, como hoje).
- [x] `packages/db`: schema `social_accounts` perde `poll_interval_s` e
      `last_external_id`, ganha `avatar_url text`; índice
      `social_accounts_due_idx` sai (não há mais query de vencidas);
      `db:generate` → revisar `0005_social_youtube.sql` → `db:migrate`.
      Repositório: remover `listDueSocialAccounts`; adicionar
      `listEnabledSocialAccounts(db)` (todas as guilds) e
      `deleteSocialPostsBefore` deixa de ser chamado (pode ficar no repo
      ou sair; sai também `SOCIAL_POSTS_RETENTION_DAYS`).
- [x] `apps/bot/src/services/social/`: apagar `twitch.ts`, `instagram.ts`,
      `tiktok.ts`; `index.ts` deixa de ter `SocialProviders` e exporta
      `YouTubeProvider` direto. `unavailableReason()` e `statuses()` somem.
      `SocialProvider` (interface) fica, com um único implementador.
- [x] `apps/bot/src/jobs/social.ts` reescrito conforme §1: `setInterval`
      relido da config a cada passada (mudar o intervalo no painel vale na
      passada seguinte, sem restart — o mais simples é um `setTimeout`
      reagendado ao fim de cada passada com o valor atual); percorre
      `listEnabledSocialAccounts`; `await sleep(500)` entre contas;
      `config.get(guildId, 'social').enabled === false` pula a guild;
      mantém claim/anúncio/primeira passada/auditoria/`failure_count`/
      desligamento/alerta. Remover `nextAttempt`, `socialBackoffMs`,
      jitter, `SOCIAL_BATCH_SIZE`. Ajustar `social.test.ts`.
- [x] `apps/bot/src/env.ts`, `.env.example`, `apps/bot/src/index.ts`:
      remover `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
      `META_ACCESS_TOKEN`, `SOCIAL_TIKTOK_ENABLED` e a chamada de retenção
      de `social_posts`.
- [x] `apps/bot/src/api/routes/social.ts`: `GET /` devolve só `accounts`;
      `POST /` e `PATCH /:id` sem `assertPlatformAvailable`; novo
      `POST /resolve` (Bearer, Zod, rate limit — como toda rota) que chama
      `resolveChannel` e devolve `SocialResolveResult` ou 400 com a
      mensagem do provider; `POST /:id/test` continua.
- [x] `apps/bot/src/commands/community/social.ts`: `add` recebe `canal`
      (texto livre: URL, `@handle` ou `UC…`), resolve, e cria com os três
      tipos e o template padrão. Sem opção `plataforma`.
- [x] `apps/web`: `lib/internal-api.ts` ganha `resolveSocialChannel`;
      `lib/social.ts` e a página perdem `platforms`/pré-requisitos; a
      sheet perde o seletor de plataforma e `SOCIAL_KINDS_BY_PLATFORM`
      (três checkboxes fixos). **Mínimo para compilar** — o redesenho é S3.
- [x] README: linha do módulo e tabela de variáveis da VM sem as chaves.

**Critérios de aceite:**

- `grep -rn "twitch\|instagram\|tiktok\|META_ACCESS_TOKEN"` fora de
  `packages/db/drizzle/` e do PRD/plan retorna vazio.
- Migration aplica limpa num banco com contas existentes (colunas
  removidas não perdem nada que importe; `avatar_url` nasce `null`).
- Job em dev: duas contas, uma com `kinds: [video]` e outra `[live]`,
  passam a cada 3 min; derrubar a rede faz `failure_count` subir e a conta
  desligar no 10º erro com alerta, sem afetar a outra.
- `POST /social/resolve` com `@LofiGirl` devolve
  `UCSJ4gkVC6NrvII8umztf0Ow`, "Lofi Girl" e o avatar; com `@naoexiste-xyz`
  devolve 400 com mensagem legível.

**Comandos de validação:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @cobot/db db:generate && pnpm --filter @cobot/db db:migrate
```

**Notas de execução (2026-09-08):**

- **Nomes das listas de enum.** O plano dizia manter `SOCIAL_PLATFORMS` como a
  lista que alimenta o enum do Postgres. Como `SOCIAL_KINDS` precisou virar a
  lista dos tipos *ativos* (o enum do banco mantém `post`), as duas ficaram
  simétricas: `SOCIAL_PLATFORM_ENUM_VALUES` e `SOCIAL_KIND_ENUM_VALUES` são o
  que o `pgEnum` recebe, e `SOCIAL_PLATFORM`/`SOCIAL_KINDS` são o que o código
  atende. A coluna `platform` ganhou `$type<SocialPlatform>()` para o resto do
  código enxergar só `'youtube'`.
- **A migration apaga as contas mortas.** Descoberto ao testar a migration num
  banco com dados: uma linha de Twitch/Instagram sobrevivente quebraria o painel
  inteiro (`SocialAccountSummarySchema` só aceita `'youtube'`, e o `GET /social`
  valida a lista toda de uma vez) e faria o job bater no YouTube com um login de
  Twitch até se desligar no 10º erro. `0005_social_youtube.sql` começa com
  `DELETE FROM social_accounts WHERE platform <> 'youtube'`; `social_posts` some
  junto pela FK com `ON DELETE CASCADE`.
- **`{url}` no `embed.url` exigiu tocar `templates.ts`.** O template padrão do
  plano (`embed: { title, url: "{url}" }`) não passava no schema: `embed.url`
  era `z.url()`, que recusa `{url}`, e `renderMessageTemplate` nem renderizava o
  campo. Agora `embed.url` aceita URL literal **ou** texto com placeholder,
  `renderMessageTemplate` o renderiza, e `buildEmbed` só chama `setURL` quando o
  resultado é mesmo uma URL `http(s)` — um `{url}` sem valor faz o link sumir em
  vez de derrubar o embed inteiro. O editor de template do painel não expõe esse
  campo, então nada mudou na tela.
- **Intervalo relido a cada passada** via `setTimeout` reagendado, como o plano
  previa. A config é lida uma vez por guild por passada (não uma por conta), e é
  essa leitura que atualiza o intervalo da próxima.
- **Validação com Postgres de verdade** (cluster descartável em `postgresql@16`,
  já removido, já que não há Docker nesta máquina): migrations 0000–0004, seed
  com três contas (youtube + twitch + instagram) e `social_posts` de cada uma,
  depois `db:migrate`. Resultado: sobrou só a conta do YouTube com os dados
  intactos, `avatar_url` nasceu `null`, `poll_interval_s`, `last_external_id` e
  `social_accounts_due_idx` sumiram, e os posts das contas apagadas foram junto.
- **Job exercitado contra o YouTube de verdade** (Discord stubado): primeira
  passada só marcou (5 publicações vistas, 0 mensagens); segunda passada, nada;
  apagando a linha da live em `social_posts`, a passada seguinte mandou
  **uma** mensagem — `content: "Lofi Girl está ao vivo"`, embed com título, `url`
  renderizada, capa como imagem e `allowedMentions` travado — e a passada
  seguinte não mandou nada. Com um `UC…` inexistente, `failure_count` subiu até
  10 e a conta se desligou com `disabled_reason` e alerta.
- **`POST /social/resolve` exercitado** com o mesmo tradutor de erro do servidor:
  `@LofiGirl` e `youtube.com/c/LofiGirl` → `UCSJ4gkVC6NrvII8umztf0Ow` + "Lofi
  Girl" + avatar (135 caracteres, folgado no teto de 512); `UC…` direto → 200 sem
  handle/avatar; `@naoexiste-xyz-cobot` → 400 `CHANNEL_NOT_FOUND` com a mensagem
  em pt-BR; entrada vazia → 400 `VALIDATION`.
- **Falta validar com o Discord de verdade** (bot logado, canal real, `/social
  add` e o botão TESTAR do painel): depende de token e de um servidor, então fica
  para a S4.
- O painel ficou no mínimo combinado: sem seletor de plataforma, sem painel de
  pré-requisitos, três tipos fixos, e o campo do canal ainda pede o `UC…`. O
  campo que aceita URL/`@handle` com resolução na tela é da S3 — quem quiser
  cadastrar por URL hoje usa `/social add`, que já resolve.

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa S3 — Painel e `/social` v2

**Contexto mínimo:** `CLAUDE.md`, `.harness/styleguide.md`, este arquivo
(§1), `packages/shared/src/config/social.ts`, `packages/shared/src/api/social.ts`,
`apps/web/app/g/[guildId]/config/social/*`, `apps/web/lib/social.ts`,
`apps/web/app/actions/social.ts`, `apps/web/app/g/[guildId]/config/welcome/`
(editor de template com preview, para reutilizar),
`apps/bot/src/commands/community/social.ts`.

**Objetivo:** cadastrar um canal do YouTube leva menos de um minuto: cola a
URL, o painel mostra nome e avatar, escolhe o canal do Discord, salva.

**Pré-requisitos:** S2 concluída.

**Tarefas:**

- [x] Sheet de conta:
      - campo único "Canal do YouTube" (URL, `@handle` ou `UC…`) + botão
        `BUSCAR` que chama a action `resolveSocialChannelAction` →
        `POST /social/resolve`; sucesso preenche `externalId`, `handle`,
        `displayName`, `avatarUrl` e mostra um cartão com avatar + nome +
        `@handle`; erro mostra a mensagem do bot no campo;
      - na edição o cartão já vem preenchido e o campo de busca só aparece
        ao clicar em `TROCAR CANAL`;
      - "O que anunciar": três checkboxes (vídeos, shorts, lives), todos
        marcados por padrão;
      - canal do Discord, cargo a mencionar (opcional), ligada/desligada;
      - template com preview (mesmo editor do `welcome`), com a lista de
        variáveis atualizada (`{headline}` incluída) e o preview
        alternando entre os três tipos;
      - `TESTAR` continua (manda um anúncio de exemplo do primeiro tipo
        marcado).
- [x] Tabela de contas: avatar + nome + `@handle`, canal do Discord, tipos,
      estado (`OK · há 2 min` / `FALHANDO · 3/10 · motivo` /
      `DESLIGADA · motivo`), ações editar/testar/remover. Estado vazio
      seguindo o padrão do painel (styleguide).
- [x] Formulário do módulo: ligado/desligado + intervalo (segundos, 60..1800)
      com a dica "cada conta faz duas requisições ao YouTube por passada".
- [x] Remover `labels.ts` (`PLATFORM_LABEL` não tem mais uso); `KIND_LABEL`
      vem de `@cobot/shared` para bot e painel usarem o mesmo.
- [x] `/social list` mostra nome + `@handle` + tipos + estado; `/social add`
      confirma com nome e avatar (thumbnail do embed); `/social test`
      igual ao painel.
- [x] Auditoria (§6.5) continua registrando `social.account.*` com o
      `channelId` resolvido.
- [x] Testes: schema Zod (`avatarUrl` inválida, `kinds` vazio, `platform`
      diferente de youtube), e o teste de renderização/ação que o padrão do
      painel já usa nas outras telas de config, se houver.

**Critérios de aceite:**

- Colar `https://www.youtube.com/@LofiGirl` e clicar `BUSCAR` mostra "Lofi
  Girl" com avatar sem sair da sheet; salvar cria a conta com `UC…` certo.
- Colar um `@handle` inexistente mostra o erro no campo, nada é salvo.
- Estados hover/focus/active/disabled e contraste seguem o styleguide nos
  dois temas; sem animação de entrada com overshoot.
- `pnpm build` do painel passa.

**Comandos de validação:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**Notas de execução (2026-09-08):**

- **Bug encontrado e corrigido: a sheet de conta quebrava ao abrir.** O
  `KindsField` que a S2 deixou "mínimo para compilar" usava `FormItem`/
  `FormLabel`/`FormMessage` sem um `FormField` em volta, e `useFormField`
  lança quando não acha o contexto — a tela compilava, passava no typecheck e
  estourava no primeiro render da sheet. Quem achou foi o teste novo de
  componente, não a validação de tipos. Uma varredura no resto do painel não
  encontrou outro `FormItem` órfão.
- **Cadastro por URL.** O campo único "Canal do YouTube" chama
  `resolveSocialChannelAction` e, no sucesso, preenche `externalId`, `handle`,
  `displayName` e `avatarUrl` de uma vez; o `UC…` não é digitado em lugar
  nenhum. `Enter` no campo busca em vez de submeter o formulário (os dois
  aconteceriam juntos). Na edição o cartão vem pronto e a busca volta com
  `TROCAR CANAL`, que ganhou um `CANCELAR` ao lado para desistir da troca.
- **Rótulos num lugar só.** `SOCIAL_KIND_LABEL`, `SOCIAL_KIND_HEADLINE` e
  `SOCIAL_PLATFORM_LABEL` saíram de `services/social/announce.ts` para
  `@cobot/shared`; `labels.ts` do painel foi apagado. `TEMPLATE_VARIABLES`
  virou a soma de `MEMBER_TEMPLATE_VARIABLES` e `SOCIAL_TEMPLATE_VARIABLES`, e
  o editor de template aceita qual grupo oferecer — a tela de redes sociais
  não mostra mais `{memberCount}`. As telas de `welcome` continuam com a lista
  inteira, como estavam.
- **Preview por tipo.** `TemplateEditor` ganhou `previewModes`: três botões
  (VÍDEO/SHORT/LIVE) que trocam os valores de exemplo do preview sem tocar no
  template. É o que mostra que `{headline}` serve aos três casos; a barra só
  aparece quando há mais de um modo, então nada mudou nas outras telas.
- **Estado na tabela.** `OK · há 2 min` / `FALHANDO · 3/10` / `DESLIGADA ·
  motivo`. O relógio usa `useSyncExternalStore` com snapshot `0` no servidor
  (mesmo padrão do indicador de auto-refresh) para o HTML do servidor não
  discordar do primeiro render do cliente; antes da hidratação a célula mostra
  `—`.
- **`/social` v2:** `list` mostra nome · `@handle`, destino, tipos e o mesmo
  estado do painel (com `<t:…:R>` na última checagem); `add` confirma com o
  nome, os tipos e o avatar do canal como thumbnail do embed.
- **Testes novos:** `account-sheet.test.tsx` (resolução com sucesso, erro do
  bot no campo, cartão na edição + `TROCAR CANAL`, modo leitura, checkboxes) e
  `template-editor.test.tsx` (grupo de variáveis, troca de preview sem alterar
  o template). No `shared`, os rótulos cobrem os três tipos e
  `SOCIAL_TEMPLATE_VARIABLES` é subconjunto de `TEMPLATE_VARIABLES`.
- **Falta a validação com o painel de pé** (login pelo Discord + bot rodando
  para `POST /social/resolve` responder): colar `youtube.com/@LofiGirl` e ver o
  cartão na tela, e conferir hover/focus/contraste nos dois temas. Depende de
  token e servidor, como as pendências da S1 e da S2 — vai junto na S4.

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.

---

## Etapa S4 — Docs, deploy e validação em produção

**Contexto mínimo:** `CLAUDE.md`, este arquivo (§0–§2), `.harness/prd.md`
§5.8 e §8 (linhas de `social_*`), `README.md` (módulos, variáveis),
`infra/` (só o que cita variáveis de ambiente), `.env.example`.

**Objetivo:** PRD e README descrevem a v2; segredos mortos saem dos três
cofres; o módulo é validado com publicações reais.

**Pré-requisitos:** S1–S3 concluídas e mergeadas em `main`.

**⚠️ AÇÃO MANUAL:**

1. Remover `YOUTUBE_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
   `META_ACCESS_TOKEN`, `SOCIAL_TIKTOK_ENABLED` do `.env` da VM
   (`/opt/cobot/.env`) e de GitHub Secrets/Vercel se tiverem sido criados.
2. Ter um canal de teste no YouTube (pode ser o do próprio usuário) onde
   dê para: subir um vídeo curto **não listado → público**, um short, e
   abrir uma live (mesmo de 1 minuto) — inclusive uma **agendada** para
   daqui a alguns minutos.

**Tarefas:**

- [x] PRD §5.8 reescrito para a v2: só YouTube, sem chave, os três sinais
      (RSS, `watch`, `/live`), regra da agendada, retenção removida; Twitch/
      Instagram/TikTok movidos para uma nota "futuro" curta com os
      pré-requisitos já levantados na v1. §8: `social_accounts` com as
      colunas atuais; nota de que o enum mantém os valores antigos.
- [x] README: tabela de módulos, seção de variáveis da VM, e um parágrafo
      "como cadastrar um canal" (URL ou `@handle`).
- [ ] Deploy pelo CI da Etapa 19; conferir `docker compose logs bot | grep
      social` e `docker stats` (bot < 300 MB RSS com as páginas de 1,3 MB
      sendo lidas e descartadas).
- [ ] Validação real, anotando data/hora e atraso observado:
      - vídeo publicado → **um** anúncio com `{headline}` de vídeo, capa e
        link `watch?v=`;
      - short → anúncio com link `youtube.com/shorts/`;
      - live agendada → nada até começar; ao começar → um anúncio de live
        em ≤ intervalo + 1 min; ao terminar → nenhum anúncio de "vídeo";
      - `docker compose restart bot` no meio de uma passada → nenhum
        anúncio repetido.
- [ ] Registrar nas notas de execução o atraso médio observado entre
      publicar e anunciar (RSS vs. sonda de `/live`).
- [ ] `plan.md` principal: linha na tabela Estado apontando para este
      arquivo como concluído.

**Critérios de aceite:** os quatro cenários de validação real passam; PRD e
README sem menção a chave do YouTube; VM dentro do orçamento.

**Comandos de validação:**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
ssh cobot 'cd /opt/cobot && docker compose logs bot --tail 100 | grep social && docker stats --no-stream'
```

**Notas de execução (2026-09-08) — parte de documentação:**

- **PRD §5.8 reescrito.** A seção agora descreve a v2 inteira: só YouTube e sem
  credencial, o laço único com `pollIntervalSeconds` relido a cada passada, os
  três sinais (RSS, sonda de `/channel/<id>/live`, `watch?v=` + `HEAD /shorts`),
  o cookie `SOCS=CAI`, canonical ausente tratado como erro (e não como "sem
  live"), a regra da live agendada e do VOD, a primeira passada que só marca, e
  a ausência **proposital** de retenção em `social_posts` — com o bug da v1
  nomeado, para ninguém "consertar" de volta. Cadastro por URL/`@handle`/`UC…`
  via `POST /social/resolve`, e `{headline}` justificada junto de `{thumbnail}`.
  Twitch/Instagram/TikTok viraram uma nota "futuro" no fim da seção, guardando
  os pré-requisitos levantados na v1 (App Access Token da Helix, conta Business
  + permissões da Meta, ausência de API pública no TikTok) — o trabalho de
  investigação da v1 não se perde, mas sai do caminho de quem lê o requisito.
- **PRD §8 atualizado:** `social_accounts` sem `poll_interval_s` e
  `last_external_id`, com `avatar_url` e PK `uuid`; `social_posts` sem a linha
  de retenção de 90 dias. Os dois enums ficam com os valores da v1 e a razão
  está escrita ali (remover valor de enum exige recriar o tipo), com a nota de
  que só `youtube` e `video|short|live` são escritos.
- **README:** a tabela de módulos e a de variáveis da VM já estavam certas
  desde a S2. Ganhou a seção "Cadastrar um canal do YouTube" — painel
  (`ADICIONAR CANAL` → colar URL/`@handle`/`UC…` → `BUSCAR` → cartão) e Discord
  (`/social add`, `list`, `test`) — e o aviso de que a primeira passada não
  anuncia nada, que é a dúvida garantida de quem cadastra e fica olhando o
  canal.
- **Cofres de segredo:** `grep` em `.env.example`, `infra/` e `.github/` não
  acha `YOUTUBE_API_KEY`, `TWITCH_*`, `META_ACCESS_TOKEN` nem
  `SOCIAL_TIKTOK_ENABLED`. O que sobra é o `.env` da VM e os painéis de GitHub
  Secrets/Vercel, que só o usuário alcança — está na ação manual 1.
- **Validação local:** `pnpm lint` (0 erros; 3 avisos pré-existentes do React
  Compiler em telas de automod/reaction-roles), `typecheck`, `test` (684
  passando, 34 pulados em 62 arquivos) e `build` passam. O ambiente exigiu
  `PATH` do Node 22 via nvm + `corepack pnpm` (o pnpm do sistema está sob o
  Node 24, que o repo recusa).
- **Pendente e bloqueado em ação manual:** deploy pelo CI, `docker stats`, os
  quatro cenários de validação real, o atraso médio observado, e o fechamento
  da linha 27 no `plan.md`. Junto vão as pendências herdadas: validar com o
  Discord de verdade o `/social add` e o botão TESTAR (S1/S2) e ver a sheet de
  conta resolvendo o canal na tela, com hover/focus/contraste nos dois temas
  (S3).

▶ Etapa concluída. Rode /clear antes de iniciar a próxima etapa para limpar o contexto.
