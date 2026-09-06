import { cancelScheduledActions, createCase, scheduleAction, softDeleteCase } from '@cobot/db';
import {
  DAY_MS,
  MAX_REASON_LENGTH,
  MAX_TIMEOUT_MS,
  UserFacingError,
  formatDuration,
} from '@cobot/shared';
import { DiscordAPIError } from 'discord.js';

import { childLogger } from '../logger';
import { sendPunishmentDm } from './dm';
import { resolveEscalation } from './escalation';
import { canActOn, toMemberLike } from './permissions';

import type { ConfigService, ResolvedSettings } from './config';
import type { EscalationStep } from './escalation';
import type { ModlogService } from './modlog';
import type { Case, Db } from '@cobot/db';
import type { CaseSource, CaseType, DmOnPunish, ModerationConfig } from '@cobot/shared';
import type { Client, Guild, GuildMember, User } from 'discord.js';

const log = childLogger('moderation');

/** Dias de mensagens apagadas → segundos, como o Discord espera no ban. */
const DAY_SECONDS = 24 * 60 * 60;

export interface ModerationDeps {
  db: Db;
  client: Client;
  config: ConfigService;
  modlog: ModlogService;
  /** Hook de estatísticas por tipo de caso (§5.6). */
  onCase?: (kase: Case) => void;
}

/**
 * Uma ação de moderação, venha ela de um slash command, do menu de contexto,
 * da API do bot (painel) ou do automod. `actor` ausente = o próprio bot agindo
 * (scheduler e escalada).
 */
export interface ActionRequest {
  guild: Guild;
  target: User;
  actor?: GuildMember;
  reason?: string;
  source?: CaseSource;
  automodRuleId?: string;
}

export interface TimedRequest extends ActionRequest {
  /** Presente = tempban / timeout com expiração agendada. */
  durationMs?: number;
}

export interface BanRequest extends TimedRequest {
  /** 0–7; o default vem de `moderation.banDeleteMessageDaysDefault`. */
  deleteMessageDays?: number;
}

export interface ActionResult {
  case: Case;
  /** `false` quando a DM estava fechada ou a config não pede DM. */
  dmSent: boolean;
  /** Preenchido só em `warn`, quando um degrau de escalada disparou. */
  escalation?: { step: EscalationStep; case: Case } | null;
}

interface ExecuteInput extends TimedRequest {
  type: CaseType;
  /** Ação no Discord. Roda depois do caso criado e da DM enviada. */
  perform: (audit: string) => Promise<void>;
  /** `false` para `note` e para as ações que o alvo não deve saber. */
  dm?: boolean;
  /** Agenda o desfazimento quando há duração. */
  schedule?: 'unban' | 'untimeout';
}

/**
 * Executa punições e mantém o histórico de casos. É o único caminho que cria
 * casos: comandos, menu de contexto, automod e painel entram todos por aqui,
 * variando só o `source`.
 */
export class ModerationService {
  private readonly deps: ModerationDeps;
  private readonly db: Db;
  private readonly client: Client;
  private readonly config: ConfigService;
  /** Público: `/case edit` precisa atualizar a mensagem já publicada. */
  readonly modlog: ModlogService;

  constructor(deps: ModerationDeps) {
    this.deps = deps;
    this.db = deps.db;
    this.client = deps.client;
    this.config = deps.config;
    this.modlog = deps.modlog;
  }

  // ── ações ─────────────────────────────────────────────────────────────────

  async ban(request: BanRequest): Promise<ActionResult> {
    const config = await this.moderationConfig(request.guild.id);
    const days = request.deleteMessageDays ?? config.banDeleteMessageDaysDefault;
    const { guild, target } = request;

    return this.execute({
      ...request,
      type: 'ban',
      schedule: 'unban',
      perform: async (audit) => {
        await guild.bans.create(target.id, {
          reason: audit,
          deleteMessageSeconds: days * DAY_SECONDS,
        });
      },
    });
  }

