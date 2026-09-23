# Runbook: Goodbot

O que fazer quando algo dá errado, e o que conferir todo mês. Escrito para
quem tem SSH na VM, acesso ao projeto na Vercel e ao do Supabase.

A hospedagem é dividida em três (PRD §7.2):

| Peça        | Onde                                   | Como se mexe                  |
| ----------- | -------------------------------------- | ----------------------------- |
| Bot + Caddy | VM Oracle `E2.1.Micro`, `/opt/goodbot` | `ssh goodbot`, Docker Compose |
| Painel      | Vercel                                 | painel da Vercel / `git push` |
| Postgres    | Supabase                               | painel do Supabase            |

O apelido `goodbot` no `~/.ssh/config` é o que os comandos abaixo assumem.

---

## Ver logs

**Bot (VM).** Tudo vai para o stdout do container; o Docker guarda 5 arquivos
de 10 MB:

```bash
ssh goodbot 'cd /opt/goodbot && docker compose logs -f --tail 200 bot'
ssh goodbot 'cd /opt/goodbot && docker compose logs --since 1h bot | grep '"'"'"level":50'"'"''  # só erros
```

**Caddy (acessos e TLS).** É aqui que aparece um 401 e é daqui que o fail2ban lê:

```bash
ssh goodbot 'cd /opt/goodbot && docker compose logs --tail 200 caddy'
```

**Painel (Vercel).** Painel do projeto → _Logs_, ou `vercel logs <deployment>`.
Um erro de server action aparece com o stack; um `redirect` para `/denied` não
é erro.

**Backup.** `ssh goodbot 'cd /opt/goodbot && docker compose logs backup'`. Um
`pg_dump: error: aborting because of server version mismatch` quer dizer que o
Supabase subiu de major: suba a imagem do serviço `backup` em
`infra/docker-compose.yml` para a mesma versão.

---

## Reiniciar

```bash
# Só o bot (o Caddy fica de pé, o TLS não é renegociado).
ssh goodbot 'cd /opt/goodbot && docker compose restart bot'

# Tudo.
ssh goodbot 'cd /opt/goodbot && docker compose down && docker compose up -d'

# Voltar para uma imagem anterior (rollback): a tag sai do GHCR.
ssh goodbot 'cd /opt/goodbot && TAG=sha-1a2b3c4 docker compose up -d bot'
```

O painel na Vercel não se "reinicia": use _Redeploy_ no deployment que
funcionava.

---

## Restaurar um backup

O `pg_dump` diário roda no serviço `backup` às 06:00 UTC (03:00 em São Paulo) e
guarda **7 diários + 4 semanais** no volume `backups`. Ele leva só os schemas
`public` (as tabelas) e `drizzle` (o histórico de migrations): o resto do banco
é do Supabase (`auth`, `storage`, `supabase_vault`) e não existe num Postgres
comum. Um dump que sai sem o rodapé `PostgreSQL database dump complete` é
descartado e dispara o alerta.

```bash
# 1. Ver o que existe.
ssh goodbot 'cd /opt/goodbot && docker compose exec backup ls -lah /backups'

# 2. Trazer o dump escolhido para a máquina local.
ssh goodbot 'cd /opt/goodbot && docker compose exec -T backup cat /backups/daily-20260907-060000.sql.gz' > dump.sql.gz

# 3. Restaurar num banco DESCARTÁVEL primeiro. Sempre. Postgres 17, a versão do
#    Supabase: o Postgres 16 do docker-compose.dev.yml recusa o dump
#    (`unrecognized configuration parameter "transaction_timeout"`).
docker run -d --rm --name goodbot-restore -e POSTGRES_PASSWORD=restore -p 127.0.0.1:5433:5432 postgres:17-alpine
gunzip -c dump.sql.gz | docker exec -i goodbot-restore psql -U postgres --set ON_ERROR_STOP=on --quiet

# 4. Conferir que o schema está na última versão.
DATABASE_URL=postgres://postgres:restore@localhost:5433/postgres pnpm db:migrate
docker stop goodbot-restore
```

O `psql` roda dentro do container de propósito: o `infra/scripts/restore.sh`
usa o `psql` da máquina, e um cliente anterior ao 17.6 não entende o
`\restrict` que o `pg_dump` novo escreve no dump. Para restaurar com o script,
confira antes `psql --version`.

