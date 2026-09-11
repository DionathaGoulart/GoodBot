import {
  ActorInputSchema,
  AuditLogQuerySchema,
  BanListQuerySchema,
  GuildSettingsInputSchema,
  MAX_BAN_PAGE,
  MemberSearchQuerySchema,
  RoleListQuerySchema,
  guildSettingsBlockers,
  isSnowflake,
} from '@goodbot/shared';
import { AuditLogEvent, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { Hono } from 'hono';

import { sharedRoleMemberCounts } from '../../lib/members';
import { fetchMember } from '../../services/moderation';
import { requireActor, requireBotMember } from '../actor';
import { ApiHttpError, forbidden, notFound } from '../errors';
import {
  toAuditLogEntry,
  toChannelSummary,
  toMemberDetail,
  toMemberSummary,
  toRoleSummary,
} from '../mappers';
import { toModerationResult } from './moderation';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { BanListQuery, GuildBanSummary, GuildProfile } from '@goodbot/shared';
import type { Guild, GuildBan, GuildMember, GuildVerificationLevel } from 'discord.js';

/**
 * Busca de membros.
 *
 * Isto já filtrou `guild.members.cache`, quando o boot puxava o servidor
 * inteiro para a memória. Com o teto por guild o cache virou uma amostra —
 * quem apareceu por último —, e filtrar nele devolveria "2 de 13" de novo.
 * Agora quem responde é o Discord:
 *
 * · ID → `fetchMember` (cache, e só então uma chamada);
 * · busca vazia (a primeira abertura da tela) → uma página de membros;
 * · texto → o endpoint de busca por prefixo, o mesmo da caixa de membros do
 *   cliente do Discord.
 *
 * Nos dois últimos o resultado **não** entra no cache: uma busca por "a" com
 * limite 100 despejaria justamente os membros que a moderação está tratando.
 */
export async function searchMembers(
  guild: Guild,
  query: string,
  limit: number,
): Promise<GuildMember[]> {
  if (isSnowflake(query)) {
    const member = await fetchMember(guild, query);
    return member ? [member] : [];
  }

  // O endpoint de busca recusa `query` vazia; a lista simples é o que a tela
  // precisa antes de alguém digitar qualquer coisa.
  const found = await (query
    ? guild.members.search({ query, limit, cache: false })
    : guild.members.list({ limit, cache: false })
  ).catch(() => null);
  if (!found) return [];

  return [...found.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
}

/** O estado atual do servidor + o que o bot consegue mexer nele (PRD §6.3). */
export function toGuildProfile(guild: Guild): GuildProfile {
  const me = guild.members.me;
  return {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    iconUrl: guild.iconURL({ size: 256 }),
    bannerUrl: guild.bannerURL({ size: 512 }),
    verificationLevel: guild.verificationLevel,
    systemChannelId: guild.systemChannelId,
    afkChannelId: guild.afkChannelId,
    afkTimeout: guild.afkTimeout,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    premiumTier: guild.premiumTier,
    premiumSubscriptionCount: guild.premiumSubscriptionCount ?? 0,
    features: [...guild.features],
    permissions: {
      manageGuild: me?.permissions.has('ManageGuild') ?? false,
      banMembers: me?.permissions.has('BanMembers') ?? false,
      viewAuditLog: me?.permissions.has('ViewAuditLog') ?? false,
    },
  };
}

/** Quem baniu e quando — só o audit log do Discord sabe, e só por 90 dias. */
interface BanAuthor {
  executor: GuildBanSummary['executor'];
  bannedAt: string | null;
}

async function fetchBanAuthors(guild: Guild): Promise<Map<string, BanAuthor>> {
  const authors = new Map<string, BanAuthor>();
  if (!guild.members.me?.permissions.has('ViewAuditLog')) return authors;

  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 100 });
  for (const entry of logs.entries.values()) {
    // A primeira entrada de cada alvo é a mais recente; um rebanimento antigo
    // não pode sobrescrever o autor do banimento que está valendo.
    if (!entry.targetId || authors.has(entry.targetId)) continue;
    authors.set(entry.targetId, {
      bannedAt: entry.createdAt.toISOString(),
      executor: entry.executor
        ? {
            id: entry.executor.id,
            username: entry.executor.username ?? entry.executor.id,
            avatarUrl: entry.executor.displayAvatarURL({ size: 64 }),
          }
        : null,
    });
  }
  return authors;
}

