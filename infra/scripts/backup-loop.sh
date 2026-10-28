#!/usr/bin/env sh
# A janela abre no horário configurado e permanece aberta até um backup válido.
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_HOUR=${BACKUP_HOUR:-6}
BACKUP_SCRIPT=${BACKUP_SCRIPT:-/usr/local/bin/backup.sh}
BACKUP_RETRY_SECONDS=${BACKUP_RETRY_SECONDS:-900}
mkdir -p "$BACKUP_DIR"

case "$BACKUP_HOUR" in ''|*[!0-9]*) echo 'BACKUP_HOUR inválida' >&2; exit 1;; esac
[ "$BACKUP_HOUR" -le 23 ] || exit 1

while true; do
  backup_today=$(date -u +%F)
  backup_hour=$(date -u +%H)
  backup_last=$(cat "$BACKUP_DIR/.last-success" 2>/dev/null || true)
  if [ "$backup_hour" -ge "$BACKUP_HOUR" ] && [ "$backup_last" != "$backup_today" ]; then
    if sh "$BACKUP_SCRIPT"; then
      printf '%s\n' "$backup_today" > "$BACKUP_DIR/.last-success.tmp"
      mv "$BACKUP_DIR/.last-success.tmp" "$BACKUP_DIR/.last-success"
    fi
  fi
  [ "${BACKUP_RUN_ONCE:-0}" = 1 ] && exit 0
  sleep "$BACKUP_RETRY_SECONDS"
done