Só depois de o restore de teste passar é que se aponta para produção. O dump é
gerado com `--clean --if-exists`: ele **derruba** as tabelas antes de recriar.

> ⚠️ Restaurar em produção significa perder tudo o que aconteceu entre o dump e
> agora. Antes, tire um dump do estado atual (`docker compose exec backup sh
/usr/local/bin/backup.sh`) para poder desfazer.

---

## Rotacionar o `INTERNAL_API_TOKEN` (sem downtime)

O token vive em **três** cofres (PRD §7.3) e a ordem importa: o bot precisa
aceitar o token novo **antes** de o painel começar a usá-lo.

```bash
NOVO=$(openssl rand -hex 32)
```

1. **VM.** `ssh goodbot`, edite `/opt/goodbot/.env` (`INTERNAL_API_TOKEN=$NOVO`) e
   `cd /opt/goodbot && docker compose up -d bot`. O bot reinicia em segundos; o
   painel fica com 401 nesse intervalo e volta sozinho.
2. **Vercel.** Projeto → _Settings_ → _Environment Variables_ → editar
   `INTERNAL_API_TOKEN` → _Redeploy_ do último deployment de produção.
3. **GitHub.** _Settings_ → _Secrets and variables_ → _Actions_ → atualizar
   `INTERNAL_API_TOKEN` (o deploy usa o valor só se um dia passar a injetá-lo;
   manter os três iguais evita surpresa).

O `OWNER_DISCORD_ID` mora nos mesmos três lugares, mas não é segredo e não se
rotaciona: é um ID público do Discord. O que ele exige é estar nos três: o
painel confere antes de renderizar `/admin`, e o bot confere de novo o
`actorId` de toda escrita ali. Faltando em um lado, aquele lado fecha, e o
sintoma é "a tela abre e o botão responde 403". No GitHub ele é *variable*, não
*secret*, e o `deploy.yml` escreve a linha no `.env` da VM a cada deploy.

**Como confirmar:** abra `/g/<guildId>/system` no painel. Se o card carrega, o
painel está falando com o bot. No log do Caddy não deve sobrar 401.

Rotacione **imediatamente** se: o token apareceu num log, num print, num PR, ou
se chegou o alerta "Sondagem do token da API".

---

## Rotacionar o token do bot no Discord

1. Developer Portal → _Bot_ → _Reset Token_. A partir daí o token antigo morre:
   o bot cai. Isto **tem** downtime.
2. `ssh goodbot`, edite `DISCORD_TOKEN` em `/opt/goodbot/.env`.
3. `cd /opt/goodbot && docker compose up -d bot`.
4. Confira `docker compose logs -f bot` até o `boot` e o alerta "Bot no ar".

O `DISCORD_CLIENT_SECRET` (só o painel usa) é rotacionado no mesmo portal, em
_OAuth2_, e atualizado nas variáveis da Vercel.

---

## Adicionar um moderador ao painel

O painel não tem lista de usuários: o acesso vem dos cargos do Discord
(PRD §9.2).

1. No Discord, dê à pessoa um cargo que esteja em **Cargos de moderação** ou em
   **Acesso ao painel** (`/g/<guildId>/config/general`).
2. Peça para ela entrar em `https://<painel>/login` com o Discord.
3. Se der "acesso negado", a sessão dela ainda tem o nível antigo: o painel
   reconfere a permissão a cada 15 min, ou na hora se ela sair e entrar de novo.

Quem é dono do servidor é sempre `owner` e não depende de cargo nenhum.

Isso é acesso ao painel de **um servidor**. O painel do dono do bot (`admin.`)
é outra coisa e não se ganha por cargo: quem entra é o snowflake em
`OWNER_DISCORD_ID`, e mais ninguém.

---

## Entrar em manutenção

Quando for mexer no banco, migrar schema ou qualquer coisa em que uma escrita
pela metade seja pior do que o bot mudo:

1. `admin.<dominio>` → **Manutenção** → escreva o aviso → **ENTRAR EM
   MANUTENÇÃO**.
2. Faça o que tem de fazer.
3. **VOLTAR A ATENDER**.

O bot **continua online** e continua registrando eventos; ele só recusa
interação, com um embed efêmero. Derrubar o container faria o Discord marcar o
bot como offline, e aí ninguém saberia se caiu ou se é manutenção.

