#!/usr/bin/env bash
#
# Prepara a VM da Oracle (Ubuntu 24.04, E2.1.Micro x86_64) para rodar o bot.
# Idempotente: pode ser executado quantas vezes for preciso.
#
# Uso, a partir de um clone do repositório na própria VM:
#
#   sudo bash infra/scripts/bootstrap-server.sh
#
# Faz: swap de 2 GB, portas 80/443 no iptables da Oracle, Docker Engine,
# /opt/cobot com o compose, o Caddyfile e um .env esqueleto.
# Não faz (⚠️ ação manual): VCN/Security List, DNS, preencher o .env.
set -euo pipefail

APP_DIR=/opt/cobot
SERVICE_USER=${SUDO_USER:-ubuntu}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo: sudo bash $0" >&2
  exit 1
fi

# ── 1. Swap ──────────────────────────────────────────────────────────────────
# 1 GB de RAM não perdoa pico de build/GC (PRD §7.2).
log 'Swap de 2 GB'
if [[ -f /swapfile ]]; then
  echo '/swapfile já existe — nada a fazer.'
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo 'swap criada.'
fi
if ! grep -q '^/swapfile' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'linha adicionada ao /etc/fstab.'
fi
# A VM tem pouca RAM: prefira swap a matar o processo do bot.
sysctl -q -w vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >>/etc/sysctl.conf

# ── 2. Firewall do host ──────────────────────────────────────────────────────
# O Ubuntu da Oracle vem com um iptables restritivo que ignora a Security List:
# sem estas regras, o Let's Encrypt não valida o domínio.
log 'Portas 80 e 443 no iptables'
# A regra tem de entrar ANTES do REJECT final da cadeia, senão nunca é
# alcançada. A posição dele varia entre imagens da Oracle: calcule, não chute.
reject_line() { iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print $1; exit}'; }
for port in 443 80; do
  # Remove regras antigas fora de ordem (ex.: adicionadas com -A) antes de reinserir.
  while iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; do
    iptables -D INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  done
  pos=$(reject_line)
  iptables -I INPUT "${pos:-1}" -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  echo "porta $port liberada (posição ${pos:-1})."
done
if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save
else
  echo 'netfilter-persistent ausente: instalando iptables-persistent.'
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent
  netfilter-persistent save
fi

# ── 3. Docker ────────────────────────────────────────────────────────────────
log 'Docker Engine'
if command -v docker >/dev/null; then
  echo "já instalado: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$SERVICE_USER"
systemctl enable --now docker

# ── 4. /opt/cobot ────────────────────────────────────────────────────────────
log "Diretório $APP_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$APP_DIR"

for file in docker-compose.yml Caddyfile; do
  if [[ -f "$HERE/$file" ]]; then
    install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 640 "$HERE/$file" "$APP_DIR/$file"
    echo "$file copiado."
  else
    echo "aviso: $HERE/$file não encontrado — copie manualmente para $APP_DIR." >&2
  fi
done
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 750 "$HERE/scripts/deploy.sh" "$APP_DIR/deploy.sh"

if [[ -f "$APP_DIR/.env" ]]; then
  echo '.env já existe — preservado.'
else
  cat >"$APP_DIR/.env" <<'ENV'
# Produção — VM da Oracle. Preencha e NUNCA commite este arquivo.
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=
# Supabase, conexão DIRETA (5432) com sslmode=require — nunca o pooler.
DATABASE_URL=
# openssl rand -hex 32 — o mesmo valor nas variáveis da Vercel.
INTERNAL_API_TOKEN=
INTERNAL_API_PORT=3001
# Subdomínio da API do bot; o Caddy emite o certificado para ele.
BOT_DOMAIN=
ACME_EMAIL=
NODE_ENV=production
LOG_LEVEL=info
TZ=America/Sao_Paulo
ENV
  chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo ".env esqueleto criado — preencha antes do primeiro deploy."
fi

log 'Pronto'
cat <<TXT
Falta (⚠️ manual):
  1. Preencher $APP_DIR/.env (BOT_DOMAIN, DISCORD_TOKEN, DATABASE_URL, INTERNAL_API_TOKEN).
  2. Ingress TCP 80/443 na Security List da VCN.
  3. DNS: A de \$BOT_DOMAIN → IP público desta VM.
  4. Se o pacote no GHCR for privado: docker login ghcr.io -u <user> (PAT read:packages).
  5. Sair e entrar de novo no SSH para o grupo docker valer, e rodar: $APP_DIR/deploy.sh
TXT
