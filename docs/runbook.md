# Runbook — Goodbot

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

**Backup.** `ssh goodbot 'cd /opt/goodbot && docker compose logs backup'`.

---

## Reiniciar

```bash
# Só o bot (o Caddy fica de pé, o TLS não é renegociado).
ssh goodbot 'cd /opt/goodbot && docker compose restart bot'

# Tudo.
ssh goodbot 'cd /opt/goodbot && docker compose down && docker compose up -d'

# Voltar para uma imagem anterior (rollback) — a tag sai do GHCR.
ssh goodbot 'cd /opt/goodbot && TAG=sha-1a2b3c4 docker compose up -d bot'
```

O painel na Vercel não se "reinicia": use _Redeploy_ no deployment que
funcionava.

---

## Restaurar um backup

O `pg_dump` diário roda no serviço `backup` às 06:00 UTC (03:00 em São Paulo) e
guarda **7 diários + 4 semanais** no volume `backups`.

```bash
# 1. Ver o que existe.
ssh goodbot 'cd /opt/goodbot && docker compose exec backup ls -lah /backups'

# 2. Trazer o dump escolhido para a máquina local.
ssh goodbot 'cd /opt/goodbot && docker compose exec -T backup cat /backups/daily-20260907-060000.sql.gz' > dump.sql.gz

# 3. Restaurar num banco DESCARTÁVEL primeiro. Sempre.
docker compose -f infra/docker-compose.dev.yml up -d postgres
docker compose -f infra/docker-compose.dev.yml exec postgres createdb -U goodbot goodbot_restore
infra/scripts/restore.sh dump.sql.gz postgres://goodbot:goodbot@localhost:5432/goodbot_restore

# 4. Conferir que o schema está na última versão.
DATABASE_URL=postgres://goodbot:goodbot@localhost:5432/goodbot_restore pnpm db:migrate
```

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
rotaciona: é um ID público do Discord. O que ele exige é estar nos três — o
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
mão também funciona — e leva até um minuto para valer:

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

- **APROVAR** — escreve `approved` no registro e apaga o prazo. O bot passa a
  atender em até um minuto, sem redeploy e sem reinício.
- **RECUSAR** — escreve `blocked` e pede ao bot para sair. Se o bot estiver
  fora, o bloqueio vale do mesmo jeito: ele abandona servidores bloqueados
  sozinho no próximo boot.

**Aprovar funciona com o bot caído.** É uma escrita em `guild_registry`, e o
`RegistryService` relê no boot. A tela mostra "BOT FORA" e perde o nome e o
ícone dos servidores, mas os botões continuam valendo.

---

## Mandar um aviso para todos os servidores

`admin.<dominio>` → **Manutenção** → **BROADCAST**. Sempre **ENSAIAR** antes: o
ensaio devolve em que canal a mensagem cairia em cada servidor sem enviar nada,
e é o único jeito de descobrir de antemão que num deles o bot não tem canal
onde falar.

O envio pede a palavra `ENVIAR` digitada, e ela é conferida pela API do bot —
não só pela tela. **Não há como desfazer:** o bot não apaga o que publicou, e a
mensagem vai para gente que não é você.

---

## Um comando sumiu do cliente do Discord

No boot os slash commands só vão ao Discord quando o hash do manifesto muda —
o que está certo quase sempre, e é inútil justamente quando o hash está certo e
o Discord não.

`admin.<dominio>` → **Manutenção** → **FORÇAR RE-REGISTRO**. Ele faz o `PUT` do
manifesto em cada servidor atendido e devolve o resultado por servidor. O
equivalente pela VM é subir o bot com `--force`.

---

## O gateway caiu

O alerta "Gateway desconectado" só dispara depois de 60 s fora — abaixo disso é
reconexão normal do discord.js e não exige ação.

1. `docker compose logs --tail 100 bot` — procure `shardDisconnect` e o código
   de fechamento.
