#!/usr/bin/env bash
#
# Deploy manual na VM — exatamente o que o job `deploy` do
# .github/workflows/deploy.yml executa por SSH. Serve para rollback e para
# subir a stack pela primeira vez.
#
#   ./deploy.sh              # puxa a tag `latest`
#   ./deploy.sh sha-1a2b3c4  # volta para um build específico do GHCR
#
# Antes do `up`, os servidores recebem o aviso de manutenção de um reinício
# rápido. `DEPLOY_KIND=database` ou `infra` troca a previsão; `DEPLOY_KIND=none`
# reinicia calado.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/goodbot}
TAG=${1:-${TAG:-latest}}

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "Falta $APP_DIR/.env — rode o bootstrap-server.sh e preencha." >&2
  exit 1
fi

export TAG
echo "▶ Deploy da tag: $TAG"

docker compose pull
if [[ -x ./scripts/deploy-notice.sh ]]; then
  ./scripts/deploy-notice.sh "${DEPLOY_KIND:-restart}"
fi
docker compose up -d --remove-orphans
docker image prune -f

echo '▶ Estado:'
docker compose ps

# Se algum serviço não ficar saudável, o deploy falhou — melhor saber agora.
for _ in $(seq 1 20); do
  pending=$(docker compose ps --format '{{.Service}} {{.Health}}' |
    awk '$2 == "unhealthy" || $2 == "starting" { print $1 }')
  if [[ -z "$pending" ]]; then
    echo '▶ Todos os serviços saudáveis.'
    exit 0
  fi
  sleep 3
done

echo '▶ Serviços ainda não saudáveis:' >&2
docker compose ps >&2
docker compose logs --tail 50 >&2
exit 1
