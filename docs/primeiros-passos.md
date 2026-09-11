# Primeiros passos

Do zero até o bot respondendo e o painel abrindo na sua máquina.

## 1. Requisitos

| Ferramenta | Versão | Como                       |
| ---------- | ------ | -------------------------- |
| Node       | 22 LTS | `nvm use` (há um `.nvmrc`) |
| pnpm       | 9      | `corepack enable`          |
| Docker     | atual  | só para o Postgres local   |

Node 23+ **não** serve: o `package.json` declara `engines.node: >=22 <23` e o
pnpm recusa instalar fora disso.

## 2. Uma aplicação no Discord

No [Developer Portal](https://discord.com/developers/applications):

1. **New Application** e dê um nome.
2. **Bot > Reset Token** e guarde o token → `DISCORD_TOKEN`.
3. **Bot**: ligue os _Privileged Gateway Intents_ **Server Members** e
   **Message Content**. Sem _Message Content_ o automod não vê nada. O de
   **Presence fica desligado**: nenhum módulo usa presença, e ela é a intent
   mais cara em memória (ver `apps/bot/src/client.ts`).
4. **General Information**: copie o Application ID → `DISCORD_CLIENT_ID`.
5. **OAuth2**: copie o Client Secret → `DISCORD_CLIENT_SECRET`.
6. **OAuth2 > Redirects**: adicione as três. A primeira é o login do painel;
   as outras duas são os fluxos de convite (§7.2), e o Discord exige que cada
   uma esteja registrada literalmente:

   ```
   http://localhost:3000/api/auth/callback/discord
   http://invite.localhost:3000/api/invite/callback
   http://demo.localhost:3000/api/invite/callback
   ```

7. **Installation > Install Link: `None`.** Senão o Discord oferece o botão
   "Add App" do perfil do bot, que instala **sem** passar pelos nossos links —
   e esse servidor entraria no registro sem classificação nenhuma.
8. **OAuth2 > URL Generator**: escopos `bot` e `applications.commands`, as
   permissões do PRD §10, e use a URL para convidar o bot ao seu servidor de
   testes. (Em produção quem monta essa URL é o painel, em `invite.` e
   `demo.`; o gerador serve para o servidor de testes.)

Ligue o **Modo desenvolvedor** no Discord (Configurações > Avançado) para
conseguir copiar IDs. Botão direito no servidor > **Copiar ID do servidor** →
`GUILD_IDS`. Mais de um servidor? Separe por vírgula:
`GUILD_IDS=111...,222...`.

`GUILD_IDS` é a **semente** do registro de servidores (`guild_registry`): no
boot, todo ID que ainda não tem linha entra como `approved`. Daí em diante quem
decide o que o bot atende é a tabela.

## 3. Variáveis

```bash
cp .env.example .env
```

O mínimo para subir:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
GUILD_IDS=...
DATABASE_URL=postgres://goodbot:goodbot@localhost:5432/goodbot
INTERNAL_API_TOKEN=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -base64 32)
OWNER_DISCORD_ID=...
```

O `OWNER_DISCORD_ID` é o snowflake da **sua** conta do Discord, e é o que abre
`admin.` (§7.4). Para pegá-lo: Configurações do Usuário → Avançado → **Modo
desenvolvedor**, depois clique com o botão direito no seu nome → **Copiar ID do
usuário**. Sem ele o painel admin não abre para ninguém, que é o padrão seguro;
o resto do bot e do painel sobe igual.

O resto do `.env.example` só entra em produção e está comentado lá.

## 4. Subir

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm install
pnpm --filter @goodbot/db db:migrate
pnpm dev
```

`pnpm dev` sobe os dois em paralelo:

- bot em `:3001` (a API interna)
- painel em `http://localhost:3000`

Entre no painel com a mesma conta Discord que é dona do servidor de testes.

## 5. Conferir que está de pé

```bash
curl -s localhost:3001/health                     # {"ok":true, ...}
curl -s -o /dev/null -w '%{http_code}\n' \
  localhost:3001/guilds/$GUILD_ID/roles           # 401 (sem token, correto)
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  localhost:3001/guilds/$GUILD_ID/roles | head    # a lista de cargos
```

No Discord, `/ping` deve responder.

## 6. Validação

Antes de considerar qualquer mudança pronta:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## 7. Problemas comuns

