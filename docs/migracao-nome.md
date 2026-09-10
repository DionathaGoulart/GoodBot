# Migração CoBot → Goodbot

O repositório inteiro passou de `CoBot` para `Goodbot`. A troca cobriu prosa,
nomes de pacote (`@cobot/*` → `@goodbot/*`), identificadores de infraestrutura,
nomes de métrica e caminhos.

Boa parte disso é interna e não pede nada de ninguém. Mas **alguns
identificadores casavam com coisas que vivem fora do repositório**, e essas
precisam ser migradas à mão. Enquanto não forem, o deploy falha.

> **A parte da VM é automática.** O deploy roda a migração sozinho antes de
> subir a stack (§2). O que sobra para você é o GitHub (§3) e os dashboards
> (§7) — nada disso bloqueia o deploy.

---

## 1. O que quebra e por quê

| Identificador       | Antes                 | Depois                  | Quem quebra                    |
| ------------------- | --------------------- | ----------------------- | ------------------------------ |
| Diretório na VM     | `/opt/cobot`          | `/opt/goodbot`          | deploy (`cd` falha)            |
| Imagem no GHCR      | `cobot-bot`           | `goodbot-bot`           | a VM continua puxando a antiga |
| Projeto Compose     | `cobot`               | `goodbot`               | volumes ganham nome novo       |
| Containers          | `cobot-bot`, `-caddy` | `goodbot-bot`, `-caddy` | fail2ban deixa de casar        |
| Jail do fail2ban    | `cobot-api`           | `goodbot-api`           | proteção some até reinstalar   |
| Métricas Prometheus | `cobot_*_total`       | `goodbot_*_total`       | dashboards e alertas           |
| Postgres em dev     | user/db `cobot`       | `goodbot`               | volume local não casa          |
| Repositório GitHub  | `CoBot`               | `Goodbot`               | badges do README, remote       |

O ponto dos **volumes** merece atenção: o Compose prefixa os volumes com o nome
do projeto. Trocar `cobot` por `goodbot` faz o Docker criar
`goodbot_caddy_data` vazio em vez de reutilizar `cobot_caddy_data`. Na prática:
o Caddy pede certificado novo ao Let's Encrypt e o volume de backups aparece
vazio. Os dados antigos **não somem** — continuam nos volumes antigos — mas os
containers novos não os enxergam.

---

## 2. Na VM — o deploy faz sozinho

Isto era manual e passou a ser automático. O job de deploy roda
`infra/scripts/migrate-rename.sh` na VM antes de subir a stack, e o script é
**idempotente**: depois da primeira vez, ele sai em no-op na primeira linha.

O que ele faz, nesta ordem:

1. derruba a stack antiga (enquanto o compose do disco ainda diz `name: cobot`,
   que é o que sabe quais containers parar)
2. `mv /opt/cobot /opt/goodbot`, com o `.env` de produção dentro
3. copia `cobot_caddy_data`, `cobot_caddy_config` e `cobot_backups` para os
   volumes `goodbot_*` — sem isso o Caddy nasce sem certificado e pede tudo de
   novo ao Let's Encrypt, que tem limite semanal
4. reinstala o filtro e a jail do fail2ban com os nomes novos

O que ele **não** faz de propósito: apagar o diretório e os volumes antigos.
Eles ficam no disco como rede de segurança — a limpeza está no fim desta seção.

### O passo que faltava no deploy

Junto entrou uma correção que não tem a ver com o rename, mas que o rename
expôs: **o deploy nunca sincronizava o `docker-compose.yml` com a VM.** O
`bootstrap-server.sh` copiava uma vez, na instalação, e nada depois — então
qualquer mudança em `infra/` ficava só no repositório, sem efeito nenhum em
produção, e em silêncio.

Agora há um passo `scp` que envia `docker-compose.yml`, `Caddyfile`, os
arquivos do fail2ban e os scripts antes do `docker compose up`.

### Se preferir fazer à mão

```bash
ssh <usuário>@<ip-da-vm>
cd /tmp && git clone <repo> goodbot && cd goodbot
bash infra/scripts/migrate-rename.sh
```

### Requisito

O usuário do deploy precisa de **sudo sem senha** — mover `/opt/cobot` exige
root. Se não tiver, o script para com mensagem explícita e o deploy falha sem
ter mexido em nada.

