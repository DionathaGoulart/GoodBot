import { deleteAutomodHitsBefore, getAutomodRules, recordAutomodHit } from '@cobot/db';
import {
  AUTOMOD_HITS_RETENTION_DAYS,
  AutomodRuleSchema,
  DAY_MS,
  MINUTE_MS,
  SECOND_MS,
} from '@cobot/shared';
import { PermissionFlagsBits } from 'discord.js';

import { botFooter, warningEmbed } from '../lib/embeds';
import { childLogger } from '../logger';
import { runActions } from './actions';
import { RaidService } from './raid';
import { MESSAGE_RULES, SpamTracker, WordMatcherCache } from './rules/index';

import type { AutomodRuntime, LoadedRule, MessageContext, Violation } from './types';
import type { ConfigService } from '../services/config';
import type { ModerationService } from '../services/moderation';
import type { ModlogService } from '../services/modlog';
import type { AutomodRuleRow, Db } from '@cobot/db';
import type { AutomodActionConfig, AutomodConfig, AutomodRuleType } from '@cobot/shared';
import type { Guild, GuildMember, Message, PartialMessage, User } from 'discord.js';

const log = childLogger('automod');

/** Passada que expira modos raid e limpa janelas de spam em memória. */
export const SWEEP_INTERVAL_MS = 30 * SECOND_MS;
/** Duração do `/raid on` quando não há regra anti-raid para copiar. */
export const DEFAULT_RAID_MINUTES = 10;

/** Por que uma mensagem não foi avaliada — vira `debug`, nunca erro. */
export type SkipReason =
  | 'module-disabled'
  | 'no-rules'
  | 'exempt-channel'
  | 'exempt-role'
  | 'exempt-moderator';

export interface AutomodDeps {
  db: Db;
  config: ConfigService;
  moderation: ModerationService;
  modlog: ModlogService;
  /** TTL do cache de regras (default 5 min, como o `ConfigService`). */
  ttl?: number;
  now?: () => number;
  sweepIntervalMs?: number;
  /** Hook de estatísticas por regra (§5.6). Preenchido na Etapa 10. */
  onHit?: (hit: { guildId: string; ruleId: string; type: AutomodRuleType }) => void;
}

interface CacheEntry {
  value: LoadedRule[];
  expiresAt: number;
}

/**
 * Motor do automod (PRD §5.2). Avalia as regras da guild em ordem de
 * prioridade e executa as ações da primeira que dispara — punir duas vezes a
 * mesma mensagem seria pior do que deixar a segunda regra passar.
 *
 * Nada aqui lança: o automod falhar não pode derrubar o `messageCreate`.
 */
export class AutomodService {
  private readonly deps: AutomodDeps;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly runtime: AutomodRuntime;
  private sweepTimer: NodeJS.Timeout | null = null;
  /** Público: os comandos `/raid` mexem no mesmo estado. */
  readonly raid: RaidService;

  constructor(deps: AutomodDeps) {
    this.deps = deps;
    this.ttl = deps.ttl ?? 5 * MINUTE_MS;
    this.now = deps.now ?? Date.now;
    this.raid = new RaidService(this.now);
    this.runtime = { spam: new SpamTracker(), words: new WordMatcherCache() };

    // Regra editada no painel ou por `/automod toggle` derruba o cache.
    this.deps.config.bus.subscribe((guildId, module) => {
      if (!module || module === 'automod') this.invalidate(guildId);
    });
  }

  start(): void {
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(
        () => void this.sweep(),
        this.deps.sweepIntervalMs ?? SWEEP_INTERVAL_MS,
      );
      this.sweepTimer.unref();
    }
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ── regras ────────────────────────────────────────────────────────────────

  /**
   * Regras da guild, validadas e em ordem de prioridade. Linha com jsonb
   * inválido é ignorada com `warn` — uma regra quebrada não pode desligar o
   * automod inteiro.
   */
  async getRules(guildId: string): Promise<LoadedRule[]> {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const rows = await getAutomodRules(this.deps.db, guildId);
    const value = rows.flatMap((row) => toLoadedRule(row) ?? []);
    this.cache.set(guildId, { value, expiresAt: this.now() + this.ttl });
    return value;
  }

