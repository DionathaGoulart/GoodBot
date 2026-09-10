#!/usr/bin/env bash
#
# Restaura um dump do `backup.sh` num banco Postgres.
#
#   infra/scripts/restore.sh <arquivo.sql.gz> <DATABASE_URL de destino>
#
# Exemplo — teste de restore num banco local (o que o runbook manda fazer
# depois de qualquer mudança no schema):
#
#   docker compose -f infra/docker-compose.dev.yml up -d postgres
#   createdb -h localhost -U goodbot goodbot_restore
#   infra/scripts/restore.sh daily-20260907-030000.sql.gz \
#     postgres://goodbot:goodbot@localhost:5432/goodbot_restore
#
# NUNCA aponte para a DATABASE_URL de produção sem ter certeza: o dump é
# gerado com `--clean --if-exists`, ou seja, ele **derruba** as tabelas antes
# de recriá-las.
set -euo pipefail

FILE=${1:-}
TARGET=${2:-}

if [[ -z $FILE || -z $TARGET ]]; then
  sed -n '2,20p' "$0" >&2
  exit 1
fi

if [[ ! -f $FILE ]]; then
  echo "Arquivo não encontrado: $FILE" >&2
  exit 1
fi

# A confirmação é o que separa "restaurei o backup" de "apaguei a produção".
echo "Isto vai APAGAR e recriar as tabelas em:"
echo "  ${TARGET%%\?*}"
read -r -p 'Digite RESTAURAR para continuar: ' answer
[[ $answer == 'RESTAURAR' ]] || {
  echo 'cancelado.'
  exit 1
}

echo "▶ restaurando $FILE"
# `ON_ERROR_STOP` para a restauração parar no primeiro erro em vez de deixar
# um banco meio restaurado passando por bom.
gunzip -c "$FILE" | psql --set ON_ERROR_STOP=on --quiet "$TARGET"

echo '▶ conferindo'
psql --quiet --tuples-only --command \
  "select 'tabelas: ' || count(*) from information_schema.tables where table_schema = 'public'" \
  "$TARGET"

echo '▶ pronto. Rode `pnpm db:migrate` contra este banco para conferir que o schema está na última versão.'
