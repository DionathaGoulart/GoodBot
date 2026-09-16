#!/usr/bin/env sh
#
# `pg_dump` diário do Postgres gerenciado (PRD §11).
#
# Por que existe, se o Supabase já faz backup? Porque o backup dele **não é
# exportável no free tier**: serve para restaurar dentro do Supabase e mais
# nada. Um dump nosso é a única cópia que sobrevive a "perdi o projeto".
#
# Roda dentro do serviço `backup` do Compose (postgres:17-alpine), num laço
# `sleep` em vez de cron: a imagem não tem crond e um laço é uma linha. A
# versão da imagem acompanha a do Supabase: o `pg_dump` recusa servidor de
# versão maior que a dele.
#
# Retenção: 7 diários + 4 semanais (o de domingo vira semanal).
set -eu
# Sem `pipefail` o `if` do dump lê só o status do `gzip`, que sempre dá certo:
# um `pg_dump` que aborta vira um .gz vazio de 20 bytes registrado como "ok".
# Foi assim que os dumps ficaram vazios por dias com a imagem 16 contra o
# Supabase 17.
# shellcheck disable=SC3040 # o `sh` da imagem é o ash do busybox, que tem pipefail.
set -o pipefail

BACKUP_DIR=${BACKUP_DIR:-/backups}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

alert() {
  # Sem webhook configurado o backup segue em silêncio (dev).
  [ -n "${ALERT_WEBHOOK_URL:-}" ] || return 0
  # `--data-binary @-` evita pôr a mensagem na linha de comando.
  printf '{"username":"Goodbot","embeds":[{"title":"> BACKUP FALHOU","description":%s,"color":14431557}]}' \
    "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')" |
    curl -sS -X POST -H 'content-type: application/json' --data-binary @- \
      --max-time 10 "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || log 'não consegui alertar'
}

if [ -z "${DATABASE_URL:-}" ]; then
  log 'DATABASE_URL vazia — nada a fazer.'
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Domingo (dia 7 da semana ISO) vira o dump semanal, com prefixo próprio.
if [ "$(date -u +%u)" = '7' ]; then
  PREFIX=weekly
else
  PREFIX=daily
fi
FILE="$BACKUP_DIR/${PREFIX}-$(date -u +%Y%m%d-%H%M%S).sql.gz"

# O `pg_dump` só escreve este rodapé quando termina o dump inteiro. Conferir o
# rodapé pega o que o status de saída não pega: arquivo vazio, truncado ou com
# o gzip corrompido. O `grep` lê até o fim (sem `-q`) para não fechar o pipe
# antes da hora, o que com `pipefail` viraria falha falsa.
dump_complete() {
  gzip -dc "$1" | tail -n 20 | grep 'PostgreSQL database dump complete' >/dev/null
}

log "dump em $FILE"
# `--no-owner`/`--no-acl`: o restore vai para outro banco, com outro dono.
# `--schema`: só o que é do Goodbot, `public` (as tabelas) e `drizzle` (o
# histórico de migrations). O banco inteiro traz `auth`, `storage` e a extensão
# `supabase_vault`, que não existem num Postgres comum, e aí o restore para no
# primeiro `CREATE EXTENSION`: o dump existiria e não serviria para nada.
# Escreve num temporário e só renomeia no fim, para o `/health` do bot nunca
# ver um dump pela metade como se fosse o último backup bom.
if pg_dump --no-owner --no-acl --clean --if-exists --schema=public --schema=drizzle \
  "$DATABASE_URL" | gzip -9 >"$FILE.part" && dump_complete "$FILE.part"; then
  mv "$FILE.part" "$FILE"
  log "ok — $(du -h "$FILE" | cut -f1)"
else
  rm -f "$FILE.part"
  log 'FALHOU'
  # shellcheck disable=SC2016 # as crases são markdown do Discord, não expansão.
  alert 'O `pg_dump` diário do Goodbot falhou, então hoje não há cópia exportável do banco. Veja o log do serviço backup e docs/runbook.md.'
  exit 1
fi

# Retenção: mantém os N mais recentes de cada prefixo e apaga o resto.
prune() {
  prefix=$1
  keep=$2
  # O `|| true` é por causa do `pipefail`: sem nenhum arquivo do prefixo (o
  # primeiro domingo ainda não chegou) o `ls` sai com erro e derrubaria o script
  # depois de um dump que deu certo.
  # shellcheck disable=SC2012 # os nomes são gerados aqui, sem espaço nem quebra.
  { ls -1t "$BACKUP_DIR/$prefix-"*.sql.gz 2>/dev/null || true; } | tail -n "+$((keep + 1))" | while read -r old; do
    log "removendo $old"
    rm -f "$old"
  done
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
