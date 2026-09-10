import { MINUTE_MS, SECOND_MS } from '@goodbot/shared';

/** Quem ligou o modo raid: o gatilho automático ou um admin com `/raid on`. */
export type RaidSource = 'auto' | 'manual';

export interface RaidState {
  guildId: string;
  source: RaidSource;
  /** Instante em que o modo expira. */
  until: number;
  /** Regra que disparou o modo automático (ausente no manual). */
  ruleId?: string;
}

export interface RaidJoinConfig {
  joins: number;
  intervalSeconds: number;
}

/**
 * Contador de entradas e estado do modo raid, por guild. Em memória: um
 * ataque de entradas é medido em segundos e não sobrevive a um restart do bot
 * (PRD §5.2).
 */
export class RaidService {
  private readonly joins = new Map<string, number[]>();
  private readonly states = new Map<string, RaidState>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Registra uma entrada e diz se o gatilho automático foi atingido. Só conta
   * quando a janela estoura — o modo já ativo não é reativado.
   */
  recordJoin(guildId: string, config: RaidJoinConfig): boolean {
    const at = this.now();
    const since = at - config.intervalSeconds * SECOND_MS;
    const kept = (this.joins.get(guildId) ?? []).filter((time) => time > since);
    kept.push(at);
    this.joins.set(guildId, kept);
    return kept.length >= config.joins;
  }

  /** Estado ativo da guild, ou `null` (expira sozinho). */
  get(guildId: string): RaidState | null {
    const state = this.states.get(guildId);
    if (!state) return null;
    if (state.until <= this.now()) {
      this.states.delete(guildId);
      return null;
    }
    return state;
  }

  isActive(guildId: string): boolean {
    return this.get(guildId) !== null;
  }

  activate(input: {
    guildId: string;
    source: RaidSource;
    minutes: number;
    ruleId?: string;
  }): RaidState {
    const state: RaidState = {
      guildId: input.guildId,
      source: input.source,
      until: this.now() + input.minutes * MINUTE_MS,
      ...(input.ruleId ? { ruleId: input.ruleId } : {}),
    };
    this.states.set(input.guildId, state);
    // Zera o contador: as entradas do ataque já foram contabilizadas.
    this.joins.delete(input.guildId);
    return state;
  }

  /** `true` quando havia um modo ativo para desligar. */
  deactivate(guildId: string): boolean {
    const active = this.get(guildId) !== null;
    this.states.delete(guildId);
    this.joins.delete(guildId);
    return active;
  }

  /** Estados que acabaram de expirar (para o alerta de fim no mod-log). */
  expired(): RaidState[] {
    const at = this.now();
    const done: RaidState[] = [];
    for (const [guildId, state] of this.states) {
      if (state.until <= at) {
        done.push(state);
        this.states.delete(guildId);
      }
    }
    return done;
  }

  clear(): void {
    this.joins.clear();
    this.states.clear();
  }
}
