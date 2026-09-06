import { Events } from 'discord.js';

import { defineEvent } from '../lib/event';

export const clientError = defineEvent(Events.Error, (ctx, error) => {
  ctx.logger.error({ err: error }, 'erro no client do Discord');
});

export const shardDisconnect = defineEvent(Events.ShardDisconnect, (ctx, event, shardId) => {
  ctx.logger.warn(
    { shardId, code: event.code, reason: event.reason },
    'shard desconectado; discord.js vai reconectar',
  );
});

export const shardReconnecting = defineEvent(Events.ShardReconnecting, (ctx, shardId) => {
  ctx.logger.info({ shardId }, 'shard reconectando');
});

export const shardResume = defineEvent(Events.ShardResume, (ctx, shardId, replayed) => {
  ctx.logger.info({ shardId, replayed }, 'shard retomado');
});

export const clientWarn = defineEvent(Events.Warn, (ctx, message) => {
  ctx.logger.warn({ message }, 'aviso do client do Discord');
});