  async unban(request: ActionRequest): Promise<ActionResult> {
    const { guild, target } = request;
    const result = await this.execute({
      ...request,
      type: 'unban',
      dm: false,
      perform: async (audit) => {
        await guild.bans.remove(target.id, audit);
      },
    });
    // Um unban manual antes da hora não pode deixar um `unban` agendado solto.
    await cancelScheduledActions(this.db, {
      guildId: guild.id,
      kind: 'unban',
      targetId: target.id,
    });
    return result;
  }

  async softban(request: BanRequest): Promise<ActionResult> {
    const config = await this.moderationConfig(request.guild.id);
    const days = request.deleteMessageDays ?? Math.max(config.banDeleteMessageDaysDefault, 1);
    const { guild, target } = request;

    return this.execute({
      ...request,
      type: 'softban',
      durationMs: undefined,
      perform: async (audit) => {
        await guild.bans.create(target.id, {
          reason: audit,
          deleteMessageSeconds: days * DAY_SECONDS,
        });
        await guild.bans.remove(target.id, `softban: ${audit}`);
      },
    });
  }

  async kick(request: ActionRequest): Promise<ActionResult> {
    const { guild, target } = request;
    return this.execute({
      ...request,
      type: 'kick',
      perform: async (audit) => {
        const member = await fetchMember(guild, target.id);
        if (!member) {
          throw new UserFacingError('Este usuário não está no servidor.', { code: 'NOT_MEMBER' });
        }
        await member.kick(audit);
      },
    });
  }

  async timeout(request: TimedRequest): Promise<ActionResult> {
    const durationMs = request.durationMs ?? DAY_MS;
    if (durationMs > MAX_TIMEOUT_MS) {
      throw new UserFacingError(
        `O timeout do Discord vai até ${formatDuration(MAX_TIMEOUT_MS, { style: 'long' })}.`,
        { code: 'TIMEOUT_TOO_LONG' },
      );
    }
    const { guild, target } = request;

    return this.execute({
      ...request,
      type: 'timeout',
      durationMs,
      schedule: 'untimeout',
      perform: async (audit) => {
        const member = await fetchMember(guild, target.id);
        if (!member) {
          throw new UserFacingError('Este usuário não está no servidor.', { code: 'NOT_MEMBER' });
        }
        await member.timeout(durationMs, audit);
      },
    });
  }

  async untimeout(request: ActionRequest): Promise<ActionResult> {
    const { guild, target } = request;
    const result = await this.execute({
      ...request,
      type: 'untimeout',
      perform: async (audit) => {
        const member = await fetchMember(guild, target.id);
        if (!member) {
          throw new UserFacingError('Este usuário não está no servidor.', { code: 'NOT_MEMBER' });
        }
        await member.timeout(null, audit);
      },
    });
    await cancelScheduledActions(this.db, {
      guildId: guild.id,
      kind: 'untimeout',
      targetId: target.id,
    });
    return result;
  }

  async warn(request: ActionRequest): Promise<ActionResult> {
    const result = await this.execute({
      ...request,
      type: 'warn',
      // Warn não toca no Discord: o caso e a DM são a punição inteira.
      perform: () => Promise.resolve(),
    });
    return { ...result, escalation: await this.escalate(request) };
  }

  /** Anotação interna: nunca vira DM nem ação no Discord. */
  async note(request: ActionRequest): Promise<ActionResult> {
    return this.execute({
      ...request,
      type: 'note',
      dm: false,
      perform: () => Promise.resolve(),
    });
  }

  // ── hierarquia ────────────────────────────────────────────────────────────

