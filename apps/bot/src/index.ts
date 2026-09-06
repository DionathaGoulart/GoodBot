import { createDb } from '@cobot/db';
import { VERSION } from '@cobot/shared';

import { AutomodService } from './automod/engine';
import { createClient } from './client';
import { commands as commandList } from './commands/index';
import { env } from './env';
import { events } from './events/index';
import { loadCommands, loadEvents } from './lib/loader';
import { logger } from './logger';
import { AutoroleService } from './services/autorole';
import { ConfigService } from './services/config';
import { LockService } from './services/locks';
import { LogQueue } from './services/log-queue';
import { LogService } from './services/logs';
import { MessageCacheService } from './services/message-cache';
import { ModerationService } from './services/moderation';
import { createModlogService } from './services/modlog';
import { PollService } from './services/polls';
import { ReactionRoleService } from './services/reaction-roles';
import { Scheduler } from './services/scheduler';
import { TicketService } from './services/tickets';
import { WelcomeService } from './services/welcome';

import type { BotContext } from './lib/command';

/** Segundos para o shutdown terminar antes de matar o processo (PRD §7.5). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  logger.info({ version: VERSION, env: env.NODE_ENV, tz: env.TZ }, 'boot');

  const { db, sql } = createDb(env.DATABASE_URL);
  const client = createClient();
  const config = new ConfigService(db);
  const queue = new LogQueue({ client });
  const logs = new LogService({ db, config, queue });
  const messageCache = new MessageCacheService({ db });
  const modlog = createModlogService({ db, client, logs, queue });
  const moderation = new ModerationService({ db, client, config, modlog });
  const automod = new AutomodService({ db, config, moderation, modlog });
  const locks = new LockService(db);
  const polls = new PollService({ db, client });
  const welcome = new WelcomeService({ config });
  const autorole = new AutoroleService({ db, config });
  const reactionRoles = new ReactionRoleService({ db, client, config });
  const tickets = new TicketService({ db, config });
  const scheduler = new Scheduler({ db, client, config, modlog, locks, polls, autorole });

  const ctx: BotContext = {
    client,
    db,
    config,
    moderation,
    automod,
    logs,
    modlog,
    locks,
    polls,
    welcome,
    autorole,
    reactionRoles,
    tickets,
    messageCache,
    logger,
    commands: loadCommands(commandList),
  };

  loadEvents(client, events, ctx);
  // Só começa a desfazer punições e a publicar logs depois do gateway abrir.
  client.once('clientReady', () => {
    scheduler.start();
    queue.start();
    messageCache.start();
    automod.start();
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'encerrando');

    const timer = setTimeout(() => {
      logger.error('shutdown excedeu o tempo limite; saindo à força');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    try {
      scheduler.stop();
      queue.stop();
      messageCache.stop();
      automod.stop();
      autorole.stop();
      // O que estava em buffer precisa chegar ao canal e ao banco antes do fim.
      await Promise.all([queue.flushAll(), messageCache.flush()]);
      await client.destroy();
      await sql.end({ timeout: 5 });
      logger.info('encerrado');
      logger.flush();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'erro ao encerrar');
      logger.flush();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Uma promise rejeitada solta nunca derruba o bot (PRD §7.5).
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaughtException');
  });

  await client.login(env.DISCORD_TOKEN);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'falha no boot');
  logger.flush();
  process.exit(1);
});