  invalidate(guildId?: string): void {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
    // Um matcher compilado de uma regra que mudou é refeito na próxima leitura.
    this.runtime.words.clear();
  }

  config(guildId: string): Promise<AutomodConfig> {
    return this.deps.config.get(guildId, 'automod');
  }

  // ── mensagens ─────────────────────────────────────────────────────────────

  /** Ponto de entrada de `messageCreate` e `messageUpdate`. Nunca lança. */
  async handleMessage(
    message: Message | PartialMessage,
    options: { isEdit?: boolean } = {},
  ): Promise<LoadedRule | null> {
    try {
      return await this.evaluateMessage(message, options.isEdit ?? false);
    } catch (error) {
      log.error({ err: error, messageId: message.id }, 'falha ao avaliar a mensagem');
      return null;
    }
  }

  private async evaluateMessage(
    message: Message | PartialMessage,
    isEdit: boolean,
  ): Promise<LoadedRule | null> {
    const guild = message.guild;
    const author = message.author;
    if (!guild || !author || author.bot || author.system) return null;

    const config = await this.config(guild.id);
    if (!config.enabled) return null;
    if (isEdit && !config.checkEdits) return null;

    const rules = (await this.getRules(guild.id)).filter(
      (loaded) => loaded.rule.enabled && loaded.rule.type !== 'raid',
    );
    if (rules.length === 0) return null;

    const member = message.member ?? guild.members.cache.get(author.id) ?? null;
    const roleIds = member ? [...member.roles.cache.keys()] : [];
    const skip = globalExemption(config, {
      channelId: message.channelId,
      roleIds,
      isModerator: isModerator(member),
    });
    if (skip) {
      log.debug({ guildId: guild.id, reason: skip }, 'mensagem isenta do automod');
      return null;
    }

    const ctx: MessageContext = {
      guildId: guild.id,
      channelId: message.channelId,
      userId: author.id,
      messageId: message.id,
      content: message.content ?? '',
      mentionedUserIds: [...(message.mentions?.users.keys() ?? [])],
      mentionedRoleIds: [...(message.mentions?.roles.keys() ?? [])],
      mentionsEveryone: message.mentions?.everyone ?? false,
      canMentionEveryone: member?.permissions.has(PermissionFlagsBits.MentionEveryone) ?? false,
      timestamp: message.createdTimestamp ?? this.now(),
      isEdit,
    };

    for (const loaded of rules) {
      if (ruleExemption(loaded, { channelId: ctx.channelId, roleIds })) continue;

      const violation = this.check(loaded, ctx);
      if (!violation) continue;

      await this.applyHit({ guild, target: author, rule: loaded, violation, message });
      return loaded;
    }
    return null;
  }

  /** Avalia uma regra isolada. Pública para o `/automod test`. */
  check(loaded: LoadedRule, ctx: MessageContext): Violation | null {
    if (loaded.rule.type === 'raid') return null;
    const rule = MESSAGE_RULES[loaded.rule.type];
    return rule.check({
      ctx,
      // O `type` da regra e o da entrada do mapa são o mesmo; o TS não liga os dois.
      config: loaded.rule.config as never,
      ruleId: loaded.id,
      runtime: this.runtime,
    });
  }

  // ── entradas (anti-raid) ──────────────────────────────────────────────────

  /** Ponto de entrada de `guildMemberAdd`. Nunca lança. */
  async handleMemberAdd(member: GuildMember): Promise<LoadedRule | null> {
    try {
      return await this.evaluateJoin(member);
    } catch (error) {
      log.error({ err: error, guildId: member.guild.id }, 'falha ao avaliar a entrada');
      return null;
    }
  }