function toBanSummary(ban: GuildBan, author: BanAuthor | undefined): GuildBanSummary {
  return {
    user: {
      id: ban.user.id,
      username: ban.user.tag,
      avatarUrl: ban.user.displayAvatarURL({ size: 64 }),
      bot: ban.user.bot,
    },
    reason: ban.reason ?? null,
    executor: author?.executor ?? null,
    bannedAt: author?.bannedAt ?? null,
  };
}

function banMatches(ban: GuildBan, needle: string): boolean {
  return (
    ban.user.tag.toLowerCase().includes(needle) ||
    ban.user.id.startsWith(needle) ||
    (ban.reason ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Quantas páginas de 1000 varremos atrás de um nome. O Discord só pagina por
 * ID e não busca por texto, então a alternativa seria puxar a lista inteira —
 * com teto, um servidor com dezenas de milhares de banidos não derruba a VM.
 */
const BAN_SCAN_PAGES = 5;

/**
 * Uma página de banidos. Sem busca é paginação pura (cursor `after`); com
 * busca por texto varremos até `BAN_SCAN_PAGES` páginas filtrando aqui, e o
 * cursor devolvido continua a varredura de onde ela parou.
 */
async function collectBans(
  guild: Guild,
  { q, limit, after }: BanListQuery,
): Promise<{ bans: GuildBan[]; nextCursor: string | null }> {
  // `needle` sai antes do `if` pelo mesmo motivo de `searchMembers`:
  // `isSnowflake` é type guard e estreitaria `q` a `never` no ramo de baixo.
  const needle = q.toLowerCase();

  if (isSnowflake(q)) {
    const ban = await guild.bans.fetch({ user: q, cache: false }).catch((error: unknown) => {
      const unknown =
        error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownBan;
      if (unknown) return null;
      throw error;
    });
    return { bans: ban ? [ban] : [], nextCursor: null };
  }

  const pageSize = needle ? MAX_BAN_PAGE : limit;
  const maxPages = needle ? BAN_SCAN_PAGES : 1;

  const found: GuildBan[] = [];
  let cursor = after;
  let exhausted = false;

  for (let page = 0; page < maxPages && found.length < limit && !exhausted; page += 1) {
    const batch = await guild.bans.fetch({
      limit: pageSize,
      ...(cursor === undefined ? {} : { after: cursor }),
      cache: false,
    });
    const items = [...batch.values()];
    if (items.length < pageSize) exhausted = true;

    for (const ban of items) {
      // O cursor anda por banimento examinado, não por página: parar no meio
      // de uma página e retomar pelo fim dela puliria os que sobraram.
      cursor = ban.user.id;
      if (!needle || banMatches(ban, needle)) found.push(ban);
      if (found.length >= limit) break;
    }
    if (items.length === 0) exhausted = true;
  }

  return { bans: found, nextCursor: exhausted ? null : (cursor ?? null) };
}

export function createGuildRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return (
    new Hono<ApiEnv>()
      .get('/', (c) => c.json(toGuildProfile(c.get('guild'))))

      /**
       * Editar o servidor pelo painel (§6.3). Só `admin`, e nada sai daqui para
       * o Discord antes de checar `ManageGuild` e as features de impulso — um
       * 400 genérico do Discord não diz ao usuário o que faltou.
       */
      .patch('/', validate('json', GuildSettingsInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');

        if (!requireBotMember(guild).permissions.has('ManageGuild')) {
          throw forbidden(
            'O bot não tem a permissão Gerenciar Servidor; reconvide-o com ela.',
            'MISSING_MANAGE_GUILD',
          );
        }

        const blockers = guildSettingsBlockers(input, guild.features);
        if (blockers.length > 0) {
          throw new ApiHttpError(
            400,
            'MISSING_GUILD_FEATURE',
            blockers.map((blocker) => blocker.message).join(' '),
            blockers.map((blocker) => ({ path: blocker.field, message: blocker.message })),
          );
        }

        const edited = await guild.edit({
          name: input.name,
          description: input.description,
          verificationLevel: input.verificationLevel as GuildVerificationLevel,
          systemChannel: input.systemChannelId,
          afkChannel: input.afkChannelId,
          afkTimeout: input.afkTimeout,
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          ...(input.banner === undefined ? {} : { banner: input.banner }),
          reason: input.reason ?? `Editado pelo painel por ${actor.user.tag}`,
        });
        return c.json(toGuildProfile(edited));
      })

      .get('/bans', validate('query', BanListQuerySchema), async (c) => {
        const guild = c.get('guild');
        if (!guild.members.me?.permissions.has('BanMembers')) {
          throw forbidden(
            'O bot não tem a permissão Banir Membros; reconvide-o com ela.',
            'MISSING_BAN_MEMBERS',
          );
        }

        const { bans, nextCursor } = await collectBans(guild, c.req.valid('query'));
        const authors = await fetchBanAuthors(guild);
        return c.json({
          bans: bans.map((ban) => toBanSummary(ban, authors.get(ban.user.id))),
          nextCursor,
          executorsResolved: guild.members.me.permissions.has('ViewAuditLog'),
        });
      })

      /**
       * Desbanir pelo painel. Passa pelo `ModerationService`, o mesmo do
       * `/unban`, então caso, mod-log e escalada saem idênticos — só o `source`
       * muda para `dashboard` (PRD §5.7).
       */
      .delete('/bans/:userId', validate('json', ActorInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const userId = c.req.param('userId');
        if (!isSnowflake(userId)) throw notFound('Usuário inválido.', 'INVALID_USER_ID');

        const actor = await requireActor(deps, guild, input.actorId, 'mod');
        const target = await deps.client.users.fetch(userId).catch(() => null);
        if (!target) throw notFound('Usuário não encontrado.', 'TARGET_NOT_FOUND');
        await deps.moderation.assertCanAct(guild, actor, target);

        const result = await deps.moderation.unban({
          guild,
          actor,
          target,
          source: 'dashboard',
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        });
        return c.json(toModerationResult(result));
      })

      .get('/channels', (c) => {
        const guild = c.get('guild');
        const channels = [...guild.channels.cache.values()]
          .map(toChannelSummary)
          .sort((a, b) => a.position - b.position);
        return c.json(channels);
      })

      .get('/roles', validate('query', RoleListQuerySchema), async (c) => {
        const guild = c.get('guild');
        // A contagem é opt-in porque ela é a **única** parte cara desta rota:
        // a lista sai do cache em microssegundos, e contar membros varre o
        // Discord por REST. Quem mais pede cargos é a checagem de permissão do
        // painel, que só lê o bitfield. Sem o `counts=1` ela deixou de pagar
        // uma varredura por requisição (ver `RoleListQuerySchema`).
        //
        // `null` = servidor grande demais para contar sem varrer tudo; aí o
        // campo não vai e a tabela mostra "—" em vez de um zero mentiroso.
        const counts = c.req.valid('query').counts ? await sharedRoleMemberCounts(guild) : null;
        const roles = [...guild.roles.cache.values()]
          .map((role) => toRoleSummary(role, counts ? (counts.get(role.id) ?? 0) : undefined))
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
      })
  );
}
