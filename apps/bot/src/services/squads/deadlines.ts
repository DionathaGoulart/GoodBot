import { SECOND_MS } from '@goodbot/shared';

/** De quanto em quanto tempo os prazos vencidos das salas são cobrados. */
export const SQUADS_TICK_MS = 15 * SECOND_MS;

/**
 * Prazos por guild e por id: o da sala vazia e o da reserva (id = canal). Mora
 * em memória de propósito (PRD §5.11): um restart perde tudo e a reconciliação
 * recomeça a contar do zero.
 */
export class DeadlineBook<T extends { at: number } = { at: number }> {
  private readonly byGuild = new Map<string, Map<string, T>>();

  set(guildId: string, id: string, deadline: T): void {
    let guild = this.byGuild.get(guildId);
    if (!guild) {
      guild = new Map();
      this.byGuild.set(guildId, guild);
    }
    guild.set(id, deadline);
  }

  get(guildId: string, id: string): T | undefined {
    return this.byGuild.get(guildId)?.get(id);
  }

  clear(guildId: string, id: string): void {
    const guild = this.byGuild.get(guildId);
    if (!guild) return;
    guild.delete(id);
    if (guild.size === 0) this.byGuild.delete(guildId);
  }

  clearGuild(guildId: string): void {
    this.byGuild.delete(guildId);
  }

  /** Tira do livro e devolve o que venceu até `now`. */
  takeDue(now: number): { guildId: string; id: string; deadline: T }[] {
    const due: { guildId: string; id: string; deadline: T }[] = [];
    for (const [guildId, guild] of this.byGuild) {
      for (const [id, deadline] of guild) {
        if (deadline.at > now) continue;
        due.push({ guildId, id, deadline });
        guild.delete(id);
      }
      if (guild.size === 0) this.byGuild.delete(guildId);
    }
    return due;
  }

  get size(): number {
    let total = 0;
    for (const guild of this.byGuild.values()) total += guild.size;
    return total;
  }
}