O estado fica na tabela `meta` (chave `maintenance`), não numa variável do
processo: um deploy no meio da janela desligaria a manutenção sem ninguém
pedir. O espelho em memória do bot relê a cada minuto, então mexer na chave na
mão também funciona, e leva até um minuto para valer:

```sql
-- Emergência, com o painel fora. Desliga a manutenção.
update meta set value = '{"enabled":false,"message":null,"since":null,"by":null}'::jsonb
  where key = 'maintenance';
```

---

## Um servidor pediu para entrar

`admin.<dominio>` → **Fila**. Quem entrou pelo convite normal aparece como
`pending`; quem usou a demonstração até o fim aparece como demo gasta. Os dois
esperam a mesma decisão.

- **APROVAR**: escreve `approved` no registro e apaga o prazo. O bot passa a
  atender em até um minuto, sem redeploy e sem reinício.
- **RECUSAR**: escreve `blocked` e pede ao bot para sair. Se o bot estiver
  fora, o bloqueio vale do mesmo jeito: ele abandona servidores bloqueados
  sozinho no próximo boot.

**Aprovar funciona com o bot caído.** É uma escrita em `guild_registry`, e o
`RegistryService` relê no boot. A tela mostra "BOT FORA" e perde o nome e o
ícone dos servidores, mas os botões continuam valendo.

---

## Aviso de manutenção no deploy

Todo deploy que reinicia o bot avisa os servidores antes, sozinho. O job
`changes` do `deploy.yml` compara o commit da imagem no ar (label da imagem)
com o novo e dá um tipo ao deploy (`packages/shared/src/deploy.ts`):

| Tipo       | Quando                                                      | Previsão | O bot |
| ---------- | ----------------------------------------------------------- | -------- | ----- |
| `none`     | só painel, docs, CI ou guild como código                    | nenhuma  | não é reconstruído nem reinicia; ninguém é avisado |
| `restart`  | código do bot, `shared`, `db`, lockfile, Dockerfile         | ~1 min   | reinicia |
| `database` | migration nova em `packages/db/drizzle/`                    | ~2 min   | reinicia com o schema novo |
| `infra`    | `docker-compose.yml`, `Caddyfile`, fail2ban, scripts da VM  | ~3 min   | reinicia; o Caddy pode subir de novo junto |

Depois do `docker compose pull`, o `scripts/deploy-notice.sh` pede ao bot que
ainda está no ar para publicar o aviso (no mesmo canal do broadcast) com a hora
prevista de volta; logo em seguida vem o `up`. O bot novo, ao subir, edita a
mesma mensagem para "Goodbot de volta" com o tempo que ficou fora. O estado
fica em `meta` (chave `deploy_notice`), porque quem avisa e quem confirma são
processos diferentes.

- **Rodar o workflow à mão** nunca é `none`: é pedir o deploy.
- **Rollback com `deploy.sh`** também avisa (`restart`); `DEPLOY_KIND=none
  ./deploy.sh sha-…` reinicia calado.
- **Sem `OWNER_DISCORD_ID` na VM** o aviso não sai (a rota responde 403) e o
  deploy segue normal: o script nunca falha o deploy.
- **Aviso que ficou "em manutenção"** com o bot no ar é deploy que avisou e não
  reiniciou (o `up` falhou antes de derrubar o container). O próximo boot
  resolve; para resolver já, `docker compose restart bot`.

---

## Mandar um aviso para todos os servidores

`admin.<dominio>` → **Manutenção** → **BROADCAST**. Sempre **ENSAIAR** antes: o
ensaio devolve em que canal a mensagem cairia em cada servidor sem enviar nada,
e é o único jeito de descobrir de antemão que num deles o bot não tem canal
onde falar.

O envio pede a palavra `ENVIAR` digitada, e ela é conferida pela API do bot,
não só pela tela. **Não há como desfazer:** o bot não apaga o que publicou, e a
mensagem vai para gente que não é você.

---

## Um comando sumiu do cliente do Discord

No boot os slash commands só vão ao Discord quando o hash do manifesto muda,
o que está certo quase sempre, e é inútil justamente quando o hash está certo e
o Discord não.

`admin.<dominio>` → **Manutenção** → **FORÇAR RE-REGISTRO**. Ele faz o `PUT` do
manifesto em cada servidor atendido e devolve o resultado por servidor. O
equivalente pela VM é subir o bot com `--force`.