  /**
   * Aplica as regras do PRD §5.1. Quando o alvo não está no servidor (ban por
   * ID, unban) não há cargo para comparar — sobram as regras que dependem só
   * do ID.
   */
  async assertCanAct(guild: Guild, actor: GuildMember | undefined, target: User): Promise<void> {
    const botMember = guild.members.me;
    const targetMember = await fetchMember(guild, target.id);

    // Sem ator humano é o bot que age (scheduler, escalada, automod): ele
    // ocupa o lugar do ator para que a hierarquia do próprio bot seja checada.
    const actorMember = actor ?? botMember;
    if (!actorMember) {
      throw new UserFacingError('Não consegui ler o meu próprio membro no servidor.', {
        code: 'NO_BOT_MEMBER',
      });
    }

    if (!targetMember) {
      if (actorMember.id === target.id) {
        throw new UserFacingError('Você não pode usar esta ação em si mesmo.', {
          code: 'SELF_TARGET',
        });
      }
      if (target.id === this.client.user?.id) {
        throw new UserFacingError('Não é possível moderar o próprio bot.', { code: 'TARGET_BOT' });
      }
      if (target.id === guild.ownerId) {
        throw new UserFacingError('Não é possível moderar o dono do servidor.', {
          code: 'TARGET_OWNER',
        });
      }
      return;
    }

    const result = canActOn(toMemberLike(actorMember), toMemberLike(targetMember), {
      bot: botMember ? toMemberLike(botMember) : undefined,
    });
    if (!result.ok) {
      throw new UserFacingError(result.reason, { code: result.code });
    }
  }

  // ── interno ───────────────────────────────────────────────────────────────

  private moderationConfig(guildId: string): Promise<ModerationConfig> {
    return this.config.get(guildId, 'moderation');
  }

  /** `guild_settings.dm_on_punish` sobrescreve o do módulo quando existe. */
  private async dmPolicy(
    guildId: string,
  ): Promise<{ policy: DmOnPunish; footer: string; settings: ResolvedSettings }> {
    const [config, settings] = await Promise.all([
      this.moderationConfig(guildId),
      this.config.getSettings(guildId),
    ]);
    return {
      policy: settings.dmOnPunish ?? config.dmOnPunish,
      footer: config.dmFooter,
      settings,
    };
  }

  /**
   * Caminho comum de toda punição, nesta ordem: hierarquia → caso → DM → ação
   * no Discord → agendamento → mod-log.
   *
   * O caso nasce **antes** da ação porque a DM precisa do número do caso e
   * porque, depois de um ban ou kick, não há mais servidor em comum para
   * mandar DM. Se a ação no Discord falhar, o caso é apagado (soft delete) e o
   * erro sobe — o número fica com um buraco, o que é preferível a um caso que
   * nunca aconteceu ficar no histórico.
   */
  private async execute(input: ExecuteInput): Promise<ActionResult> {
    const { guild, target, actor, type } = input;

    await this.assertCanAct(guild, actor, target);

    const config = await this.moderationConfig(guild.id);
    const reason = normalizeReason(input.reason, config.defaultReason);
    const actorId = actor?.id ?? this.client.user?.id ?? guild.client.user.id;
    const actorTag = actor?.user.tag ?? this.client.user?.tag ?? 'CoBot';
    const expiresAt = input.durationMs ? new Date(Date.now() + input.durationMs) : null;

    const kase = await createCase(this.db, {
      guildId: guild.id,
      type,
      targetId: target.id,
      targetTag: target.tag,
      actorId,
      actorTag,
      reason,
      durationMs: input.durationMs ?? null,
      expiresAt,
      source: input.source ?? 'command',
      automodRuleId: input.automodRuleId ?? null,
    });

    let dmSent = false;
    if (input.dm !== false) {
      const { policy, footer } = await this.dmPolicy(guild.id);
      if (shouldDm(policy, type)) {
        dmSent = await sendPunishmentDm(target, kase, guild, { footer });
      }
    }

    try {
      await input.perform(auditReason(actorTag, reason));
    } catch (error) {
      await softDeleteCase(this.db, guild.id, kase.caseNumber).catch((rollbackError: unknown) => {
        log.error({ err: rollbackError, caseNumber: kase.caseNumber }, 'falha ao desfazer o caso');
      });
      throw toUserFacing(error, type);
    }

    if (input.schedule && expiresAt) {
      await scheduleAction(this.db, {
        guildId: guild.id,
        caseId: kase.id,
        kind: input.schedule,
        runAt: expiresAt,
        payload: { targetId: target.id, targetTag: target.tag, caseNumber: kase.caseNumber },
      });
    }

    await this.modlog.postCase(kase);
    this.deps.onCase?.(kase);

    log.info(
      { guildId: guild.id, type, caseNumber: kase.caseNumber, targetId: target.id, actorId },
      'caso criado',
    );
    return { case: kase, dmSent };
  }

