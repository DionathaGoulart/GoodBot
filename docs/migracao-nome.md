# Migração CoBot → Goodbot

O repositório inteiro passou de `CoBot` para `Goodbot`. A troca cobriu prosa,
nomes de pacote (`@cobot/*` → `@goodbot/*`), identificadores de infraestrutura,
nomes de métrica e caminhos.

Boa parte disso é interna e não pede nada de ninguém. Mas **alguns
identificadores casavam com coisas que vivem fora do repositório**, e essas
precisam ser migradas à mão. Enquanto não forem, o deploy falha.

> **Leia antes de dar `git push` na `main`.** O workflow de deploy roda a cada
> push e faz `cd /opt/goodbot` na VM. Esse diretório ainda não existe.

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

## 2. Na VM (obrigatório antes do próximo deploy)

```bash
ssh ubuntu@<ip>

# 1. derrubar a stack antiga
cd /opt/cobot && docker compose down

# 2. mover o diretório inteiro, .env incluso
sudo mv /opt/cobot /opt/goodbot
cd /opt/goodbot

# 3. trazer o compose e o Caddyfile novos
#    (ou espere o deploy fazer; ele copia do repositório)
```

### Preservar os certificados do Caddy

Sem isto o Caddy pede certificado novo. Funciona, mas o Let's Encrypt tem
limite de emissões por semana — se você estiver iterando, vale copiar:

```bash
docker run --rm \
  -v cobot_caddy_data:/de -v goodbot_caddy_data:/para \
  alpine sh -c 'cp -a /de/. /para/'

docker run --rm \
  -v cobot_backups:/de -v goodbot_backups:/para \
  alpine sh -c 'cp -a /de/. /para/'
```

O `docker volume create` do destino acontece sozinho no primeiro `up`; se o
comando acima reclamar que o volume não existe, rode `docker compose up -d`
uma vez antes.

### fail2ban

Os nomes do filtro e da jail mudaram, e o `journalmatch` agora aponta para
`goodbot-caddy`:

```bash
sudo rm -f /etc/fail2ban/filter.d/cobot-api.conf /etc/fail2ban/jail.d/cobot.local
cd /tmp && git clone <repo> goodbot && cd goodbot
sudo install -m 644 infra/fail2ban/goodbot-api.conf /etc/fail2ban/filter.d/
sudo install -m 644 infra/fail2ban/jail.local /etc/fail2ban/jail.d/goodbot.local
sudo systemctl restart fail2ban
sudo fail2ban-client status goodbot-api
```

### Limpeza (só depois de confirmar que tudo subiu)

```bash
docker volume rm cobot_caddy_data cobot_caddy_config cobot_backups
```

---

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

## 7. Monitoramento

Toda métrica trocou de prefixo: `cobot_events_total` virou
`goodbot_events_total`, e assim por diante. Qualquer dashboard, alerta ou
consulta salva que cite `cobot_` precisa ser reescrito. Não há período de
convivência — o nome antigo simplesmente deixa de ser publicado.

---

## 8. Checklist

- [ ] `/opt/cobot` movido para `/opt/goodbot` na VM
- [ ] volumes do Caddy e de backups copiados (ou aceito perder os certificados)
- [ ] fail2ban reinstalado com os nomes novos
- [ ] repositório renomeado no GitHub e `git remote set-url` feito
- [ ] pacote `goodbot-bot` acessível no GHCR
- [ ] deploy rodou até o fim e `curl https://bot.<dominio>/health` responde
- [ ] dashboards e alertas apontando para `goodbot_*`
- [ ] volumes e imagem antigos apagados