---

## O gateway caiu

O alerta "Gateway desconectado" só dispara depois de 60 s fora: abaixo disso é
reconexão normal do discord.js e não exige ação.

1. `docker compose logs --tail 100 bot`: procure `shardDisconnect` e o código
   de fechamento.
2. Código `4004` = token inválido → rotacione o token do bot (acima).
3. Código `4014` = intent privilegiada desligada → Developer Portal → _Bot_ →
   ligue _Server Members_, _Message Content_ e _Presence_ (PRD §7.3).
4. Sem código e sem reconexão: `docker compose restart bot`.
5. Se o Discord estiver fora (`discordstatus.com`), não há nada a fazer: o bot
   reconecta sozinho e manda o alerta "Gateway reconectado".

---

## O Supabase pausou o projeto

O free tier pausa projetos ociosos por 7 dias. O bot escreve o tempo todo
(stats, message cache), então isto só deveria acontecer se ele já estivesse
fora, mas o sintoma é claro: alerta "Postgres inacessível" e `database.ok:
false` no `/health`.

1. Painel do Supabase → _Restore project_. Leva alguns minutos.
2. Enquanto isso o bot continua de pé: comandos que tocam o banco falham com
   embed de erro, o gateway não cai.
3. Volte: o alerta "Postgres respondendo de novo" chega sozinho.
4. Confira que o backup voltou a rodar (`docker compose logs backup`). Se o
   dump falhou durante a pausa, rode um na mão.

---

## Alguém está sondando o token da API

Alerta "Sondagem do token da API" = 50 respostas 401 numa hora.

```bash
ssh goodbot 'sudo fail2ban-client status goodbot-api'      # IPs banidos
ssh goodbot 'sudo fail2ban-client set goodbot-api unbanip 1.2.3.4'  # desbanir
```

Se os IPs variam muito (botnet), rotacione o `INTERNAL_API_TOKEN`: ele é a
única barreira. O fail2ban limita a velocidade, não a determinação.

---

## Buscar squad: subir o módulo novo (PRD v1.8)

O squad fixo (perfil, match, jogatina com voice reservado) foi trocado por
cargo de busca, salas efêmeras e evento agendado do Discord. Antes do deploy:

1. **Intent Presence ligada** no Developer Portal (Bot > Privileged Gateway
   Intents). Sem ela o bot novo **não loga**: cai com `Used disallowed
   intents` no boot.
2. **Dump do banco agora** (`docker compose exec backup sh
   /usr/local/bin/backup.sh`). A migration `0023` apaga as nove tabelas
   `squad_*` com os dados, sem volta; o dump é o único jeito de consultar o
   que havia.

No deploy, a migration roda na CI antes do bot novo. Por alguns segundos o bot
velho erra em query de tabela que sumiu (log de erro no `squads`): é o módulo
sendo substituído, e some quando o novo sobe.

Depois do deploy, em cada servidor que usava squads:

- **Configure pelo painel** (**Buscar squad**): os cargos `Buscando Squad` e
  `Sem Aviso de Squad`, o canal do painel, a categoria das salas e o
  `➕ Criar Squad`. A config antiga passa na validação, mas a categoria salva é
  a dos canais de texto do squad velho: troque antes de ligar, senão o bot
  trata aquela categoria como a das salas.
- **Publique o painel** (`PUBLICAR` na mesma tela ou `/squad painel`) e
  **apague à mão** a mensagem fixa antiga do módulo, se ela estiver no mesmo
  canal. Os botões dela respondem que aquele fluxo acabou.
- **Canais que os squads antigos deixaram** (texto privado, voice temporário)
  viram canais comuns. Limpar é da staff.

Sintomas que valem saber:

- **Sala não nasce e a pessoa fica no `➕ Criar Squad`.** Falta `ManageChannels`
  ou `MoveMembers` na categoria, o servidor bateu 500 canais ou os 24 nomes
  gregos estão em uso. O motivo sai no log (`squads`).
- **Painel desatualizado.** Edição que falha espera a próxima mudança numa
  sala. Mensagem apagada volta sozinha na mudança seguinte; para forçar, use
  `ATUALIZAR`.
- **Cargo ou sala durou uns minutos a mais depois de um restart.** Esperado: os
  prazos são memória e a reconciliação conta a janela do zero.