**`ERR_PNPM_UNSUPPORTED_ENGINE`** — Node fora da faixa 22.x. `nvm use`.

**Comandos não aparecem no Discord** — são registrados como _guild commands_,
uma guild por vez, e só nas que o bot **atende**. Confira se o bot está naquele
servidor e se a linha dele em `guild_registry` está `approved` (ou `demo` no
prazo): o log do boot diz `guild não atendida; o bot fica calado nela` quando
não está. Guild commands propagam na hora; se não apareceram e o status está
certo, o registro falhou — veja o log do boot.

**Automod não reage a nada** — falta o intent _Message Content_.

**Painel abre mas as telas de servidor dão erro** — o painel não fala com o
Discord, e sim com a API do bot. Confira `INTERNAL_API_URL` e se o
`INTERNAL_API_TOKEN` é **o mesmo** dos dois lados.

**`connect ECONNREFUSED ...:5432`** — o Postgres do Docker não subiu.
`docker compose -f infra/docker-compose.dev.yml ps`.

## 7.1 Adicionar um segundo servidor

O bot atende vários servidores. A ordem importa: **convide primeiro, configure
depois**, senão ele fica online e calado lá.

1. **Convide o bot** pelo OAuth2 URL Generator (escopos `bot` e
   `applications.commands`, permissões do PRD §10).
2. **Ponha o cargo do bot no topo** da lista de cargos do servidor novo. Regra
   do Discord: cargo só mexe em cargo abaixo dele.
3. **Acrescente o ID** ao `GUILD_IDS` do `.env` da VM
   (`/opt/goodbot/.env`), separado por vírgula. O painel não precisa da
   variável: ele lê o registro no banco.

   Este é o caminho de quem tem acesso à VM, e existe para os servidores que
   já eram seus. Para os outros, o caminho normal é o link de convite (§7.2) e
   a fila do painel do dono (§7.4) — nenhum dos dois pede SSH nem reinício.

   Se hoje está como `GUILD_ID`, pode trocar o nome ou deixar: `GUILD_IDS`
   ganha quando os dois existem.

4. **Reinicie o bot.** No boot, o ID novo vira uma linha `approved` no
   registro, e o `ready` prepara a guild: cache de membros, config e registro
   dos comandos.

> A semeadura só vale para servidor **sem linha** no registro. Se o bot já foi
> convidado antes (a linha nasce `pending`), acrescentar o ID não aprova nada:
> quem aprova é a fila do painel do dono (§7.4). O bot relê o registro a cada
> minuto; não precisa reiniciar.

O que muda no painel: entrar leva ao seletor (`/servidores`) quando você tem
acesso a mais de um; com um só, direto para ele. A barra lateral mostra o nome
e o ícone de cada servidor, e o ícone do servidor atual, no alto à direita,
reabre o seletor. Seu nível de permissão é resolvido **por servidor** — ser
dono de um não dá nada no outro —, e a lista só mostra onde você tem nível:
quem administra um servidor não lê o nome dos outros.

### O que conferir depois

```bash
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  https://bot.<dominio>/health
```

O bloco `guilds` deve mostrar `cached` igual a `expected`. Se `cached` for
menor, o bot não está em algum servidor da lista — o log do boot diz qual.

### Quanto a VM aguenta

O gargalo era o cache de membros: o boot carregava a lista completa de cada
guild e a RAM crescia com a **soma** dos membros de todos os servidores. Isso
acabou: o cache tem teto **por guild** (`MEMBER_CACHE_MAX`, hoje 200, em
`apps/bot/src/client.ts`), é varrido de hora em hora e não é mais preenchido no
boot. A conta virou `servidores × 200`, e não `servidores × tamanho do
servidor`.

O que mudou em troca:

- a busca de membros do painel pergunta ao Discord (lista ou busca por
  prefixo), em vez de filtrar o cache;
- a contagem de membros por cargo é exata até 5.000 membros (varredura por
  REST, sem cachear); acima disso a coluna mostra "—", porque um número tirado
  do cache seria errado com cara de certo;
- quem precisa de um membro específico usa `fetchMember`: cache primeiro, uma
  chamada quando não está lá.

O consumo real continua no `rssBytes` do `/health`. O sinal de saúde agora é
ele **parar** de crescer com o número de servidores; se voltar a crescer em
linha reta, algo voltou a encher o cache.

## 7.2 Os dois links de convite