  /** Aplica o degrau de escalada disparado por um warn, se houver. */
  private async escalate(
    request: ActionRequest,
  ): Promise<{ step: EscalationStep; case: Case } | null> {
    const config = await this.moderationConfig(request.guild.id);
    const step = await resolveEscalation({
      db: this.db,
      guildId: request.guild.id,
      targetId: request.target.id,
      config,
    });
    if (!step) return null;

    // A escalada é do bot, não do moderador que deu o último warn.
    const escalated: TimedRequest = {
      guild: request.guild,
      target: request.target,
      reason: `Escalada automática: ${step.warns} avisos em ${step.withinDays} dia(s).`,
      source: 'escalation',
    };

    try {
      const result =
        step.action === 'timeout'
          ? await this.timeout({ ...escalated, durationMs: step.durationMs })
          : step.action === 'kick'
            ? await this.kick(escalated)
            : await this.ban(escalated);
      return { step, case: result.case };
    } catch (error) {
      // A escalada falhar não pode invalidar o warn que já foi aplicado.
      log.error(
        { err: error, guildId: request.guild.id, targetId: request.target.id, step },
        'falha ao aplicar a escalada',
      );
      return null;
    }
  }
}

/** Cache primeiro; `fetch` só quando o membro não está lá (PRD §7.4). */
export async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  try {
    return await guild.members.fetch({ user: userId });
  } catch {
    return null;
  }
}

/** `note` nunca gera DM; os demais tipos seguem a config. */
function shouldDm(policy: DmOnPunish, type: CaseType): boolean {
  switch (type) {
    case 'ban':
      return policy.ban;
    case 'softban':
      return policy.softban;
    case 'kick':
      return policy.kick;
    case 'timeout':
      return policy.timeout;
    case 'warn':
      return policy.warn;
    default:
      return false;
  }
}

export function normalizeReason(reason: string | undefined, fallback: string): string {
  const trimmed = reason?.trim();
  const value = trimmed && trimmed.length > 0 ? trimmed : fallback;
  return value.length > MAX_REASON_LENGTH ? `${value.slice(0, MAX_REASON_LENGTH - 1)}…` : value;
}

/** Motivo como aparece no audit log do Discord (512 caracteres). */
export function auditReason(actorTag: string, reason: string): string {
  const full = `${actorTag}: ${reason}`;
  return full.length > MAX_REASON_LENGTH ? `${full.slice(0, MAX_REASON_LENGTH - 1)}…` : full;
}

const API_ERROR_MESSAGES: Record<number, string> = {
  10007: 'Este usuário não está no servidor.',
  10013: 'Usuário desconhecido — confira o ID.',
  10026: 'Este usuário não está banido.',
  50013: 'Faltam permissões para mim executar esta ação no Discord.',
};

/** Traduz erros conhecidos do Discord; o resto sobe e vira log + erro genérico. */
function toUserFacing(error: unknown, type: CaseType): unknown {
  if (error instanceof UserFacingError) return error;
  if (error instanceof DiscordAPIError) {
    const message = API_ERROR_MESSAGES[Number(error.code)];
    if (message) {
      return new UserFacingError(message, { code: `DISCORD_${error.code}`, cause: error });
    }
    if (Number(error.code) === 429) {
      return new UserFacingError('O Discord limitou o bot. Tente de novo em alguns segundos.', {
        code: 'RATE_LIMITED',
        cause: error,
      });
    }
  }
  log.error({ err: error, type }, 'falha ao executar a ação no Discord');
  return error;
}
