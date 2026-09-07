import {
  ActorInputSchema,
  ChannelCreateInputSchema,
  ChannelOverridesInputSchema,
  ChannelUpdateInputSchema,
  MANAGED_CHANNEL_TYPES,
  SlowmodeInputSchema,
  UserFacingError,
  isEmptyOverride,
  overrideToBits,
} from '@cobot/shared';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { Hono } from 'hono';

import { assertRoleManageable, requireActor } from '../actor';
import { notFound } from '../errors';
import { toChannelDetail } from '../mappers';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { ChannelOverride } from '@cobot/shared';
import type {
  CategoryChannel,
  Guild,
  GuildMember,
  NonThreadGuildBasedChannel,
} from 'discord.js';

function requireChannel(guild: Guild, channelId: string): NonThreadGuildBasedChannel {
  const channel = guild.channels.cache.get(channelId);
  // Tópico não é canal para o painel: ele não aparece na árvore e o Discord
  // nem tem overrides para ele.
  if (!channel || channel.isThread()) {
    throw notFound('Canal não encontrado.', 'CHANNEL_NOT_FOUND');
  }
  return channel;
}

/** Só categoria pode ser pai; canal dentro de canal não existe. */
function resolveParent(guild: Guild, parentId: string | null): CategoryChannel | null {
  if (!parentId) return null;
  const parent = guild.channels.cache.get(parentId);
  if (parent?.type !== ChannelType.GuildCategory) {
    throw new UserFacingError('A categoria escolhida não existe.', { code: 'BAD_PARENT' });
  }
  return parent;
}

/**
 * Nem todo campo cabe em todo tipo: mandar `topic` para um canal de voz é 400
 * do Discord. Filtramos aqui para o painel poder mandar o formulário inteiro.
 */
function editableFields(
  channel: NonThreadGuildBasedChannel,
  input: { topic: string | null; nsfw: boolean; slowmodeSeconds: number },
): Record<string, unknown> {
  return {
    ...('topic' in channel ? { topic: input.topic } : {}),
    ...('nsfw' in channel ? { nsfw: input.nsfw } : {}),
    ...('rateLimitPerUser' in channel ? { rateLimitPerUser: input.slowmodeSeconds } : {}),
  };
}

/** Só quem pode gerenciar o cargo pode mexer no override dele. */
function assertOverridesAllowed(
  guild: Guild,
  actor: GuildMember,
  overrides: ChannelOverride[],
): void {
  for (const override of overrides) {
    const role = guild.roles.cache.get(override.roleId);
    if (!role) throw notFound('Cargo do override não encontrado.', 'ROLE_NOT_FOUND');
    // `@everyone` é o alvo natural de "fechar o canal": ele fica de fora da
    // hierarquia de cargo, mas continua exigindo `admin`, checado na rota.
    if (role.id === guild.id) continue;
    assertRoleManageable(guild, actor, role);
  }
}

async function applyOverrides(
  channel: NonThreadGuildBasedChannel,
  overrides: ChannelOverride[],
  reason: string,
): Promise<void> {
  for (const override of overrides) {
    if (isEmptyOverride(override)) {
      await channel.permissionOverwrites.delete(override.roleId, reason);
      continue;
    }
    const { allow, deny } = overrideToBits(override);
    await channel.permissionOverwrites.edit(
      override.roleId,
      {
        ViewChannel: bitState(allow, deny, PermissionFlagsBits.ViewChannel),
        SendMessages: bitState(allow, deny, PermissionFlagsBits.SendMessages),
      },
      { reason },
    );
  }
}

/** `true` libera, `false` nega, `null` herda — é o que o discord.js espera. */
function bitState(allow: string, deny: string, flag: bigint): boolean | null {
  if ((BigInt(deny) & flag) === flag) return false;
  if ((BigInt(allow) & flag) === flag) return true;
  return null;
}

/**
 * Gestão de canais pelo painel (PRD §6.3). Tudo exige `admin`; `lock`/`unlock`
 * mexem só no `SendMessages` do `@everyone`, exatamente como o `/lock` faz
 * dentro do Discord, para os dois caminhos se desfazerem um ao outro.
 */
export function createChannelRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/:channelId', (c) => {
      const guild = c.get('guild');
      return c.json(toChannelDetail(requireChannel(guild, c.req.param('channelId'))));
    })

    .post('/', validate('json', ChannelCreateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const reason = input.reason ?? `Criado pelo painel por ${actor.user.tag}`;

      const parent = input.type === MANAGED_CHANNEL_TYPES.category ? null : resolveParent(guild, input.parentId);
      const channel = await guild.channels.create({
        name: input.name,
        type: input.type,
        ...(parent ? { parent } : {}),
        ...(input.type === MANAGED_CHANNEL_TYPES.category
          ? {}
          : {
              ...(input.topic === null ? {} : { topic: input.topic }),
              nsfw: input.nsfw,
              rateLimitPerUser: input.slowmodeSeconds,
            }),
        reason,
      });
      return c.json(toChannelDetail(channel));
    })

    .patch('/:channelId', validate('json', ChannelUpdateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));
      const reason = input.reason ?? `Editado pelo painel por ${actor.user.tag}`;

      const parent =
        channel.type === ChannelType.GuildCategory ? null : resolveParent(guild, input.parentId);
      const updated = await channel.edit({
        name: input.name,
        ...(channel.type === ChannelType.GuildCategory ? {} : { parent }),
        ...editableFields(channel, input),
        reason,
      });
      return c.json(toChannelDetail(updated));
    })

    .delete('/:channelId', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));

      await channel.delete(input.reason ?? `Apagado pelo painel por ${actor.user.tag}`);
      return c.json({ ok: true as const });
    })

    .post('/:channelId/slowmode', validate('json', SlowmodeInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));
      if (!('rateLimitPerUser' in channel)) {
        throw new UserFacingError('Esse canal não tem modo lento.', { code: 'NO_SLOWMODE' });
      }

      const updated = await channel.edit({
        rateLimitPerUser: input.seconds,
        reason: input.reason ?? `Modo lento pelo painel por ${actor.user.tag}`,
      });
      return c.json(toChannelDetail(updated));
    })

    .post('/:channelId/lock', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: false },
        { reason: input.reason ?? `Trancado pelo painel por ${actor.user.tag}` },
      );
      return c.json(toChannelDetail(requireChannel(guild, channel.id)));
    })

    /** Volta a herdar em vez de liberar: o `/unlock` do Discord faz igual. */
    .post('/:channelId/unlock', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));

      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: null },
        { reason: input.reason ?? `Destrancado pelo painel por ${actor.user.tag}` },
      );
      return c.json(toChannelDetail(requireChannel(guild, channel.id)));
    })

    .post('/:channelId/overrides', validate('json', ChannelOverridesInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      const channel = requireChannel(guild, c.req.param('channelId'));
      assertOverridesAllowed(guild, actor, input.overrides);

      await applyOverrides(
        channel,
        input.overrides,
        input.reason ?? `Permissões pelo painel por ${actor.user.tag}`,
      );
      return c.json(toChannelDetail(requireChannel(guild, channel.id)));
    });
}
