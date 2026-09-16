'use client';

import { setMessageCacheAction } from '@/app/actions/admin';
import { Tag } from '@/components/retro/tag';

import { useAdminAction } from './use-admin-action';

import type { AdminMessageCache } from '@/lib/admin';

/**
 * O estado do cache de mensagens de um servidor e o botão que liga e desliga.
 *
 * Sem `AlertDialog`, ao contrário de SAIR: desligar não apaga nada e desfazer é
 * clicar de novo. Com o módulo de logs desligado não há botão, porque o cache
 * já não grava e ligá-lo não mudaria nada.
 */
export function MessageCacheToggle({
  guildId,
  cache,
}: {
  guildId: string;
  cache: AdminMessageCache;
}) {
  const { busy, run } = useAdminAction();
  const key = `cache:${guildId}`;

  if (!cache.logs) return <Tag tone="muted">SEM LOGS</Tag>;

  return (
    <span className="flex items-center justify-end gap-2">
      <Tag tone={cache.enabled ? 'success' : 'muted'}>{cache.enabled ? 'LIGADO' : 'DESLIGADO'}</Tag>
      <button
        type="button"
        className={cache.enabled ? 'btn-goodchat-danger' : 'btn-goodchat-outline'}
        disabled={busy !== null}
        onClick={() => {
          void run(key, setMessageCacheAction, { guildId, enabled: String(!cache.enabled) });
        }}
      >
        {busy === key ? 'GRAVANDO_' : cache.enabled ? 'DESLIGAR' : 'LIGAR'}
      </button>
    </span>
  );
}
