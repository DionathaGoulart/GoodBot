import { ensureGuildRow, incrementStatBuckets, setStatBucket } from '@goodbot/db';
import { HOUR_MS, MINUTE_MS, SECOND_MS } from '@goodbot/shared';

import { childLogger } from '../logger';

import type { ConfigService } from './config';
import type { Db, StatIncrement } from '@goodbot/db';
import type { CaseType, StatKind } from '@goodbot/shared';
import type {
  Client,
  Guild,
  GuildMember,
  Message,
  PartialGuildMember,
  VoiceState,
} from 'discord.js';

const log = childLogger('stats');

/** Flush padrão do agregador (`stats.flushIntervalSeconds` sobrescreve). */
export const FLUSH_INTERVAL_MS = 60 * SECOND_MS;
/** Passada que decide se o dia virou e precisa de um novo `members_total`. */
export const SNAPSHOT_INTERVAL_MS = 30 * MINUTE_MS;
/** Sessão de voz mais longa que isto é lixo de reconexão, não tempo em call. */
export const MAX_VOICE_SESSION_MS = 12 * HOUR_MS;

/** Chave de um bucket na memória. `|` não aparece em id nem em nome de regra. */
function bucketKey(row: StatIncrement): string {
  return [row.guildId, row.kind, row.key, row.bucketStart.getTime(), row.granularity].join('|');
}

/** Início da hora UTC do instante. Toda contagem de evento nasce horária. */
export function startOfHour(at: Date | number): Date {
  return new Date(Math.floor(new Date(at).getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * Deslocamento do fuso (em ms) no instante dado. `Intl` é a única fonte que
 * conhece horário de verão sem uma tabela nossa.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // Os ms não aparecem nas partes; zerá-los dos dois lados mantém a conta exata.
  return asUtc - Math.floor(at.getTime() / SECOND_MS) * SECOND_MS;
}

/**
 * Meia-noite local do dia de `at`, como instante UTC. Fuso inválido cai em
 * UTC — um snapshot no dia errado é melhor do que um `RangeError` no timer.
 */
export function startOfDayInZone(at: Date, timeZone: string): Date {
  let offset: number;
  try {
    offset = zoneOffsetMs(at, timeZone);
  } catch {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  }
  const local = new Date(at.getTime() + offset);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // O dia pode começar num offset diferente do de agora (virada do horário de
  // verão): recalcula uma vez com o offset do próprio início do dia.
  const atMidnight = zoneOffsetMs(new Date(midnight - offset), timeZone);
  return new Date(midnight - atMidnight);
}

/** `YYYY-MM-DD` local — identidade do dia para o snapshot de membros. */
export function localDayKey(at: Date, timeZone: string): string {
  const start = startOfDayInZone(at, timeZone);
  let offset = 0;
  try {
    offset = zoneOffsetMs(start, timeZone);
  } catch {
    offset = 0;
  }
  return new Date(start.getTime() + offset).toISOString().slice(0, 10);
}

/** Hora local (0–23) no fuso da guild; fuso inválido cai em UTC. */
export function localHour(at: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).format(at),
    );
  } catch {
    return at.getUTCHours();
  }
}

export interface StatsDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  /** Sobrescreve o intervalo de flush (testes e dev). */
  flushIntervalMs?: number;
  /**
   * Chamado quando um lote não conseguiu ser gravado. O flush continua sem
   * lançar (contar é menos importante do que ficar de pé), mas alguém precisa
   * ficar sabendo — o `index.ts` liga isto no webhook de alertas (PRD §11).
   */
  onFlushError?: (error: unknown, buckets: number) => void;
  snapshotIntervalMs?: number;
  now?: () => number;
}

/**
 * Coleta de estatísticas (PRD §5.6). Os eventos são somados **em memória** e
 * gravados em lote a cada minuto: um `INSERT` por mensagem torraria o free
 * tier do Postgres (PRD §7.2).
 *
 * Nenhum método lança — perder uma contagem é aceitável, derrubar o
 * `messageCreate` não é.
 */
export class StatsService {
  private readonly deps: StatsDeps;
  private readonly now: () => number;
  /** Contadores aditivos (eventos). */
  private pending = new Map<string, StatIncrement>();
  /** Snapshots (substituem, não somam): hoje só `members_total`. */
  private snapshots = new Map<string, StatIncrement>();
  /** Entrada em voz por `guildId:userId`, para fechar a sessão na saída. */
  private readonly voice = new Map<string, { channelId: string; since: number }>();
  /** Último dia (local) já fotografado, por guild. */
  private readonly lastSnapshotDay = new Map<string, string>();
  /** Guilds cuja linha em `guilds` já foi garantida nesta execução. */
  private readonly ensured = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs: number;
  private flushing = false;

