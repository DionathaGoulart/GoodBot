#!/usr/bin/env bash
#
# Aviso de manutenção de um deploy. Pede ao bot que ainda está no ar para
# avisar os servidores atendidos, com a previsão de volta do tipo de deploy
# (PRD §7.5). Roda na VM, logo antes do `docker compose up -d`; o bot novo,
# ao subir, edita o mesmo aviso para "voltou".
#
#   ./scripts/deploy-notice.sh restart|database|infra
#
# A chamada sai de dentro do container do bot, direto na porta da API: o
# token e o OWNER_DISCORD_ID já estão no ambiente dele, e nada precisa passar
# pelo Caddy nem ser lido do `.env` pelo shell.
#
# Nunca falha: um aviso que não sai é ruim, mas um deploy que não sai por causa
# de um aviso é pior.
set -uo pipefail

KIND=${1:-}
case "$KIND" in
  restart | database | infra) ;;
  *)
    echo "▶ Sem aviso de manutenção (tipo: ${KIND:-vazio})."
    exit 0
    ;;
esac

cd "${APP_DIR:-/opt/goodbot}" || exit 0

if ! docker compose ps --status running --services 2>/dev/null | grep -qx bot; then
  echo '▶ Bot fora do ar: ninguém para avisar.'
  exit 0
fi

echo "▶ Aviso de manutenção ($KIND)"
docker compose exec -T -e DEPLOY_KIND="$KIND" bot node -e '
const port = process.env.INTERNAL_API_PORT || "3001";
fetch(`http://127.0.0.1:${port}/admin/deploy-notice`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.INTERNAL_API_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ actorId: process.env.OWNER_DISCORD_ID, kind: process.env.DEPLOY_KIND }),
  signal: AbortSignal.timeout(30000),
})
  .then(async (res) => {
    console.log(res.status, await res.text());
    process.exit(res.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
' || echo '▶ O aviso de manutenção não saiu; o deploy segue.'
exit 0