Em produção o bot não é convidado pela URL crua do Discord: ela não conta ao
bot por onde a pessoa veio, e é justamente isso que decide se o servidor entra
na fila ou já sai atendendo. Por isso existem **dois links nossos**, cada um no
seu subdomínio:

| Link                               | Status na entrada | O bot atende?         |
| ---------------------------------- | ----------------- | --------------------- |
| `https://invite.goodbot.<domínio>` | `pending`         | não, espera aprovação |
| `https://demo.goodbot.<domínio>`   | `demo`            | sim, por 1 hora       |

O caminho é sempre o mesmo: a pessoa abre o link, lê o que vai acontecer e
clica; nós assinamos um `state` (HMAC do `AUTH_SECRET`, válido por 15 minutos)
e mandamos ao OAuth do Discord com o `redirect_uri` de volta para o **mesmo**
subdomínio. Na volta, trocamos o `code` com o Discord — é essa troca, e não o
`guild_id` da URL, que prova que a instalação aconteceu — e gravamos a linha em
`guild_registry`.

Três regras que caem de graça disso, porque uma linha que já existe nunca tem o
status sobrescrito:

- servidor **bloqueado** continua bloqueado, use quem usar o link;
- servidor **já aprovado** não volta para a fila nem vira demo com prazo;
- a **demo não se renova**: quem já usou a sua espera aprovação como qualquer
  um, senão dava para ficar renovando de hora em hora.

### Testar na sua máquina

Os subdomínios de `localhost` resolvem para 127.0.0.1 nos navegadores atuais,
então não é preciso mexer no `hosts`:

```
http://invite.localhost:3000
http://demo.localhost:3000
```

Com o `pnpm dev` rodando, abra um dos dois. Se cair no painel em vez da tela de
convite, o `Host` chegou sem o rótulo — confira a URL. As duas URLs de callback
precisam estar em **OAuth2 > Redirects** (§2).

O `http://localhost:3000/convite` mostra os dois links, o que é útil para
conferir de onde eles apontam sem decorar os subdomínios.

## 7.3 O fim da demonstração

A demo dura **uma hora** e termina sozinha. Quem toca isso é o job
`apps/bot/src/jobs/demo-expiry.ts`, que passa de minuto em minuto:

1. **faltando 10 minutos**, avisa **no privado de quem convidou** (e só lá),
   com o link do convite normal;
2. **no fim do prazo**, manda a despedida no canal do servidor **e** no privado
   de quem convidou, e sai (`guild.leave()`).

Os públicos são diferentes de propósito: quem decide pedir a aprovação é quem
convidou, e uma contagem regressiva no canal é barulho para todo mundo que não
decide nada. A despedida continua pública porque a saída é um fato do servidor.

Nada é apagado: casos, tags, tickets e config continuam no banco e voltam como
estavam se o servidor for aprovado depois.

O link do aviso sai do `AUTH_URL` — a mesma variável do painel, que em produção
também precisa estar no `.env` da VM. Sem ela o bot sobe igual e o aviso sai
sem link.

Duas colunas em `guild_registry` guardam o que já foi feito (`demo_warned_at` e
`demo_ended_at`), no banco e não na memória do processo: um deploy no meio da
hora não repete o aviso nem a despedida. O `status` continua `demo` depois do
fim — é ele que diz "este servidor já usou a sua" na tela do convite.

O bot deixa de atender **no instante** do vencimento, mesmo que o job esteja
atrasado: a conta é do `isGuildServed`, não do job.

## 7.4 A fila expira: recusa por inatividade

Um convite parado em `pending` por **uma semana** é recusado sozinho. Quem faz
isso é `apps/bot/src/jobs/pending-expiry.ts`, de hora em hora: avisa no
servidor, avisa no privado de quem convidou, sai e marca a linha como
`expired`.

A razão é a mesma da expiração da demo — bot mudo parado num servidor é a pior
versão possível —, só que aqui ele é mudo desde o primeiro minuto: quem
convidou não tem como distinguir "ainda não aprovaram" de "instalei errado".

**`expired` não é `blocked`.** A linha continua no registro contando a
história, mas o mesmo servidor pode ser convidado de novo a qualquer momento e
o relógio recomeça do zero. Quem já está na fila **não** adia a recusa clicando
no próprio link de novo: o relógio só reinicia para quem estava fora dela.

