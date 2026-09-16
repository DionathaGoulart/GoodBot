import {
  countSearchingProfilesByGame,
  getSquad,
  getSquadGame,
  getSquadProfile,
  listMembersOfSquads,
  listOpenSquadProposals,
  listSquadGames,
  listSquadMembers,
  listSquads,
  listUpcomingSessions,
} from '@goodbot/db';
import {
  ArchiveSquadInputSchema,
  DeleteSquadProfileInputSchema,
  EditSquadProfileAnswersInputSchema,
  MAX_GUILD_CHANNELS,
  PostSquadSearchMessageInputSchema,
  ProposeSquadManuallyInputSchema,
  RemoveSquadMemberInputSchema,
  RenameSquadInputSchema,
  RunSquadMatchInputSchema,
  SetSquadProfileStatusInputSchema,
  SquadGameIdParamSchema,
  SquadIdParamSchema,
  SquadManualCheckInputSchema,
  SquadMemberParamSchema,
  SquadProfileParamSchema,
  UserFacingError,
} from '@goodbot/shared';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { ApiHttpError, notFound } from '../errors';
import {
  MESSAGE_LIMIT_PER_MINUTE,
  createRateLimiter,
  guildRateLimit,
} from '../middleware/rate-limit';
import { validate } from '../validate';

import type { ManualOutcome } from '../../services/squads';
import type { ApiDeps, ApiEnv } from '../context';
import type { Squad, SquadGame, SquadProfile, SquadProposal, SquadSession } from '@goodbot/db';
import type {
  DeleteSquadProfileResult,
  ManualMatchEvaluation,
  PostSquadSearchMessageResult,
  RemoveSquadMemberResult,
  RunSquadMatchResult,
  SquadGameSummary,
  SquadManualCheck,
  SquadManualProposalResult,
  SquadOverview,
  SquadProfileAnswersResult,
  SquadProfileStatusResult,
  SquadProfileSummary,
  SquadProposalSummary,
  SquadSessionSummary,
  SquadSummary,
} from '@goodbot/shared';
import type { Guild } from 'discord.js';

/**
 * Teto por guild da revisão do match manual. Folgado porque revisar não manda
 * nada ao Discord (o `writeLimit` existe por isso); segura só clique em rajada.
 */
const MANUAL_CHECK_LIMIT_PER_MINUTE = 60;

function toGameSummary(row: SquadGame): SquadGameSummary {
  return {
    id: row.id,
    name: row.name,
    squadSize: row.squadSize,
    enabled: row.enabled,
    fields: row.fields,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSessionSummary(row: SquadSession, now: Date): SquadSessionSummary {
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    goingCount: row.goingIds.length,
    live: row.startsAt.getTime() <= now.getTime(),
    createdBy: row.createdBy,
  };
}

function toSquadSummary(
  row: Squad,
  memberIds: string[],
  sessions: readonly SquadSession[],
  now: Date,
): SquadSummary {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    memberIds,
    status: row.status,
    textChannelId: row.textChannelId,
    voiceChannelId: row.voiceChannelId,
    lastConfirmedAt: row.lastConfirmedAt?.toISOString() ?? null,
    upcomingSessions: sessions.map((session) => toSessionSummary(session, now)),
    createdAt: row.createdAt.toISOString(),
  };
}

