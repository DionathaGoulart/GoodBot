#!/usr/bin/env bash
#
# Migração de nome CoBot -> Goodbot na VM. Roda no deploy, antes do
# `docker compose up`, e é **idempotente**: depois que a migração acontece uma
# vez, toda execução seguinte sai em no-op no primeiro teste.
#
# O que faz, nesta ordem:
#   1. derruba a stack antiga (o projeto Compose ainda se chama `cobot`)
#   2. move /opt/cobot para /opt/goodbot, com o .env dentro
#   3. copia os volumes `cobot_*` para `goodbot_*`
#   4. reinstala o filtro e a jail do fail2ban com os nomes novos
#
# O que **não** faz de propósito: apagar o diretório antigo ou os volumes
# antigos. Eles ficam no disco como rede de segurança até alguém decidir
# removê-los à mão (`docs/migracao-nome.md`).
#
# Uso manual, se preferir não esperar o deploy:
#   bash infra/scripts/migrate-rename.sh
set -euo pipefail

OLD_DIR=${OLD_DIR:-/opt/cobot}
NEW_DIR=${NEW_DIR:-/opt/goodbot}
OLD_PROJECT=cobot
NEW_PROJECT=goodbot
VOLUMES=(caddy_data caddy_config backups)

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf '\n▸ %s\n' "$*"; }

# ── 1. nada a fazer? ─────────────────────────────────────────────────────────
if [[ ! -d "$OLD_DIR" ]]; then
  echo "Migração de nome: nada a fazer ($OLD_DIR não existe)."
  exit 0
fi

# Estado ambíguo: alguém migrou pela metade, ou fez à mão e o antigo ficou.
# Adivinhar aqui é pior do que parar — o .env de produção está em jogo.
if [[ -d "$NEW_DIR" ]]; then
  echo "erro: $OLD_DIR e $NEW_DIR existem os dois." >&2
  echo "      Confira qual tem o .env correto, apague o outro e rode de novo." >&2
  exit 1
fi

if ! sudo -n true 2>/dev/null; then
  echo "erro: mover $OLD_DIR exige sudo sem senha para o usuário do deploy." >&2
  exit 1
fi

log "Migrando $OLD_DIR para $NEW_DIR"

# ── 2. derrubar a stack antiga ───────────────────────────────────────────────
# Tem de ser agora: o compose que está no disco ainda declara `name: cobot`, e
# é ele que sabe quais containers derrubar. Depois de trocarmos o arquivo, o
# `docker compose down` passaria a mirar o projeto novo e deixaria os
# containers antigos rodando, disputando as portas 80 e 443 com os novos.
if [[ -f "$OLD_DIR/docker-compose.yml" ]]; then
  log "Derrubando a stack antiga"
  (cd "$OLD_DIR" && docker compose down) || {
    echo "aviso: o down falhou; seguindo — o up novo vai recriar os containers." >&2
  }
fi

# ── 3. mover o diretório ─────────────────────────────────────────────────────
sudo mv "$OLD_DIR" "$NEW_DIR"
echo "  $OLD_DIR -> $NEW_DIR (o .env foi junto)"

# ── 4. volumes ───────────────────────────────────────────────────────────────
# O Compose prefixa o volume com o nome do projeto, então `caddy_data` do
# projeto `cobot` é `cobot_caddy_data`. Sem esta cópia o Caddy nasce sem os
# certificados e pede tudo de novo ao Let's Encrypt, que tem limite semanal.
log "Copiando volumes"
for vol in "${VOLUMES[@]}"; do
  old="${OLD_PROJECT}_${vol}"
  new="${NEW_PROJECT}_${vol}"

  if ! docker volume inspect "$old" >/dev/null 2>&1; then
    echo "  $old não existe — pulando."
    continue
  fi
  if docker volume inspect "$new" >/dev/null 2>&1; then
    echo "  $new já existe — preservado."
    continue
  fi

  docker volume create "$new" >/dev/null
  docker run --rm -v "$old":/de:ro -v "$new":/para \
    alpine sh -c 'cp -a /de/. /para/ 2>/dev/null || true'
  echo "  $old -> $new"
done

# ── 5. fail2ban ──────────────────────────────────────────────────────────────
# A jail antiga casa por `CONTAINER_NAME=cobot-caddy`, um container que não
# existe mais. Ela não dá erro: só para de contar 401 em silêncio, e a API fica
# sem a proteção que o PRD §7.3 conta ter. Por isso entra aqui e não num
# "depois" manual.
if command -v fail2ban-client >/dev/null 2>&1; then
  log "Reinstalando a jail do fail2ban"
  sudo rm -f /etc/fail2ban/filter.d/cobot-api.conf /etc/fail2ban/jail.d/cobot.local
  if [[ -f "$HERE/fail2ban/goodbot-api.conf" ]]; then
    sudo install -m 644 "$HERE/fail2ban/goodbot-api.conf" /etc/fail2ban/filter.d/goodbot-api.conf
    sudo install -m 644 "$HERE/fail2ban/jail.local" /etc/fail2ban/jail.d/goodbot.local
    sudo systemctl restart fail2ban || echo 'aviso: fail2ban não reiniciou.' >&2
    sudo fail2ban-client status goodbot-api >/dev/null 2>&1 \
      || echo 'aviso: a jail goodbot-api não subiu — confira o journalmatch.' >&2
  else
    echo "aviso: $HERE/fail2ban/goodbot-api.conf não veio — reinstale à mão." >&2
  fi
fi

log "Migração concluída."
echo "O diretório e os volumes antigos NÃO foram apagados; veja docs/migracao-nome.md."
