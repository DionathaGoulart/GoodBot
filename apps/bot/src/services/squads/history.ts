import { countPlayedSessions, listPlayedSessions, listSessionAttendance } from '@goodbot/db';
import {
  DAY_MS,
  formatHistory,
  SQUAD_HISTORY_WINDOW_DAYS,
  summarizeHistory,
} from '@goodbot/shared';

import type { SquadContext } from './context';
import type { SquadHistory, SquadHistoryAttendance } from '@goodbot/shared';

/** O histórico de um squad pronto para mostrar: o resumo e a frase dele. */
export interface SquadHistoryView {
  summary: SquadHistory;
  /** `formatHistory` no fuso e nas faixas da guild. */
  text: string;
}

/**
 * O histórico de jogatinas dos squads, lido do banco e resumido pela regra de
 * `shared`. Quem mostra (guia, convite, `/squad procurar`, chamada pública e
 * painel) pede aqui, e a leitura custa o mesmo para um squad ou para todos:
 * três consultas, nunca uma por squad.
 */
export class HistoryService {
  constructor(private readonly ctx: SquadContext) {}

  /** Um resumo por squad pedido; squad que nunca jogou vem com "Ainda não jogaram.". */
  async load(guildId: string, squadIds: readonly string[]): Promise<Map<string, SquadHistoryView>> {
    const views = new Map<string, SquadHistoryView>();
    const ids = [...new Set(squadIds)];
    if (ids.length === 0) return views;

    const { db } = this.ctx;
    const now = this.ctx.date();
    const since = new Date(now.getTime() - SQUAD_HISTORY_WINDOW_DAYS * DAY_MS);
    const [config, settings, sessions, totals] = await Promise.all([
      this.ctx.config.get(guildId, 'squads'),
      this.ctx.config.getSettings(guildId),
      listPlayedSessions(db, guildId, ids, since),
      countPlayedSessions(db, guildId, ids),
    ]);
    const attendance = await listSessionAttendance(
      db,
      guildId,
      sessions.map((session) => session.id),
    );

    const squadOf = new Map(sessions.map((session) => [session.id, session.squadId]));
    const presentBySquad = new Map<string, SquadHistoryAttendance[]>();
    for (const row of attendance) {
      const squadId = squadOf.get(row.sessionId);
      if (squadId) presentBySquad.set(squadId, [...(presentBySquad.get(squadId) ?? []), row]);
    }
    const totalsBySquad = new Map(totals.map((row) => [row.squadId, row]));
    const options = { now, timeZone: settings.timezone, blocks: config.blocks };

    for (const squadId of ids) {
      const summary = summarizeHistory({
        sessions: sessions.filter((session) => session.squadId === squadId),
        attendance: presentBySquad.get(squadId) ?? [],
        totals: totalsBySquad.get(squadId) ?? null,
        ...options,
      });
      views.set(squadId, { summary, text: formatHistory(summary, options) });
    }
    return views;
  }

  /** O histórico de um squad só. */
  async one(guildId: string, squadId: string): Promise<SquadHistoryView> {
    const view = (await this.load(guildId, [squadId])).get(squadId);
    if (!view) throw new Error(`histórico do squad ${squadId} não foi montado`);
    return view;
  }
}