  constructor(deps: StatsDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.flushIntervalMs = deps.flushIntervalMs ?? FLUSH_INTERVAL_MS;
  }

  /**
   * Aplica `stats.flushIntervalSeconds`. O timer é do processo e a config é
   * por guild, então o `ready` aplica aqui o **menor** intervalo entre as
   * guilds configuradas — quem pede flush mais frequente é atendido, e as
   * outras só ganham flushes mais curtos do que pediram.
   */
  setFlushInterval(seconds: number): void {
    const next = seconds * SECOND_MS;
    if (next === this.flushIntervalMs) return;
    this.flushIntervalMs = next;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.startFlushTimer();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.flushTimer.unref();
  }

  start(): void {
    this.startFlushTimer();
    if (!this.snapshotTimer) {
      this.snapshotTimer = setInterval(
        () => void this.snapshotAllGuilds(),
        this.deps.snapshotIntervalMs ?? SNAPSHOT_INTERVAL_MS,
      );
      this.snapshotTimer.unref();
    }
    // O boot também conta: um restart depois da meia-noite não pode ficar sem
    // o snapshot do dia.
    void this.snapshotAllGuilds();
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.flushTimer = null;
    this.snapshotTimer = null;
  }

  // ── agregação ─────────────────────────────────────────────────────────────

  /**
   * Soma `amount` no bucket da hora corrente. Síncrono de propósito: os hooks
   * chamam isto no caminho quente do evento.
   */
  increment(guildId: string, kind: StatKind, key = '_', amount = 1): void {
    if (amount <= 0) return;
    const row: StatIncrement = {
      guildId,
      kind,
      key,
      bucketStart: startOfHour(this.now()),
      granularity: 'hour',
      count: amount,
    };
    const id = bucketKey(row);
    const existing = this.pending.get(id);
    if (existing) existing.count += amount;
    else this.pending.set(id, row);
  }

  /** Valor absoluto de um dia (`members_total`); o último a chegar vence. */
  snapshot(guildId: string, kind: StatKind, value: number, day: Date, key = '_'): void {
    const row: StatIncrement = {
      guildId,
      kind,
      key,
      bucketStart: day,
      granularity: 'day',
      count: value,
    };
    this.snapshots.set(bucketKey(row), row);
  }

  /** Quantos buckets esperam o próximo flush (testes e diagnóstico). */
  get pendingSize(): number {
    return this.pending.size + this.snapshots.size;
  }

