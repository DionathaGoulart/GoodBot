import { createDb, getStorageUsage } from '@goodbot/db';
import { subdomainUrl, VERSION } from '@goodbot/shared';
import { sql } from 'drizzle-orm';

import { createApiServer } from './api/server';
import { AutomodService } from './automod/engine';
import { createClient } from './client';
import { commands as commandList } from './commands/index';
import { env } from './env';
import { events } from './events/index';
import { CapacityJob } from './jobs/capacity';
import { DemoExpiryJob } from './jobs/demo-expiry';
import { PendingExpiryJob } from './jobs/pending-expiry';
import { RetentionJob } from './jobs/retention';
import { SocialJob } from './jobs/social';
import { SquadsJob } from './jobs/squads';
import { StatsRollupJob } from './jobs/stats-rollup';
import { recordError } from './lib/error-log';
import { loadCommands, loadEvents } from './lib/loader';
import { logger } from './logger';
import { metrics } from './metrics';
import { AlertService } from './services/alerts';
import { AuditService } from './services/audit';
import { AutoroleService } from './services/autorole';
import { ConfigService } from './services/config';
import { DeployNoticeService } from './services/deploy-notice';
import { LockService } from './services/locks';
import { LogQueue } from './services/log-queue';
import { LogService } from './services/logs';
import { MaintenanceService } from './services/maintenance';
import { MessageCacheService } from './services/message-cache';
import { ModerationService } from './services/moderation';
import { createModlogService } from './services/modlog';
import { PollService } from './services/polls';
import { ReactionRoleService } from './services/reaction-roles';
import { RegistryService } from './services/registry';
import { Scheduler } from './services/scheduler';
import { YouTubeProvider } from './services/social/index';
import { SquadService } from './services/squads/index';
import { StatsService } from './services/stats';
import { TicketService } from './services/tickets';
import { WelcomeService } from './services/welcome';

import type { BotContext } from './lib/command';
import type { Db } from '@goodbot/db';
import type { Client } from 'discord.js';

/** Segundos para o shutdown terminar antes de matar o processo (PRD §7.5). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Quanto tempo o gateway pode ficar fora antes de virar alerta (PRD §11). O
 * discord.js reconecta sozinho em segundos; passou de um minuto, é problema.
 */
const GATEWAY_DOWN_ALERT_MS = 60_000;

