import { ModerationActionInputSchema } from '@cobot/shared';
import { Hono } from 'hono';

import { fetchMember } from '../../services/moderation';
import { levelAtLeast, resolveLevel, toMemberLike } from '../../services/permissions';
import { forbidden, notFound } from '../errors';
import { validate } from '../validate';

import type { ActionResult } from '../../services/moderation';
import type { ApiDeps, ApiEnv } from '../context';
import type { ModerationActionInput, ModerationActionResult } from '@cobot/shared';
import type { Guild, GuildMember, User } from 'discord.js';

interface Command {
  input: ModerationActionInput;
  guild: Guild;
  actor: GuildMember;
  target: User;
}

/**
 * Despacha para o mesmo `ModerationService` dos slash commands — o `source`
 * já vem `dashboard` do schema, então caso, mod-log, DM e escalada saem
 * idênticos aos do comando (PRD §5.7).
 */
function dispatch(
  moderation: ApiDeps['moderation'],
  { input, guild, actor, target }: Command,
): Promise<ActionResult> {
  const base = {
    guild,
    actor,
    target,
    source: input.source,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };

  switch (input.type) {
    case 'ban':
      return moderation.ban({
        ...base,
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        ...(input.deleteMessageDays === undefined
          ? {}
          : { deleteMessageDays: input.deleteMessageDays }),
      });
    case 'unban':
      return moderation.unban(base);
    case 'softban':
      return moderation.softban({
        ...base,
        ...(input.deleteMessageDays === undefined
          ? {}
          : { deleteMessageDays: input.deleteMessageDays }),
      });
    case 'kick':
      return moderation.kick(base);
    case 'timeout':
      return moderation.timeout({ ...base, durationMs: input.durationMs });
    case 'untimeout':
      return moderation.untimeout(base);
    case 'warn':
      return moderation.warn(base);
    case 'note':
      return moderation.note(base);
  }
}

function toResult(result: ActionResult): ModerationActionResult {
  return {
    caseId: result.case.id,
    caseNumber: result.case.caseNumber,
    type: result.case.type,
    expiresAt: result.case.expiresAt?.toISOString() ?? null,
    dmSent: result.dmSent,
  };
}

export function createModerationRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>().post('/', validate('json', ModerationActionInputSchema), async (c) => {
    const input = c.req.valid('json');
    const guild = c.get('guild');

    // O token da API não diz *quem* pediu: o `actorId` do corpo é que
    // responde por isso, e ele precisa ser um mod de verdade neste servidor.
    const actor = await fetchMember(guild, input.actorId);
    if (!actor) throw forbidden('O autor da ação não está no servidor.', 'ACTOR_NOT_MEMBER');

    const settings = await deps.config.getSettings(guild.id);
    const level = resolveLevel(toMemberLike(actor), settings);
    if (!levelAtLeast(level, 'mod')) {
      throw forbidden('O autor da ação não é moderador.', 'ACTOR_NOT_MOD');
    }

    const target = await deps.client.users.fetch(input.targetId).catch(() => null);
    if (!target) throw notFound('Usuário não encontrado.', 'TARGET_NOT_FOUND');

    await deps.moderation.assertCanAct(guild, actor, target);

    const result = await dispatch(deps.moderation, { input, guild, actor, target });
    return c.json(toResult(result));
  });
}