2. Código `4004` = token inválido → rotacione o token do bot (acima).
3. Código `4014` = intent privilegiada desligada → Developer Portal → _Bot_ →
   ligue _Server Members_ e _Message Content_ (PRD §7.3).
4. Sem código e sem reconexão: `docker compose restart bot`.
5. Se o Discord estiver fora (`discordstatus.com`), não há nada a fazer: o bot
   reconecta sozinho e manda o alerta "Gateway reconectado".

---

## O Supabase pausou o projeto

O free tier pausa projetos ociosos por 7 dias. O bot escreve o tempo todo
(stats, message cache), então isto só deveria acontecer se ele já estivesse
fora — mas o sintoma é claro: alerta "Postgres inacessível" e `database.ok:
false` no `/health`.

1. Painel do Supabase → _Restore project_. Leva alguns minutos.
2. Enquanto isso o bot continua de pé: comandos que tocam o banco falham com
   embed de erro, o gateway não cai.
3. Volte: o alerta "Postgres respondendo de novo" chega sozinho.
4. Confira que o backup voltou a rodar (`docker compose logs backup`) — se o
   dump falhou durante a pausa, rode um na mão.

---

## Alguém está sondando o token da API

Alerta "Sondagem do token da API" = 50 respostas 401 numa hora.

```bash
ssh goodbot 'sudo fail2ban-client status goodbot-api'      # IPs banidos
ssh goodbot 'sudo fail2ban-client set goodbot-api unbanip 1.2.3.4'  # desbanir
```

Se os IPs variam muito (botnet), rotacione o `INTERNAL_API_TOKEN` — ele é a
única barreira. O fail2ban limita a velocidade, não a determinação.

---

## Squads: depois de subir a jogatina sob demanda (v1.6)

A migration `0014` tira a janela semanal dos squads (`day` e `block` ficam
nulos) e o job para de agendar sessão. Nada precisa ser feito à mão, mas o que
se vê nas primeiras horas é diferente do normal:

- **Aba SQUADS com "o bot não respondeu" por alguns minutos.** O deploy sobe o
  painel e o bot em paralelo depois da migration; o painel antigo não entende o
  retrato novo do bot. Some quando os dois terminam.
- **Squads antigos sem guia.** O guia fixo de quem já existia sai no passo
  diário do job, depois das 12 h no fuso do servidor. Para adiantar, qualquer
  mudança no squad (alguém marcar jogatina, renomear) publica o guia na hora.
- **Guia sem pin.** O servidor convidou o bot antes de ele pedir
  `PinMessages`. Dê "Fixar mensagens" ao cargo do bot; o log mostra
  `guia do squad sem pin: falta PinMessages no canal` enquanto faltar.
- **Sessões semanais já marcadas continuam.** Viram jogatinas sem autor
  (`created_by` nulo), com lembrete, voice e votos como antes. Depois delas,
  nenhuma nova nasce sozinha.

A migration `0015` dá ao jogo os dois tamanhos, squad e party, copiando o
tamanho antigo para os dois. Nada muda para quem já joga até alguém mexer no
cadastro:

- **Criar ou editar jogo falha durante o deploy.** Entre a migration e a
  subida do painel novo, o painel antigo grava jogo sem `group_size`. Espere o
  deploy terminar e salve de novo.
- **Para ter squad maior que a party**, edite o jogo em **Squads > `JOGOS`** e
  suba "Tamanho do squad". Os squads que estavam cheios voltam para a busca na
  hora; o guia mostra o tamanho novo na próxima mudança do squad ou no passo
  diário.

A migration `0016` troca o pedido de entrada ("basta um aceite") pela entrada
em duas fases: convite numa thread privada e votação no canal do squad. O que
aparece nas primeiras horas:

- **"Não consegui mandar o pedido" ou `falha ao criar pedido de entrada` no
  log durante o deploy.** Entre a migration e a subida do bot novo, o bot
  antigo grava pedido sem `expires_at`, que agora é obrigatório. Some quando o
  bot novo sobe; o matcher tenta de novo na passada seguinte.