  /** Grava o que está em memória. Nunca lança. */
  async flush(): Promise<number> {
    if (this.flushing) return 0;
    const rows = [...this.pending.values()];
    const snaps = [...this.snapshots.values()];
    if (rows.length === 0 && snaps.length === 0) return 0;

    this.flushing = true;
    this.pending = new Map();
    this.snapshots = new Map();
    try {
      for (const guildId of new Set([...rows, ...snaps].map((row) => row.guildId))) {
        await this.ensureGuild(guildId);
      }

      await incrementStatBuckets(this.deps.db, rows);
      for (const snap of snaps) await setStatBucket(this.deps.db, snap);

      log.debug({ buckets: rows.length, snapshots: snaps.length }, 'stats gravadas');
      return rows.length + snaps.length;
    } catch (error) {
      log.error({ err: error, buckets: rows.length }, 'falha ao gravar as stats');
      this.deps.onFlushError?.(error, rows.length + snaps.length);
      // O lote volta para a memória: o próximo flush tenta de novo.
      for (const row of rows) this.restore(this.pending, row);
      for (const snap of snaps) this.snapshots.set(bucketKey(snap), snap);
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  private restore(target: Map<string, StatIncrement>, row: StatIncrement): void {
    const id = bucketKey(row);
    const existing = target.get(id);
    if (existing) existing.count += row.count;
    else target.set(id, row);
  }

  private async ensureGuild(guildId: string): Promise<void> {
    if (this.ensured.has(guildId)) return;
    await ensureGuildRow(this.deps.db, guildId);
    this.ensured.add(guildId);
  }

  // ── hooks ─────────────────────────────────────────────────────────────────

  /** Config do módulo, ou `null` quando ele está desligado. */
  private async settingsFor(guildId: string) {
    try {
      const config = await this.deps.config.get(guildId, 'stats');
      return config.enabled ? config : null;
    } catch (error) {
      log.error({ err: error, guildId }, 'falha ao ler a config de stats');
      return null;
    }
  }

  async recordMessage(message: Message): Promise<void> {
    const guildId = message.guildId;
    if (!guildId || message.author.bot) return;
    const config = await this.settingsFor(guildId);
    if (!config?.trackMessages) return;
    if (config.ignoredChannelIds.includes(message.channelId)) return;

    this.increment(guildId, 'messages_channel', message.channelId);
    if (config.trackTopUsers) this.increment(guildId, 'messages_user', message.author.id);
  }

  async recordJoin(member: GuildMember): Promise<void> {
    if (!(await this.settingsFor(member.guild.id))) return;
    this.increment(member.guild.id, 'joins');
  }

  async recordLeave(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!(await this.settingsFor(member.guild.id))) return;
    this.increment(member.guild.id, 'leaves');
  }

  async recordCase(guildId: string, type: CaseType): Promise<void> {
    if (!(await this.settingsFor(guildId))) return;
    this.increment(guildId, 'cases_type', type);
  }

  async recordAutomodHit(guildId: string, ruleId: string): Promise<void> {
    if (!(await this.settingsFor(guildId))) return;
    this.increment(guildId, 'automod_rule', ruleId);
  }

  async recordCommand(guildId: string, name: string): Promise<void> {
    const config = await this.settingsFor(guildId);
    if (!config?.trackCommands) return;
    this.increment(guildId, 'commands', name);
  }

  async recordTicketOpen(guildId: string): Promise<void> {
    if (!(await this.settingsFor(guildId))) return;
    this.increment(guildId, 'tickets_open');
  }

  async recordTicketClose(guildId: string): Promise<void> {
    if (!(await this.settingsFor(guildId))) return;
    this.increment(guildId, 'tickets_closed');
  }

  /**
   * Minutos em voz. O tempo entra na conta no fechamento da sessão (saída ou
   * troca de canal), porque só aí a duração existe; a sessão aberta durante um
   * restart é simplesmente perdida.
   */
  async recordVoice(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const guildId = newState.guild.id;
    if (newState.member?.user.bot) return;
    const before = oldState.channelId;
    const after = newState.channelId;
    if (before === after) return;

    const config = await this.settingsFor(guildId);
    if (!config?.trackVoice) return;

    const key = `${guildId}:${newState.id}`;
    if (before) this.closeVoiceSession(guildId, key, config.ignoredChannelIds);
    if (after && !config.ignoredChannelIds.includes(after)) {
      this.voice.set(key, { channelId: after, since: this.now() });
    }
  }

  private closeVoiceSession(guildId: string, key: string, ignored: readonly string[]): void {
    const session = this.voice.get(key);
    this.voice.delete(key);
    if (!session || ignored.includes(session.channelId)) return;
    const elapsed = this.now() - session.since;
    if (elapsed <= 0 || elapsed > MAX_VOICE_SESSION_MS) return;
    const minutes = Math.floor(elapsed / MINUTE_MS);
    if (minutes > 0) this.increment(guildId, 'voice_minutes_channel', session.channelId, minutes);
  }

  // ── snapshot de membros ───────────────────────────────────────────────────

  /** Fotografa `members_total` das guilds em cache quando o dia local virou. */
  async snapshotAllGuilds(): Promise<void> {
    for (const guild of this.deps.client.guilds.cache.values()) {
      await this.snapshotMembers(guild).catch((error: unknown) => {
        log.error({ err: error, guildId: guild.id }, 'falha no snapshot de membros');
      });
    }
  }

  /** Um snapshot por dia local; chamadas extras no mesmo dia não custam nada. */
  async snapshotMembers(guild: Guild): Promise<boolean> {
    if (!(await this.settingsFor(guild.id))) return false;
    const { timezone } = await this.deps.config.getSettings(guild.id);
    const at = new Date(this.now());
    const day = localDayKey(at, timezone);
    if (this.lastSnapshotDay.get(guild.id) === day) return false;

    this.lastSnapshotDay.set(guild.id, day);
    this.snapshot(guild.id, 'members_total', guild.memberCount, startOfDayInZone(at, timezone));
    return true;
  }
}
