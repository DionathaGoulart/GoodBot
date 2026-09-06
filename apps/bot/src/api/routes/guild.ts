import { AuditLogQuerySchema, MemberSearchQuerySchema, isSnowflake } from '@cobot/shared';
import { Hono } from 'hono';

import { fetchMember } from '../../services/moderation';
import { notFound } from '../errors';
import {
  toAuditLogEntry,
  toChannelSummary,
  toMemberDetail,
  toMemberSummary,
  toRoleSummary,
} from '../mappers';
import { validate } from '../validate';

import type { ApiEnv } from '../context';
import type { Guild, GuildMember } from 'discord.js';

/**
 * Busca de membros. Com a intent `GuildMembers` o cache já tem o servidor
 * inteiro, então filtramos nele; só um ID solto que não está no cache vira um
 * fetch (PRD §7.4: nada de fetch em loop).
 */
export async function searchMembers(
  guild: Guild,
  query: string,
  limit: number,
): Promise<GuildMember[]> {
  // `needle` sai antes do `if`: `isSnowflake` é type guard e estreita `query`
  // a `never` no ramo de baixo.
  const needle = query.toLowerCase();

  if (isSnowflake(query)) {
    const member = await fetchMember(guild, query);
    return member ? [member] : [];
  }

  const matches = [...guild.members.cache.values()].filter((member) => {
    if (!needle) return true;
    return (
      member.user.username.toLowerCase().includes(needle) ||
      member.displayName.toLowerCase().includes(needle) ||
      member.user.tag.toLowerCase().includes(needle)
    );
  });

  matches.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  return matches.slice(0, limit);
}

export function createGuildRoutes(): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/channels', (c) => {
      const guild = c.get('guild');
      const channels = [...guild.channels.cache.values()]
        .map(toChannelSummary)
        .sort((a, b) => a.position - b.position);
      return c.json(channels);
    })

    .get('/roles', (c) => {
      const guild = c.get('guild');
      const roles = [...guild.roles.cache.values()]
        .map(toRoleSummary)
        .sort((a, b) => b.position - a.position);
      return c.json(roles);
    })

    .get('/members', validate('query', MemberSearchQuerySchema), async (c) => {
      const { q, limit } = c.req.valid('query');
      const members = await searchMembers(c.get('guild'), q, limit);
      return c.json(members.map(toMemberSummary));
    })

    .get('/members/:userId', async (c) => {
      const userId = c.req.param('userId');
      if (!isSnowflake(userId)) throw notFound('Usuário inválido.', 'INVALID_USER_ID');

      const member = await fetchMember(c.get('guild'), userId);
      if (!member) throw notFound('Este usuário não está no servidor.', 'MEMBER_NOT_FOUND');
      return c.json(toMemberDetail(member));
    })

    .get('/audit-log', validate('query', AuditLogQuerySchema), async (c) => {
      const { type, limit, before } = c.req.valid('query');
      const guild = c.get('guild');
      if (!guild.members.me?.permissions.has('ViewAuditLog')) {
        throw notFound('O bot não tem permissão para ver o audit log.', 'MISSING_PERMISSION');
      }

      const logs = await guild.fetchAuditLogs({
        limit,
        ...(type === undefined ? {} : { type }),
        ...(before === undefined ? {} : { before }),
      });
      return c.json([...logs.entries.values()].map(toAuditLogEntry));
    });
}