- **Pedidos antigos viram votação.** O pedido aberto antes da migration ganhou
  prazo de 72 h a partir de quando foi criado, e as recusas que ele já tinha
  contam como votos contra. A mensagem ainda mostra `ACEITAR` e `RECUSAR`:
  eles valem como `A FAVOR` e `CONTRA`, e o primeiro voto troca os botões.
- **Convite sem thread.** Convidar exige as mesmas permissões da proposta no
  canal de busca (`CreatePrivateThreads`, `SendMessagesInThreads` e
  `ManageThreads`). Sem elas o matcher pula a guild com aviso no log e
  `/squad convidar` responde que falta permissão.

A migration `0017` guarda a presença no voice reservado
(`squad_session_attendance`) e a chamada pública (`CHAMAR GENTE`). É só tabela
nova e coluna nula, então o bot e o painel antigos seguem funcionando até o
deploy terminar. O que esperar:

- **Todo squad começa "Ainda não jogaram." ou com pouco histórico.** A presença
  só é gravada a partir do deploy; as jogatinas que já tinham `played_at`
  contam com quem disse `VOU`. O guia de cada squad ganha o histórico e o botão
  `CHAMAR GENTE` na próxima mudança ou no passo diário.
- **Coluna HISTÓRICO com `SEM DADO DO BOT`.** O painel novo subiu antes do bot
  novo. Some quando o bot termina de subir.
- **`CHAMAR GENTE` responde que não consegue postar no canal de busca.** O bot
  precisa ver, escrever e mandar embed no canal de busca, como na mensagem
  fixa. O log mostra `chamada pública pulada: faltam permissões no canal de
  busca` com o que falta.
- **Chamada que ficou no canal depois do início.** Acontece se apagar a
  mensagem falhar no Discord (o log diz `não foi possível apagar a chamada
  pública`). O botão `ENTRAR` já não aceita ninguém e apaga a mensagem no
  primeiro clique; apagar à mão também não tem efeito colateral.

---

## Checklist mensal

- [ ] **Painel do dono:** `admin.<dominio>` — a tela de **Saúde** junta RAM
      contra os 384 MB do container, guilds em cache vs registro, uso por
      servidor e os erros recentes do processo. Comece por ela; os itens abaixo
      são o que ela não vê.
- [ ] **Fila:** `admin.<dominio>/fila` vazia. Servidor esperando aprovação é
      alguém com o bot mudo e sem entender por quê.
- [ ] **Espaço em disco:** `ssh goodbot 'df -h /'` — abaixo de 80%.
- [ ] **Memória:** `ssh goodbot 'cd /opt/goodbot && docker stats --no-stream'` —
      bot < 300 MB, total < 500 MB (a máquina tem 1 GB).
- [ ] **Backups:** `docker compose exec backup ls -lah /backups` — o dump de
      hoje existe e não está com 0 byte. O card **BACKUP.SYS** em
      `/g/<guildId>/system` diz "em dia".
- [ ] **Restore:** uma vez por trimestre, ou depois de qualquer migration
      grande, faça o restore de teste (acima). Backup não testado não é backup.
- [ ] **Cota do Supabase:** painel → _Settings_ → _Usage_. O free tier são
      500 MB; acima de 400 MB, revise as retenções (PRD §8).
- [ ] **Uso da Vercel:** painel → _Usage_. Um servidor só fica muito abaixo do
      limite; um salto quer dizer que alguém achou o painel.
- [ ] **fail2ban:** `sudo fail2ban-client status goodbot-api` — banimentos de
      sobra querem dizer sondagem constante.
- [ ] **Dependências:** os PRs do Dependabot da semana, e `pnpm audit
--audit-level high` limpo.
- [ ] **Certificado:** `curl -sI https://bot.<dominio>/health | head -1` — o
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
