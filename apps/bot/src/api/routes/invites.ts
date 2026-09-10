import { ActorInputSchema, CreateInviteInputSchema, UserFacingError } from '@goodbot/shared';
import { ChannelType } from 'discord.js';
import { Hono } from 'hono';

import { requireActor, requireBotMember } from '../actor';
import { forbidden, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { GuildInviteSummary } from '@goodbot/shared';
import type { Guild, GuildBasedChannel, Invite } from 'discord.js';

/** Onde um convite pode nascer: canal onde alguém entra e fica. */
const INVITABLE_TYPES: ChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
];

function toInviteSummary(invite: Invite): GuildInviteSummary {
  return {
    code: invite.code,
    url: invite.url,
    channel: invite.channel
      ? { id: invite.channel.id, name: invite.channel.name ?? invite.channel.id }
      : null,
    inviter: invite.inviter
      ? {
          id: invite.inviter.id,
          username: invite.inviter.tag,
          avatarUrl: invite.inviter.displayAvatarURL({ size: 64 }),
        }
      : null,
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    maxAge: invite.maxAge ?? 0,
    temporary: invite.temporary ?? false,
    createdAt: invite.createdAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
  };
}

/** `ManageGuild` é o que o Discord exige para *ler* a lista de convites. */
function canManageInvites(guild: Guild): boolean {
  return guild.members.me?.permissions.has('ManageGuild') ?? false;
}

function requireInvitableChannel(guild: Guild, channelId: string): GuildBasedChannel {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !INVITABLE_TYPES.includes(channel.type)) {
    throw new UserFacingError('Esse canal não aceita convite.', { code: 'BAD_CHANNEL' });
  }
  return channel;
}

/**
 * Convites do painel (PRD §6.3). Nada aqui é cacheado: o `GuildInviteManager`
 * tem limite 0 no cliente de propósito (§7.2), então cada tela é um REST sob
 * demanda — o que também é o único jeito de a coluna "usos" estar certa.
 */
export function createInviteRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/', async (c) => {
      const guild = c.get('guild');
      if (!canManageInvites(guild)) {
        return c.json({ invites: [], canManage: false });
      }

      const invites = await guild.invites.fetch({ cache: false });
      const list = [...invites.values()]
        .map(toInviteSummary)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      return c.json({ invites: list, canManage: true });
    })

    .post('/', validate('json', CreateInviteInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');

      const channel = requireInvitableChannel(guild, input.channelId);
      const me = requireBotMember(guild);
      if (!channel.permissionsFor(me)?.has('CreateInstantInvite')) {
        throw forbidden(
          'O bot não pode criar convite nesse canal; falta a permissão Criar Convite.',
          'MISSING_CREATE_INVITE',
        );
      }

      const invite = await guild.invites.create(channel.id, {
        maxAge: input.maxAge,
        maxUses: input.maxUses,
        temporary: input.temporary,
        unique: input.unique,
        reason: input.reason ?? `Criado pelo painel por ${actor.user.tag}`,
      });
      return c.json(toInviteSummary(invite));
    })

    .delete('/:code', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');

      if (!canManageInvites(guild)) {
        throw forbidden(
          'O bot não tem a permissão Gerenciar Servidor; reconvide-o com ela.',
          'MISSING_MANAGE_GUILD',
        );
      }

      const code = c.req.param('code');
      const invites = await guild.invites.fetch({ cache: false });
      if (!invites.has(code)) throw notFound('Convite não encontrado.', 'INVITE_NOT_FOUND');

      await guild.invites.delete(
        code,
        input.reason ?? `Revogado pelo painel por ${actor.user.tag}`,
      );
      return c.json({ ok: true as const });
    });
}