Na tela de servidores do painel admin ele aparece como `RECUSADO`, e fica fora
da fila — ele **é** a decisão, tomada pelo prazo.

## 7.5 O que o bot fala no privado de quem convidou

Todo o texto mora num arquivo só: `apps/bot/src/lib/inviter-dm.ts`.

| Quando                   | O que sai                                             |
| ------------------------ | ----------------------------------------------------- |
| entrou em demo           | está funcionando, até que horas, que vale uma vez     |
| faltam 10 min            | o prazo e o link para pedir a aprovação                |
| a demo acabou            | nada foi apagado, e como ficar de vez                  |
| entrou na fila           | o bot está calado de propósito, e o prazo da fila     |
| aprovado                 | já está atendendo, com o link do painel                |
| recusado ou bloqueado    | o motivo escrito por você na nota, quando houver       |
| recusado pelo prazo      | não é bloqueio, e convidar de novo funciona            |

Os dois primeiros avisos da tabela (as **entradas**) não podem partir do bot
sozinho: quando o `guildCreate` chega, ele ainda não sabe por qual link a
pessoa veio — o Discord adiciona o bot no clique em "Autorizar", antes de o
painel trocar o `code`. Quem sabe o fluxo é o painel, e ele pede o aviso certo
em `POST /registry/:guildId/notice`.

DM fechada é resultado normal e não quebra nada: o bot registra que não saiu e
segue. Linha sem `invited_by` (as semeadas pelo `GUILD_IDS`) não recebe aviso
nenhum, porque não há a quem avisar.

## 7.6 O painel do dono (`admin.`)

`http://admin.localhost:3000` em dev. Entra quem tem o snowflake em
`OWNER_DISCORD_ID` — **não** é cargo em servidor nenhum: quem administra um
servidor qualquer viraria administrador do bot inteiro.

Quatro telas:

| Tela          | Serve                                                              |
| ------------- | ------------------------------------------------------------------ |
| Saúde         | RAM contra os 384 MB do container, guilds em cache vs registro, uso por servidor e os erros recentes do processo |
| Servidores    | tudo o que está no registro, com o botão de sair                   |
| Fila          | quem espera aprovação (`pending`) e quem já gastou a demo, mais a blocklist |
| Manutenção    | broadcast para todos os atendidos, modo manutenção, re-registro de comandos |

Entrar é sempre pelo `/login` do painel, nunca por `admin.`: o `redirect_uri`
do Discord aponta para o host do painel, e é o único registrado. Quem abre
`admin.` sem sessão é mandado para lá e volta sozinho. O cookie de sessão sai
com `domain` do host do painel para valer nos dois — sem isso o navegador não o
mandaria para `admin.` e a tela seria inalcançável.

Duas coisas que valem saber antes de precisar delas:

- **Aprovar funciona com o bot fora do ar.** É uma escrita em `guild_registry`,
  e o `RegistryService` relê o registro a cada minuto — e no boot. Bloquear
  também: a saída do servidor é a metade que precisa do bot, e ela é tolerante
  a falha (o bot abandona bloqueados sozinho no `ready` e no `guildCreate`).
- **Manutenção não derruba o bot.** Ele fica online e continua registrando
  eventos; só recusa interação, com um aviso efêmero. Derrubar o container
  marcaria o bot como offline no Discord e ninguém saberia por quê.

O broadcast pede a palavra `ENVIAR` digitada, e ela é conferida pela API do bot
— não só pela tela. Ensaie antes: o botão de ensaio mostra em que canal a
mensagem cairia em cada servidor, sem mandar nada. Não há como desfazer.

Em produção, `OWNER_DISCORD_ID` precisa estar em **três** lugares, como o
`INTERNAL_API_TOKEN`: variáveis do projeto na Vercel (o painel), `.env` da VM (o
bot) e *variable* do repositório no GitHub, de onde o `deploy.yml` mantém a
linha do `.env` da VM em dia. Faltando em um deles, aquele lado fecha — o
sintoma é "a tela abre e o botão responde 403".

## 8. Depois daqui

- [`.harness/architecture.md`](../.harness/architecture.md) — como o código é
  organizado e onde mexer para cada tipo de tarefa.
- [`guild-como-codigo.md`](guild-como-codigo.md) — configurar o servidor por
  arquivo em vez de clicar no painel.
- [`contribuindo.md`](contribuindo.md) — convenções e checklist de PR.
