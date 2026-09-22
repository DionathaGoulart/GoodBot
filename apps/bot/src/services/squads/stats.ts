import {
  getSquad,
  getSquadGame,
  listPlayedSessions,
  listPlayedSessionsByGame,
  listSessionAttendance,
} from '@goodbot/db';
import {
  DAY_MS,
  presenceMs,
  SQUAD_HISTORY_RECENT_DAYS,
  SQUAD_HISTORY_WINDOW_DAYS,
  summarizeFormations,
  summarizePairs,
  summarizePlayers,
  UserFacingError,
} from '@goodbot/shared';

import type { SquadContext } from './context';
import type { PlayerStatsView, SquadStatsView } from './embeds';
import type { SessionAttendanceRow, SquadGame, SquadSession } from '@goodbot/db';

/** Quantas duplas, grupos e pessoas cada lista de números mostra. */
export const STATS_LISTED = 5;

/**
 * Os números das jogatinas prontos para mostrar: `/squad stats` (de uma pessoa
 * num jogo) e o botão NÚMEROS do guia (do squad inteiro). A conta é toda da
 * regra pura de `shared/squads/stats.ts`; aqui só se lê o banco e se escolhe a
 * janela.
 *
 * A janela é a mesma do histórico: 90 dias de detalhe, com o último mês
 * destacado à parte. Ler tudo desde sempre seria uma varredura de toda a
 * presença do servidor a cada clique, e é justamente o que a janela do
 * histórico evita.
 */
export class StatsService {
  constructor(private readonly ctx: SquadContext) {}

  /** O começo da janela de detalhe. */
  private since(): Date {
    return new Date(this.ctx.now() - SQUAD_HISTORY_WINDOW_DAYS * DAY_MS);
  }

  /** A presença das jogatinas dadas; lista vazia não consulta nada. */
  private attendance(guildId: string, sessions: readonly SquadSession[]) {
    return listSessionAttendance(
      this.ctx.db,
      guildId,
      sessions.map((session) => session.id),
    );
  }

  /**
   * Sem jogo (cascata do banco em curso), nenhum grupo é "party cheia": é o
   * mesmo que o relatório faz.
   */
  private options(game: SquadGame | null) {
    return { now: this.ctx.date(), partySize: game?.partySize ?? Infinity };
  }

  /**
   * Os números de uma pessoa num jogo, somando todos os squads dela naquele
   * jogo: tempo, formações, presença e com quem mais joga. Quem nunca apareceu
   * vem zerado, e não como erro: "ainda não jogou" é resposta.
   */
  async forPlayer(guildId: string, gameId: string, userId: string): Promise<PlayerStatsView> {
    const game = await getSquadGame(this.ctx.db, guildId, gameId);
    if (!game) {
      throw new UserFacingError('Jogo não encontrado. Escolha um da lista.', {
        code: 'GAME_NOT_FOUND',
      });
    }
    const sessions = await listPlayedSessionsByGame(this.ctx.db, guildId, gameId, this.since());
    const rows = await this.attendance(guildId, sessions);
    const options = this.options(game);

    const stats = summarizePlayers(sessions, rows, options).find(
      (player) => player.userId === userId,
    );
    // Só as duplas e os grupos de quem se pediu: o corte vem depois do filtro,
    // senão o top 5 do servidor inteiro engoliria as duplas dela.
    const pairs = summarizePairs(rows, { now: options.now })
      .filter((pair) => pair.userIds.includes(userId))
      .slice(0, STATS_LISTED);
    const groups = summarizeFormations(rows, options)
      .groups.filter((group) => group.userIds.includes(userId))
      .slice(0, STATS_LISTED);

    return {
      userId,
      game,
      windowDays: SQUAD_HISTORY_WINDOW_DAYS,
      recentDays: SQUAD_HISTORY_RECENT_DAYS,
      ms: stats?.ms ?? 0,
      msRecent: this.recentMs(sessions, rows, userId, options.now),
      bySize: stats?.bySize ?? [],
      sessions: stats?.sessions ?? 0,
      played: sessions.length,
      going: stats?.going ?? 0,
      noShows: stats?.noShows ?? 0,
      attendanceRate: stats?.attendanceRate ?? null,
      pairs,
      groups,
      embedColor: await this.ctx.embedColor(guildId),
    };
  }

  /** O tempo da pessoa só nas jogatinas do último mês. */
  private recentMs(
    sessions: readonly SquadSession[],
    rows: readonly SessionAttendanceRow[],
    userId: string,
    now: Date,
  ): number {
    const from = now.getTime() - SQUAD_HISTORY_RECENT_DAYS * DAY_MS;
    const recent = new Set(
      sessions.filter((session) => session.startsAt.getTime() >= from).map((s) => s.id),
    );
    return presenceMs(
      rows.filter((row) => row.userId === userId && recent.has(row.sessionId)),
      now,
    );
  }

  /**
   * Os números de um squad: o ranking de quem mais joga, as formações do squad
   * e as duplas e os grupos que mais jogam juntos. Convidado avulso entra no
   * tempo e nas formações, como manda a regra pura.
   */
  async forSquad(guildId: string, squadId: string): Promise<SquadStatsView> {
    const squad = await getSquad(this.ctx.db, guildId, squadId);
    if (!squad) throw new UserFacingError('Este squad não existe mais.', { code: 'NO_SQUAD' });
    const game = await getSquadGame(this.ctx.db, guildId, squad.gameId);
    const sessions = await listPlayedSessions(this.ctx.db, guildId, [squadId], this.since());
    const rows = await this.attendance(guildId, sessions);
    const options = this.options(game);

    const formations = summarizeFormations(rows, { ...options, limit: STATS_LISTED });
    return {
      squad,
      game: game ?? { name: 'o jogo', partySize: Infinity },
      windowDays: SQUAD_HISTORY_WINDOW_DAYS,
      played: sessions.length,
      // O tempo de sala: cada trecho conta uma vez, e não uma por pessoa nele.
      ms: formations.bySize.reduce((total, size) => total + size.ms, 0),
      players: summarizePlayers(sessions, rows, options).slice(0, STATS_LISTED),
      formations,
      pairs: summarizePairs(rows, { now: options.now, limit: STATS_LISTED }),
      embedColor: await this.ctx.embedColor(guildId),
    };
  }
}