---

## RAM ou banco perto do limite

O `CapacityJob` mede a cada 15 min e alerta no webhook quando a RAM do bot
passa de **300 MB** (o container cai em 384 MB) ou o banco passa de **400 MB**
(a cota do Supabase são 500 MB, e cheia o banco só aceita leitura). Enquanto
continuar acima, o alerta repete uma vez por dia. Sem `ALERT_WEBHOOK_URL` no
`.env` da VM o alerta não sai, e só o `/admin` avisa.

O que mais pesa nos dois é o **cache de mensagens**: o texto de toda mensagem
fica 7 dias no banco, e as últimas de cada canal ativo ficam na RAM.

1. Abra `admin.<dominio>`. Os tiles **MEMÓRIA RSS**, **BANCO** e **CACHE DE
   MENSAGENS** dizem qual dos limites está perto.
2. Na tabela **USO.LOG**, os servidores vêm ordenados por mensagens guardadas.
   Clique **DESLIGAR** no cache de mensagens dos primeiros. A mudança vale na
   hora (o bot recebe o invalidate) e aparece na auditoria do servidor.
3. O banco não encolhe na hora: as mensagens já guardadas saem na retenção,
   em até 7 dias. A RAM cai em até 1 h, quando os canais parados saem da
   memória.
4. Um servidor pode pedir `messageCache.perChannel` alto (até 1000) na tela de
   logs dele. Esse valor vale só para os canais dele.

Quanto cabe, em ordem de grandeza: o limite fixo do Discord são **100
servidores** para bot não verificado; o banco aguenta uns **140 mil mensagens
por dia** somando todos os servidores com cache ligado; a RAM, algumas dezenas
de servidores médios.

---

## Checklist mensal

- [ ] **Painel do dono:** `admin.<dominio>`. A tela de **Saúde** junta RAM
      contra o orçamento de 300 MB, o tamanho do banco contra a cota, o cache
      de mensagens, guilds em cache vs registro, uso por servidor e os erros
      recentes do processo. Comece por ela; os itens abaixo são o que ela não
      vê.
- [ ] **Fila:** `admin.<dominio>/fila` vazia. Servidor esperando aprovação é
      alguém com o bot mudo e sem entender por quê.
- [ ] **Espaço em disco:** `ssh goodbot 'df -h /'`, abaixo de 80%.
- [ ] **Memória:** `ssh goodbot 'cd /opt/goodbot && docker stats --no-stream'`,
      bot < 300 MB, total < 500 MB (a máquina tem 1 GB).
- [ ] **Backups:** `docker compose exec backup ls -lah /backups`. O dump de
      hoje existe e tem dezenas de KB. Arquivo de 20 bytes é gzip vazio: o
      `pg_dump` falhou. O card **BACKUP.SYS** em `/g/<guildId>/system` diz "em
      dia" e ignora arquivo abaixo de 1 KB.
- [ ] **Restore:** uma vez por trimestre, ou depois de qualquer migration
      grande, faça o restore de teste (acima). Backup não testado não é backup.
- [ ] **Cota do Supabase:** o tile **BANCO** do `/admin` (é o mesmo número
      que o Supabase compara com a cota). O free tier são 500 MB; acima de
      400 MB o tile marca APERTADO e o bot alerta. Veja a seção abaixo.
- [ ] **Uso da Vercel:** painel → _Usage_. Um servidor só fica muito abaixo do
      limite; um salto quer dizer que alguém achou o painel.
- [ ] **fail2ban:** `sudo fail2ban-client status goodbot-api`. Banimentos de
      sobra querem dizer sondagem constante.
- [ ] **Dependências:** os PRs do Dependabot da semana, e `pnpm audit
--audit-level high` limpo.
- [ ] **Certificado:** `curl -sI https://bot.<dominio>/health | head -1`. O
      Caddy renova sozinho, mas vale conferir.

---

## Comandos de diagnóstico

```bash
# Saúde completa (exige o Bearer; sem ele responde só {"ok":true}).
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" https://bot.<dominio>/health | jq

# Métricas em formato Prometheus.
curl -s -H "Authorization: Bearer $INTERNAL_API_TOKEN" https://bot.<dominio>/metrics

# Estado dos containers e uso de recursos.
ssh goodbot 'cd /opt/goodbot && docker compose ps && docker stats --no-stream'
```