function toProposalSummary(row: SquadProposal): SquadProposalSummary {
  return {
    id: row.id,
    gameId: row.gameId,
    userIds: row.userIds,
    acceptedIds: row.acceptedIds,
    declinedIds: row.declinedIds,
    squadId: row.squadId,
    threadId: row.threadId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toProfileSummary(row: SquadProfile): SquadProfileSummary {
  return {
    userId: row.userId,
    gameId: row.gameId,
    status: row.status,
    availability: row.availability,
    answers: row.answers,
    lastMatchedAt: row.lastMatchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCheck(evaluation: ManualMatchEvaluation, gameId: string): SquadManualCheck {
  return { gameId, ...evaluation };
}

/** Revisão que recusa vira erro; `done` segue para a resposta da rota. */
function manualOutcome<T>(
  outcome: ManualOutcome<T>,
): Extract<ManualOutcome<T>, { outcome: 'done' }> {
  if (outcome.outcome === 'blocked') {
    const count = outcome.check.blocks.length;
    throw new ApiHttpError(
      422,
      'MANUAL_MATCH_BLOCKED',
      `O grupo tem ${String(count)} ${count === 1 ? 'bloqueio' : 'bloqueios'}. Revise no painel.`,
    );
  }
  if (outcome.outcome === 'unconfirmed') {
    throw new ApiHttpError(
      409,
      'MANUAL_MATCH_UNCONFIRMED',
      'Há avisos que não foram confirmados. Revise de novo.',
    );
  }
  return outcome;
}

/**
 * Canais que contam para o teto do Discord. Thread não conta, e é do cache
 * real da guild, não das linhas de `squads`: o teto é do servidor inteiro, e
 * quem enche o servidor raramente são os squads sozinhos.
 */
function countChannels(guild: Guild): number {
  return guild.channels.cache.filter((channel) => !channel.isThread()).size;
}

async function requireSquad(deps: ApiDeps, guildId: string, squadId: string): Promise<Squad> {
  const squad = await getSquad(deps.db, guildId, squadId);
  if (!squad) throw notFound('Squad não encontrado.', 'SQUAD_NOT_FOUND');
  return squad;
}

async function requireGame(deps: ApiDeps, guildId: string, gameId: string): Promise<SquadGame> {
  const game = await getSquadGame(deps.db, guildId, gameId);
  if (!game) throw notFound('Jogo não encontrado.', 'GAME_NOT_FOUND');
  return game;
}

async function requireProfile(
  deps: ApiDeps,
  guildId: string,
  userId: string,
  gameId: string,
): Promise<SquadProfile> {
  const profile = await getSquadProfile(deps.db, guildId, userId, gameId);
  if (!profile) throw notFound('Esta pessoa não tem perfil neste jogo.', 'PROFILE_NOT_FOUND');
  return profile;
}

async function summaryOf(deps: ApiDeps, guildId: string, squad: Squad): Promise<SquadSummary> {
  const now = new Date();
  const [members, sessions] = await Promise.all([
    listSquadMembers(deps.db, guildId, squad.id),
    listUpcomingSessions(deps.db, guildId, now, { squadIds: [squad.id] }),
  ]);
  return toSquadSummary(
    squad,
    members.map((member) => member.userId),
    sessions,
    now,
  );
}

/**
 * O módulo de squads para o painel (PRD §5.7): o retrato das abas e as ações
 * que precisam do Discord. Jogos e config o painel grava direto no banco e
 * avisa pelo `/config/invalidate`, como nos outros módulos.
 *
 * Toda escrita traz `actorId`: publicar a mensagem fixa, rodar o match, o
 * match manual e a gestão de jogadores são de admin; arquivar e renomear, de
 * moderador. Arquivar, renomear e tirar alguém do squad funcionam com o módulo
 * desligado, porque limpar squad antigo é justamente o que se faz depois de
 * desligar.
 */
export function createSquadRoutes(deps: ApiDeps): Hono<ApiEnv> {
  // Toda escrita daqui manda mensagem, abre thread, mexe em canal ou manda DM:
  // mesmo balde apertado por guild das mensagens do painel (PRD §7.4).
  const writeLimit = guildRateLimit(createRateLimiter({ limit: MESSAGE_LIMIT_PER_MINUTE }));
  const checkLimit = guildRateLimit(createRateLimiter({ limit: MANUAL_CHECK_LIMIT_PER_MINUTE }));

  return (
    new Hono<ApiEnv>()
      /**
       * Squads arquivados ficam de fora: a tabela do painel é de quem ainda
       * joga, e a lista de arquivados só cresce. Cada squad vem com as
       * jogatinas que ainda não acabaram.
       */
      .get('/overview', async (c) => {
        const guild = c.get('guild');
        const [games, squads, proposals, searchingCount] = await Promise.all([
          listSquadGames(deps.db, guild.id),
          listSquads(deps.db, guild.id, { statuses: ['open', 'full'] }),
          listOpenSquadProposals(deps.db, guild.id),
          countSearchingProfilesByGame(deps.db, guild.id),
        ]);

        const now = new Date();
        const squadIds = squads.map((squad) => squad.id);
        const [members, sessions] = await Promise.all([
          listMembersOfSquads(deps.db, guild.id, squadIds),
          listUpcomingSessions(deps.db, guild.id, now, { squadIds }),
        ]);
        const memberIds = new Map<string, string[]>();
        for (const member of members) {
          const list = memberIds.get(member.squadId) ?? [];
          list.push(member.userId);
          memberIds.set(member.squadId, list);
        }
        const upcoming = new Map<string, SquadSession[]>();
        for (const session of sessions) {
          upcoming.set(session.squadId, [...(upcoming.get(session.squadId) ?? []), session]);
        }

        const overview: SquadOverview = {
          games: games.map(toGameSummary),
          squads: squads.map((squad) =>
            toSquadSummary(squad, memberIds.get(squad.id) ?? [], upcoming.get(squad.id) ?? [], now),
          ),
          openProposals: proposals.map(toProposalSummary),
          searchingCount,
          channels: { used: countChannels(guild), limit: MAX_GUILD_CHANNELS },
        };
        return c.json(overview);
      })

      .post(
        '/search-message',
        writeLimit,
        validate('json', PostSquadSearchMessageInputSchema),
        async (c) => {
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          const published = await deps.squads.publishSearchMessage(guild, input.actorId, {
            ...(input.channelId ? { channelId: input.channelId } : {}),
            source: 'dashboard',
          });
          const result: PostSquadSearchMessageResult = published;
          return c.json(result);
        },
      )

      /**
       * O matcher sozinho pula em silêncio o que não dá para rodar (é o que o
       * job quer). Clicando no painel, o motivo precisa voltar, então as
       * checagens baratas vêm antes.
       */
      .post(
        '/games/:gameId/match',
        writeLimit,
        validate('param', SquadGameIdParamSchema),
        validate('json', RunSquadMatchInputSchema),
        async (c) => {
          const { gameId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          const config = await deps.squads.requireConfig(guild.id);
          const game = await getSquadGame(deps.db, guild.id, gameId);
          if (!game) throw notFound('Jogo não encontrado.', 'GAME_NOT_FOUND');
          if (!game.enabled) {
            throw new UserFacingError('Este jogo está desligado. Ligue o jogo antes do match.', {
              code: 'GAME_DISABLED',
            });
          }
          if (!config.searchChannelId) {
            throw new UserFacingError('Escolha o canal de busca antes de rodar o match.', {
              code: 'SQUADS_NO_SEARCH_CHANNEL',
            });
          }

          const result: RunSquadMatchResult = await deps.squads.runMatch(guild.id, gameId);
          return c.json(result);
        },
      )

      .post(
        '/:squadId/archive',
        writeLimit,
        validate('param', SquadIdParamSchema),
        validate('json', ArchiveSquadInputSchema),
        async (c) => {
          const { squadId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'mod');

          const squad = await requireSquad(deps, guild.id, squadId);
          const archived =
            squad.status === 'archived'
              ? null
              : await deps.squads.archive(guild, squadId, {
                  actorId: input.actorId,
                  reason: input.reason,
                  source: 'dashboard',
                });
          // `null` também quando outro clique arquivou entre a leitura e a escrita.
          if (!archived) {
            throw new UserFacingError('Este squad já foi arquivado.', { code: 'SQUAD_ARCHIVED' });
          }
          return c.json(await summaryOf(deps, guild.id, archived));
        },
      )

      /**
       * O nome muda no banco na hora; o canal pode ficar para depois, porque o
       * Discord só deixa renomear canal duas vezes a cada dez minutos.
       */
      .post(
        '/:squadId/rename',
        writeLimit,
        validate('param', SquadIdParamSchema),
        validate('json', RenameSquadInputSchema),
        async (c) => {
          const { squadId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'mod');

          await requireSquad(deps, guild.id, squadId);
          const { squad } = await deps.squads.rename(guild, squadId, input.name, input.actorId, {
            force: true,
            source: 'dashboard',
          });
          return c.json(await summaryOf(deps, guild.id, squad));
        },
      )

      /** Revisão do match manual: o bot vê linhas frescas e quem saiu do servidor. */
      .post(
        '/games/:gameId/manual/check',
        checkLimit,
        validate('param', SquadGameIdParamSchema),
        validate('json', SquadManualCheckInputSchema),
        async (c) => {
          const { gameId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await deps.squads.requireConfig(guild.id);
          await requireGame(deps, guild.id, gameId);
          const check = await deps.squads.checkManualMatch(guild, gameId, input);
          return c.json(toCheck(check, gameId));
        },
      )

      /**
       * Bloqueio é 422 (a turma não serve); aviso sem confirmação é 409 (a
       * situação mudou desde a revisão e o painel precisa mostrar de novo).
       */
      .post(
        '/games/:gameId/manual/propose',
        writeLimit,
        validate('param', SquadGameIdParamSchema),
        validate('json', ProposeSquadManuallyInputSchema),
        async (c) => {
          const { gameId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await deps.squads.requireConfig(guild.id);
          await requireGame(deps, guild.id, gameId);
          const done = manualOutcome(await deps.squads.proposeManually(guild, gameId, input));
          const result: SquadManualProposalResult = {
            proposal: toProposalSummary(done.proposal),
            check: toCheck(done.check, gameId),
          };
          return c.json(result);
        },
      )

      .post(
        '/:squadId/members/:userId/remove',
        writeLimit,
        validate('param', SquadMemberParamSchema),
        validate('json', RemoveSquadMemberInputSchema),
        async (c) => {
          const { squadId, userId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await requireSquad(deps, guild.id, squadId);
          const removed = await deps.squads.removeMemberAsAdmin(guild, squadId, userId, input);
          const result: RemoveSquadMemberResult = {
            squad: await summaryOf(deps, guild.id, removed.squad),
            archived: removed.archived,
            profileStatus: removed.profileStatus,
            notified: removed.notified,
          };
          return c.json(result);
        },
      )

      .post(
        '/games/:gameId/profiles/:userId/status',
        writeLimit,
        validate('param', SquadProfileParamSchema),
        validate('json', SetSquadProfileStatusInputSchema),
        async (c) => {
          const { gameId, userId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await deps.squads.requireConfig(guild.id);
          await requireGame(deps, guild.id, gameId);
          await requireProfile(deps, guild.id, userId, gameId);
          const changed = await deps.squads.setProfileStatusAsAdmin(guild, gameId, userId, input);
          const result: SquadProfileStatusResult = {
            profile: toProfileSummary(changed.profile),
            match: changed.match,
            notified: changed.notified,
          };
          return c.json(result);
        },
      )

      .post(
        '/games/:gameId/profiles/:userId/answers',
        writeLimit,
        validate('param', SquadProfileParamSchema),
        validate('json', EditSquadProfileAnswersInputSchema),
        async (c) => {
          const { gameId, userId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await deps.squads.requireConfig(guild.id);
          await requireGame(deps, guild.id, gameId);
          await requireProfile(deps, guild.id, userId, gameId);
          const edited = await deps.squads.editProfileAnswersAsAdmin(guild, gameId, userId, input);
          const result: SquadProfileAnswersResult = {
            profile: toProfileSummary(edited.profile),
            notified: edited.notified,
          };
          return c.json(result);
        },
      )

      .post(
        '/games/:gameId/profiles/:userId/delete',
        writeLimit,
        validate('param', SquadProfileParamSchema),
        validate('json', DeleteSquadProfileInputSchema),
        async (c) => {
          const { gameId, userId } = c.req.valid('param');
          const input = c.req.valid('json');
          const guild = c.get('guild');
          await requireActor(deps, guild, input.actorId, 'admin');

          await deps.squads.requireConfig(guild.id);
          await requireGame(deps, guild.id, gameId);
          await requireProfile(deps, guild.id, userId, gameId);
          const removed = await deps.squads.deleteProfileAsAdmin(guild, gameId, userId, input);
          const result: DeleteSquadProfileResult = {
            deleted: toProfileSummary(removed.deleted),
            notified: removed.notified,
          };
          return c.json(result);
        },
      )
  );
}