  private async evaluateJoin(member: GuildMember): Promise<LoadedRule | null> {
    const guild = member.guild;
    const config = await this.config(guild.id);
    if (!config.enabled) return null;
    if (member.user.bot) return null;

    const rules = await this.getRules(guild.id);

    for (const loaded of rules) {
      // O `continue` também estreita a regra para a variante `raid`.
      if (!loaded.rule.enabled || loaded.rule.type !== 'raid') continue;
      const raidConfig = loaded.rule.config;

      if (!this.raid.isActive(guild.id) && this.raid.recordJoin(guild.id, raidConfig)) {
        this.raid.activate({
          guildId: guild.id,
          source: 'auto',
          minutes: raidConfig.raidModeMinutes,
          ruleId: loaded.id,
        });
        log.warn({ guildId: guild.id, ruleId: loaded.id }, 'modo raid ativado automaticamente');
        if (raidConfig.alertModlog) {
          await this.alert(
            guild,
            'Modo raid ativado',
            `${raidConfig.joins} entradas em ${raidConfig.intervalSeconds}s. ` +
              `Novas entradas serão tratadas por **${raidConfig.action}** ` +
              `pelos próximos ${raidConfig.raidModeMinutes} minuto(s).`,
          );
        }
      }

      if (!this.raid.isActive(guild.id)) continue;

      // `require_account_age` só pune contas novas; as demais ações pegam todas.
      if (raidConfig.action === 'require_account_age') {
        const ageMs = this.now() - member.user.createdTimestamp;
        if (ageMs >= raidConfig.minAccountAgeDays * DAY_MS) continue;
      }

      const violation: Violation = {
        reason: 'Entrada durante modo raid.',
        detail:
          raidConfig.action === 'require_account_age'
            ? `conta com menos de ${raidConfig.minAccountAgeDays} dia(s)`
            : `ação ${raidConfig.action}`,
      };

      await this.applyHit({
        guild,
        target: member.user,
        rule: loaded,
        violation,
        actions: raidActions(loaded.rule.actions, raidConfig.action),
      });
      return loaded;
    }
    return null;
  }

  /** `/raid on [minutos]`: liga o modo manualmente e avisa o mod-log. */
  async enableRaidMode(guild: Guild, minutes?: number): Promise<number> {
    const rules = await this.getRules(guild.id);
    const raid = rules.find((loaded) => loaded.rule.type === 'raid');
    const fallback = raid?.rule.type === 'raid' ? raid.rule.config.raidModeMinutes : DEFAULT_RAID_MINUTES;
    const state = this.raid.activate({
      guildId: guild.id,
      source: 'manual',
      minutes: minutes ?? fallback,
    });
    await this.alert(
      guild,
      'Modo raid ativado',
      `Ativado manualmente até <t:${Math.floor(state.until / 1_000)}:t>.`,
    );
    return Math.round((state.until - this.now()) / MINUTE_MS);
  }

  async disableRaidMode(guild: Guild): Promise<boolean> {
    const wasActive = this.raid.deactivate(guild.id);
    if (wasActive) await this.alert(guild, 'Modo raid desativado', 'Desativado manualmente.');
    return wasActive;
  }

  // ── interno ───────────────────────────────────────────────────────────────

  private async applyHit(input: {
    guild: Guild;
    target: User;
    rule: LoadedRule;
    violation: Violation;
    message?: Message | PartialMessage;
    actions?: readonly AutomodActionConfig[];
  }): Promise<void> {
    const taken = await runActions({
      moderation: this.deps.moderation,
      modlog: this.deps.modlog,
      ...input,
    });

    log.info(
      {
        guildId: input.guild.id,
        ruleId: input.rule.id,
        type: input.rule.rule.type,
        targetId: input.target.id,
        actions: taken,
      },
      'regra de automod disparada',
    );

    try {
      await recordAutomodHit(this.deps.db, {
        guildId: input.guild.id,
        ruleId: input.rule.id,
        userId: input.target.id,
        channelId: input.message?.channelId ?? null,
        messageId: input.message?.id ?? null,
        actionTaken: taken.join(','),
      });
    } catch (error) {
      log.error({ err: error, ruleId: input.rule.id }, 'falha ao gravar o hit de automod');
    }

    this.deps.onHit?.({
      guildId: input.guild.id,
      ruleId: input.rule.id,
      type: input.rule.rule.type,
    });
  }