/** Intervalo do ping no Postgres gerenciado. */
const DATABASE_PROBE_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  logger.info({ version: VERSION, env: env.NODE_ENV, tz: env.TZ }, 'boot');

  const { db, sql } = createDb(env.DATABASE_URL);
  const client = createClient();
  const alerts = new AlertService({ webhookUrl: env.ALERT_WEBHOOK_URL });
  const config = new ConfigService(db);
  // Quem o bot atende. Espelho em memória: o handler de interação consulta a
  // cada evento e não pode pagar uma query por isso.
  const registry = new RegistryService({ db });
  // Modo manutenção. Mesmo desenho do registro, e pelo mesmo motivo: é lido
  // em toda interação e não pode custar uma query por evento.
  const maintenance = new MaintenanceService({ db });
  // O aviso de manutenção do deploy: o bot velho publica, este processo, ao
  // subir, troca por "voltou".
  const deployNotice = new DeployNoticeService({ client, db, registry, config });
  // A trilha do que o bot faz sozinho (§6.5); o painel escreve na mesma tabela.
  const audit = new AuditService({ db, client });
  const queue = new LogQueue({ client });
  const logs = new LogService({ db, config, queue });
  const messageCache = new MessageCacheService({ db });
  const modlog = createModlogService({ db, client, logs, queue });
  const stats = new StatsService({
    db,
    client,
    config,
    onFlushError: (error, buckets) => {
      alerts.emit({
        kind: 'stats-flush',
        title: 'Falha ao gravar estatísticas',
        description: describeError(error),
        level: 'warning',
        fields: [{ name: 'Buckets represados', value: String(buckets) }],
      });
    },
  });
  const moderation = new ModerationService({
    db,
    client,
    config,
    modlog,
    onCase: (kase) => {
      stats.recordCase(kase.guildId, kase.type);
      // `automod` e `dashboard` já têm a sua própria linha (o hit da regra e o
      // `withAudit` do painel); registrar de novo aqui duplicaria a história.
      if (kase.source === 'automod' || kase.source === 'dashboard') return;
      audit.record({
        guildId: kase.guildId,
        action: `case.${kase.type}`,
        source: kase.source === 'escalation' ? 'job' : 'command',
        actor: { id: kase.actorId, tag: kase.actorTag },
        target: { type: 'member', id: kase.targetId },
        reason: kase.reason,
        after: {
          caseNumber: kase.caseNumber,
          targetTag: kase.targetTag,
          durationMs: kase.durationMs,
        },
      });
    },
  });
  const automod = new AutomodService({
    db,
    config,
    moderation,
    modlog,
    audit,
    onHit: (hit) => void stats.recordAutomodHit(hit.guildId, hit.ruleId),
  });
  const locks = new LockService(db);
  const polls = new PollService({ db, client });
  const welcome = new WelcomeService({ config });
  const autorole = new AutoroleService({ db, config, audit });
  const reactionRoles = new ReactionRoleService({ db, client, config });
  const tickets = new TicketService({
    db,
    config,
    onOpen: (ticket) => {
      stats.recordTicketOpen(ticket.guildId);
      audit.record({
        guildId: ticket.guildId,
        action: 'ticket.open',
        source: 'event',
        actor: ticket.userId,
        target: { type: 'ticket', id: String(ticket.number) },
        after: { channelId: ticket.channelId, typeId: ticket.typeId },
      });
    },
    onClose: (ticket) => {
      stats.recordTicketClose(ticket.guildId);
      audit.record({
        guildId: ticket.guildId,
        action: 'ticket.close',
        source: 'event',
        ...(ticket.closedBy ? { actor: ticket.closedBy } : {}),
        target: { type: 'ticket', id: String(ticket.number) },
        reason: ticket.closeReason,
        after: { channelId: ticket.channelId, transcriptUrl: ticket.transcriptUrl },
      });
    },
  });
  const social = new YouTubeProvider();
  // Squads fixos: comandos, botões e o evento de voz usam pelo `ctx`; o job
  // cuida do relógio (propostas vencidas, sessões, voice e inatividade).
  const squads = new SquadService({ db, client, config, audit });
  const squadsJob = new SquadsJob({
    db,
    client,
    config,
    squads,
    guildIds: () => registry.servedGuildIds(),
  });
  const scheduler = new Scheduler({ db, client, config, modlog, locks, polls, autorole });
  const socialJob = new SocialJob({ db, client, config, provider: social, alerts, audit });
  // Os links que os avisos de ciclo de vida citam. Saem do `AUTH_URL` pela
  // mesma conta que o painel faz para os subdomínios — uma regra só, em
  // `shared`, senão o link do convite deixa de bater com o Developer Portal.
  const siteUrls = {
    invite: env.AUTH_URL ? subdomainUrl(env.AUTH_URL, 'invite') : null,
    panel: env.AUTH_URL ?? null,
  };
  // O fim da demo: avisa quem convidou, se despede no servidor e sai.
  const demoExpiry = new DemoExpiryJob({ db, client, alerts, urls: siteUrls });
  // A recusa por inatividade: convite parado na fila além do prazo.
  const pendingExpiry = new PendingExpiryJob({ db, client, alerts, urls: siteUrls });
  const statsRollup = new StatsRollupJob({ db, client, config });
  // As retenções do PRD §8 num job só, porque é ele que alerta na falha.
  const retention = new RetentionJob({
    alerts,
    tasks: [
      { name: 'message_cache', run: () => messageCache.cleanup() },
      { name: 'automod_hits', run: () => automod.cleanup() },
      { name: 'stats_rollup', run: () => runStatsRollup(statsRollup, client) },
      // `social_posts` não entra aqui: podar a linha faria um vídeo que ainda
      // está no feed voltar a ser "novo" e ser anunciado outra vez.
    ],
  });
  // RAM do container e cota do Supabase: avisa antes de um dos dois parar o bot.
  const capacity = new CapacityJob({ alerts, readStorage: () => getStorageUsage(db) });
  // A coleção nasce antes do `ctx` porque a API também a expõe (`GET /commands`).
  const commands = loadCommands(commandList);
  const readQueues = () => ({
    logQueue: queue.pendingSize,
    messageCache: messageCache.pendingSize,
    stats: stats.pendingSize,
  });
  const api = createApiServer({
    deps: {
      client,
      db,
      config,
      moderation,
      automod,
      reactionRoles,
      tickets,
      social,
      squads,
      commands,
      registry,
      maintenance,
      deployNotice,
    },
    token: env.INTERNAL_API_TOKEN,
    port: env.INTERNAL_API_PORT,
    // Sem isto o /health continuaria esperando uma guild só e acusaria
    // degradação assim que o segundo servidor entrasse.
    expectedGuilds: () => registry.servedCount(),
    queues: readQueues,
    backupDir: env.BACKUP_DIR,
    alerts,
    urls: siteUrls,
    admin: {
      ...(env.OWNER_DISCORD_ID ? { ownerId: env.OWNER_DISCORD_ID } : {}),
      discordToken: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
    },
  });

  registerGauges({
    client,
    readQueues,
    readCachedChannels: () => messageCache.channelsInMemory,
    startedAt: Date.now(),
  });
  const databaseProbe = watchDatabase(db, alerts);

  const ctx: BotContext = {
    client,
    db,
    config,
    registry,
    maintenance,
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
    social,
    squads,
    messageCache,
    stats,
    audit,
    logger,
    commands,
  };

  loadEvents(client, events, ctx);
  watchGateway(client, alerts);
  // A API sobe antes do login: o healthcheck do container precisa responder
  // mesmo enquanto o gateway ainda está conectando (PRD §5.7).
  api.start();
  // Só começa a desfazer punições e a publicar logs depois do gateway abrir.
  client.once('clientReady', () => {
    registry.start();
    maintenance.start();
    scheduler.start();
    queue.start();
    messageCache.start();
    automod.start();
    stats.start();
    statsRollup.start();
    socialJob.start();
    squadsJob.start();
    demoExpiry.start();
    pendingExpiry.start();
    retention.start();
    capacity.start();
    databaseProbe.start();
    void deployNotice.resolve();
    alerts.emit({
      kind: 'boot',
      title: 'Bot no ar',
      level: 'success',
      force: true,
      fields: [
        { name: 'Versão', value: `v${VERSION}` },
        { name: 'Commit', value: env.GIT_SHA ?? 'local' },
      ],
    });
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
      registry.stop();
      maintenance.stop();
      scheduler.stop();
      queue.stop();
      messageCache.stop();
      automod.stop();
      stats.stop();
      statsRollup.stop();
      socialJob.stop();
      squadsJob.stop();
      demoExpiry.stop();
      pendingExpiry.stop();
      retention.stop();
      capacity.stop();
      databaseProbe.stop();
      autorole.stop();
      await api.stop();
      // O que estava em buffer precisa chegar ao canal e ao banco antes do fim.
      await Promise.all([queue.flushAll(), messageCache.flush(), stats.flush()]);
      await client.destroy();
      await sql.end({ timeout: 5 });
      // Espera o alerta: depois do `process.exit` não sai mais nada.
      await alerts.send({
        kind: 'shutdown',
        title: 'Bot encerrando',
        description: `Sinal \`${signal}\`.`,
        level: 'info',
        force: true,
      });
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

  // Uma promise rejeitada solta nunca derruba o bot (PRD §7.5). O alerta usa a
  // janela de dedupe de 5 min: um erro em loop não vira 300 mensagens no canal.
  process.on('unhandledRejection', (reason) => {
    recordError('unhandledRejection', reason);
    logger.error({ err: reason }, 'unhandledRejection');
    alerts.emit({
      kind: 'unhandledRejection',
      title: 'Promise rejeitada sem tratamento',
      description: describeError(reason),
      level: 'danger',
    });
  });
  process.on('uncaughtException', (error) => {
    recordError('uncaughtException', error);
    logger.fatal({ err: error }, 'uncaughtException');
    alerts.emit({
      kind: 'uncaughtException',
      title: 'Exceção não capturada',
      description: describeError(error),
      level: 'danger',
    });
  });

  // A semeadura roda antes do login: quando o primeiro evento chegar, o
  // espelho do registro já precisa estar quente. `GUILD_IDS` só entra aqui, e
  // só para quem ainda não tem linha (ver `seedApprovedGuilds`).
  await registry.seed(env.guildIds);
  // Antes do login: a primeira interação já precisa saber se há manutenção.
  await maintenance.refresh();

  await client.login(env.DISCORD_TOKEN);
}

/**
 * Gauges lidos no scrape do `/metrics`. Ficam registrados uma vez: os
 * `Gauge` do registry guardam a função, não o valor.
 */
function registerGauges(input: {
  client: Client;
  readQueues: () => { logQueue: number; messageCache: number; stats: number };
  /** Canais no LRU do cache de mensagens: a parte da RAM que cresce com o tráfego. */
  readCachedChannels: () => number;
  startedAt: number;
}): void {
  metrics.queue.register(() => input.readQueues().logQueue, { queue: 'log' });
  metrics.queue.register(() => input.readQueues().messageCache, { queue: 'message_cache' });
  metrics.queue.register(() => input.readQueues().stats, { queue: 'stats' });
  metrics.process.register(() => process.memoryUsage().rss, { kind: 'rss_bytes' });
  metrics.process.register(() => process.memoryUsage().heapUsed, { kind: 'heap_used_bytes' });
  metrics.process.register(() => Date.now() - input.startedAt, { kind: 'uptime_ms' });
  metrics.process.register(input.readCachedChannels, { kind: 'message_cache_channels' });
  metrics.gateway.register(() => (input.client.isReady() ? 1 : 0), { kind: 'ready' });
  metrics.gateway.register(
    () => {
      const ping = input.client.ws.ping;
      return Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : -1;
    },
    { kind: 'ping_ms' },
  );
  metrics.gateway.register(() => input.client.guilds.cache.size, { kind: 'guilds' });
}

/**
 * Alerta quando o gateway fica fora por mais de um minuto e quando volta.
 * A reconexão do discord.js é normal e frequente; o que importa é a queda que
 * dura (PRD §11).
 */
function watchGateway(client: Client, alerts: AlertService): void {
  let downSince: number | null = null;
  let timer: NodeJS.Timeout | null = null;
  let alerted = false;

  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  client.on('shardDisconnect', () => {
    if (downSince !== null) return;
    downSince = Date.now();
    clear();
    timer = setTimeout(() => {
      alerted = true;
      alerts.emit({
        kind: 'gateway-down',
        title: 'Gateway desconectado',
        description: 'O bot está fora do Discord há mais de 60s e ainda não reconectou.',
        level: 'danger',
        force: true,
      });
    }, GATEWAY_DOWN_ALERT_MS);
    timer.unref();
  });

  const back = (): void => {
    const since = downSince;
    downSince = null;
    clear();
    if (!alerted) return;
    alerted = false;
    alerts.emit({
      kind: 'gateway-up',
      title: 'Gateway reconectado',
      description:
        since === null
          ? 'O bot voltou ao Discord.'
          : `O bot voltou ao Discord após ${String(Math.round((Date.now() - since) / 1000))}s fora.`,
      level: 'success',
      force: true,
    });
  };

  client.on('shardResume', back);
  client.on('shardReady', back);
}

/**
 * Ping periódico no Postgres gerenciado. Desde a v1.1 o banco está do outro
 * lado da rede (Supabase) e a conexão virou um ponto de falha real: uma pausa
 * do projeto por inatividade ou uma queda de rede precisa gerar alerta, não
 * só erros espalhados pelos handlers (PRD §11).
 */
function watchDatabase(db: Db, alerts: AlertService) {
  let timer: NodeJS.Timeout | null = null;
  let down = false;

  const probe = async (): Promise<void> => {
    const start = performance.now();
    try {
      await db.execute(sql`select 1`);
      metrics.dbLatency.observe(Math.round(performance.now() - start), { probe: 'health' });
      if (!down) return;
      down = false;
      alerts.emit({
        kind: 'database-up',
        title: 'Postgres respondendo de novo',
        level: 'success',
        force: true,
      });
    } catch (error) {
      logger.error({ err: error }, 'falha ao falar com o Postgres');
      down = true;
      alerts.emit({
        kind: 'database-down',
        title: 'Postgres inacessível',
        description: describeError(error),
        level: 'danger',
      });
    }
  };

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => void probe(), DATABASE_PROBE_INTERVAL_MS);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Roda o rollup em todas as guilds do cache e soma o que foi removido. */
async function runStatsRollup(job: StatsRollupJob, client: Client): Promise<number> {
  let removed = 0;
  for (const guild of client.guilds.cache.values()) {
    removed += await job.runFor(guild.id);
  }
  return removed;
}

/** Mensagem curta de um erro para o embed do alerta — nunca a stack inteira. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `\`\`\`\n${message.slice(0, 500)}\n\`\`\``;
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'falha no boot');
  logger.flush();
  process.exit(1);
});
