import {
  getSquad,
  getSquadGame,
  listSessionAttendance,
  listSessionsToReport,
  markSessionReported,
} from '@goodbot/db';
import { DAY_MS, summarizeSession } from '@goodbot/shared';

import { log } from './context';

import type { SquadContext } from './context';
import type { SquadSession } from '@goodbot/db';
import type { SessionSummary } from '@goodbot/shared';
import type { Guild } from 'discord.js';

/**
 * Até onde o job procura jogatina por relatar. Uma jogatina dura no máximo
 * 12 h; o dia de folga cobre um restart, e o que é mais velho que isso fica
 * sem relatório, porque publicar uma semana de jogatinas de uma vez quando o
 * bot volta é barulho, não registro.
 */
export const REPORT_LOOKBACK_MS = DAY_MS;

/**
 * O relatório de fim de jogatina: a mensagem dela vira **Jogatina encerrada**,
 * com quanto durou, quem jogou e por quanto tempo, os convidados, as formações
 * (quanto foi de quarteto, de trio, solo), quem faltou depois de dizer VOU e
 * quem apareceu sem avisar.
 *
 * É uma edição, não uma mensagem nova, e isso é de propósito: editar não
 * notifica ninguém, e o relatório é registro do que passou, não chamado. Quem
 * quiser marcar de novo tem o REPETIR, que continua na mensagem.
 *
 * A trava é `reported_at`, gravado antes de editar: duas passadas do job
 * relatam uma vez só. O relatório espera toda presença da jogatina fechar
 * (`listSessionsToReport`), senão o tempo de quem ficou na sala sairia menor
 * do que foi.
 */
export class ReportService {
  constructor(private readonly ctx: SquadContext) {}

  /**
   * Passo do job: relata as jogatinas que acabaram. Nunca lança; falha numa
   * não impede as outras, e a jogatina sem relatório volta na próxima passada
   * (a trava só é gravada quando o relatório é montado).
   */
  async reportFinished(guild: Guild): Promise<number> {
    let reported = 0;
    try {
      const due = await listSessionsToReport(this.ctx.db, guild.id, {
        now: this.ctx.date(),
        since: new Date(this.ctx.now() - REPORT_LOOKBACK_MS),
      });
      for (const session of due) {
        if (await this.report(guild, session)) reported++;
      }
    } catch (error) {
      log.warn({ err: error, guildId: guild.id }, 'falha ao relatar as jogatinas encerradas');
    }
    return reported;
  }

  /**
   * Uma jogatina. `false` quando outra passada relatou primeiro ou quando o
   * squad já não existe. A edição da mensagem vem depois da trava: se ela
   * falhar, o relatório não sai de novo, mas a próxima reedição da jogatina
   * (um REPETIR, por exemplo) já mostra o estado encerrado.
   */
  async report(guild: Guild, session: SquadSession): Promise<boolean> {
    const { db } = this.ctx;
    const squad = await getSquad(db, guild.id, session.squadId);
    if (!squad) return false;
    const reported = await markSessionReported(db, guild.id, session.id, this.ctx.date());
    if (!reported) return false;

    log.info({ guildId: guild.id, sessionId: session.id }, 'jogatina relatada');
    await this.ctx.parts.sessions.refresh(guild, reported.id);
    // O guia mostra o histórico, e esta jogatina acabou de entrar nele.
    await this.ctx.parts.guide.refresh(guild, squad.id);
    return true;
  }

  /**
   * Os números de uma jogatina, prontos para a mensagem. Convidado entra à
   * parte (`as_guest`), como manda a regra pura.
   */
  async load(guildId: string, session: SquadSession): Promise<SessionSummary> {
    const [rows, squad] = await Promise.all([
      listSessionAttendance(this.ctx.db, guildId, [session.id]),
      getSquad(this.ctx.db, guildId, session.squadId),
    ]);
    const game = squad ? await getSquadGame(this.ctx.db, guildId, squad.gameId) : null;
    return summarizeSession(session, rows, {
      now: this.ctx.date(),
      // Sem jogo (cascata do banco em curso), nenhum grupo é "party cheia".
      partySize: game?.partySize ?? Infinity,
    });
  }
}