### Quando o script para de propósito

Se `/opt/cobot` **e** `/opt/goodbot` existirem os dois, ele aborta em vez de
escolher. É um estado ambíguo — provavelmente uma migração feita pela metade — e
adivinhar qual tem o `.env` bom seria pior do que parar. Confira qual é o
correto, apague o outro e rode de novo.

### Limpeza, só depois de confirmar que subiu

Enquanto o antigo estiver no disco, dá para voltar atrás. Confirme primeiro que
`curl https://bot.<dominio>/health` responde e que `docker compose ps` mostra
tudo de pé. Só então:

```bash
docker volume rm cobot_caddy_data cobot_caddy_config cobot_backups
docker image rm ghcr.io/dionathagoulart/cobot-bot:latest
```

O `/opt/cobot` já não existe depois da migração — ele virou `/opt/goodbot`.

## 3. No GitHub

1. **Renomear o repositório** para `Goodbot` (Settings > General > Repository
   name). O GitHub mantém o redirect do nome antigo, então clones existentes
   continuam funcionando — mas as badges do README já apontam para
   `DionathaGoulart/Goodbot`.

2. **Atualizar o remote local:**

   ```bash
   git remote set-url origin git@github.com-pessoal:DionathaGoulart/Goodbot.git
   ```

3. **GHCR**: o próximo deploy publica `ghcr.io/dionathagoulart/goodbot-bot`. Na
   primeira vez o pacote nasce **privado** — dê `docker login ghcr.io` na VM, ou
   marque o pacote como público em Packages > goodbot-bot > Package settings.
   O pacote `cobot-bot` antigo continua lá; apague quando não precisar mais do
   rollback para uma imagem antiga.

4. **Secrets**: nenhum muda de nome. `DATABASE_URL`, `SSH_HOST`, `SSH_USER` e
   `SSH_KEY` seguem iguais.

---

## 4. Na Vercel

Nada obrigatório. O nome do projeto na Vercel é independente do nome do
pacote. Se quiser renomear por estética, o domínio `*.vercel.app` muda junto —
confira o `AUTH_URL` e o redirect do Discord depois.

---

## 5. No Discord Developer Portal

Nada obrigatório. Se você renomear a aplicação para "Goodbot", o nome exibido
do bot muda no servidor. O `DISCORD_CLIENT_ID` e o token continuam os mesmos.

---

## 6. Em dev, na sua máquina

O `docker-compose.dev.yml` mudou o nome do projeto, do volume e as credenciais
do Postgres. O caminho mais curto é começar de um banco limpo:

```bash
docker compose -f infra/docker-compose.dev.yml down
docker volume rm cobot-dev-pgdata          # opcional; libera espaço
docker compose -f infra/docker-compose.dev.yml up -d postgres
pnpm install
pnpm --filter @goodbot/db db:migrate
```

Se você tinha dados locais que quer manter, faça o `pg_dump` **antes** de
derrubar o container antigo.

---

## 7. Monitoramento — nada a fazer

Toda métrica trocou de prefixo: `cobot_events_total` virou
`goodbot_events_total`. Isso **não quebra nada hoje**, porque não há Prometheus
raspando o endpoint (ver o comentário em `apps/bot/src/api/routes/metrics.ts`).

Os dois únicos consumidores das métricas estão dentro do repositório e já foram
renomeados junto:

- o `curl` do runbook, que despeja o `/metrics` inteiro sem filtrar por nome;
- o card **Saúde** do painel, que na verdade lê o `/health`, não o `/metrics`.

Se um dia entrar um Prometheus ou Grafana, ele já nasce com os nomes novos. Se
você tiver algum dashboard fora do repositório que eu não conheço, aí sim é
`cobot_` para `goodbot_` nas consultas.

---

## 8. Checklist

- [ ] deploy rodou e o log mostra "Migração concluída" (ou o no-op)
- [ ] `/health` responde e `docker compose ps` mostra bot e caddy de pé
- [ ] repositório renomeado no GitHub e `git remote set-url` feito
- [ ] pacote `goodbot-bot` acessível no GHCR
- [ ] volumes e imagem antigos apagados (§2, limpeza)