  /** Aviso no mod-log que não é um caso (PRD §5.4). */
  private async alert(guild: Guild, title: string, description: string): Promise<void> {
    const embed = warningEmbed({ title, description, footer: botFooter('ANTI-RAID') });
    await this.deps.modlog.postAction(guild.id, { embeds: [embed] });
  }

  /**
   * Job de retenção de `automod_hits` (PRD §8): 30 dias. Lança de propósito —
   * quem chama é o `RetentionJob`, que alerta quando a poda falha.
   */
  async cleanup(): Promise<number> {
    const before = new Date(this.now() - AUTOMOD_HITS_RETENTION_DAYS * DAY_MS);
    return deleteAutomodHitsBefore(this.deps.db, before);
  }

  /** Expira modos raid e descarta janelas de spam antigas. */
  async sweep(): Promise<void> {
    this.runtime.spam.sweep(this.now());
    for (const state of this.raid.expired()) {
      log.info({ guildId: state.guildId }, 'modo raid expirou');
    }
  }
}

// ── helpers puros ───────────────────────────────────────────────────────────

/** Converte a linha do banco na regra validada; `null` se o jsonb não bate. */
export function toLoadedRule(row: AutomodRuleRow): LoadedRule | null {
  const parsed = AutomodRuleSchema.safeParse({
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    priority: row.priority,
    config: row.config,
    actions: row.actions,
    exemptRoleIds: row.exemptRoleIds,
    exemptChannelIds: row.exemptChannelIds,
  });
  if (!parsed.success) {
    log.warn({ ruleId: row.id, type: row.type }, 'regra de automod inválida; ignorada');
    return null;
  }
  return { id: row.id, rule: parsed.data };
}

export interface ExemptionInput {
  channelId: string;
  roleIds: readonly string[];
  isModerator: boolean;
}

/** Isenções do módulo, aplicadas antes de qualquer regra (PRD §5.2). */
export function globalExemption(
  config: Pick<AutomodConfig, 'exemptChannelIds' | 'exemptRoleIds' | 'exemptModerators'>,
  input: ExemptionInput,
): SkipReason | null {
  if (config.exemptChannelIds.includes(input.channelId)) return 'exempt-channel';
  if (config.exemptRoleIds.some((id) => input.roleIds.includes(id))) return 'exempt-role';
  if (config.exemptModerators && input.isModerator) return 'exempt-moderator';
  return null;
}

/** Isenções da própria regra. */
export function ruleExemption(
  loaded: LoadedRule,
  input: { channelId: string; roleIds: readonly string[] },
): boolean {
  if (loaded.rule.exemptChannelIds.includes(input.channelId)) return true;
  return loaded.rule.exemptRoleIds.some((id) => input.roleIds.includes(id));
}

const MODERATOR_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageMessages,
] as const;

export function isModerator(member: GuildMember | null): boolean {
  if (!member) return false;
  return MODERATOR_PERMISSIONS.some((flag) => member.permissions.has(flag));
}

const PUNISHMENTS = new Set<AutomodActionConfig['type']>(['warn', 'timeout', 'kick', 'ban']);

/**
 * Ações efetivas de uma regra `raid`. As ações configuradas mandam; quando
 * nenhuma delas pune, o `config.action` (kick/ban) entra como punição padrão.
 * `require_account_age` não é punição: é o filtro de quem será punido.
 */
export function raidActions(
  actions: readonly AutomodActionConfig[],
  fallback: 'kick' | 'ban' | 'require_account_age',
): AutomodActionConfig[] {
  const list = [...actions];
  if (list.some((action) => PUNISHMENTS.has(action.type))) return list;
  if (fallback === 'ban') list.push({ type: 'ban', deleteMessageDays: 1 });
  else list.push({ type: 'kick' });
  return list;
}
