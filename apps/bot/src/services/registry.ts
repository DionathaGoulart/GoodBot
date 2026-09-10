import {
  ensureGuildRegistered,
  isGuildServed,
  listGuildRegistry,
  markGuildLeft,
  seedApprovedGuilds,
  setGuildStatus,
  type Db,
  type GuildRegistryEntry,
  type SetGuildStatusInput,
} from '@goodbot/db';
import { MINUTE_MS, type GuildStatus } from '@goodbot/shared';

import { childLogger } from '../logger';

/**
 * De quanto em quanto tempo o registro inteiro é relido. Aprovar um servidor é
 * uma escrita do painel direto no Postgres, e sem esta releitura o bot só
 * enxergaria a aprovação no próximo reinício. Um minuto é o atraso máximo
 * aceitável entre clicar em "aprovar" e o bot responder lá.
 */
export const REGISTRY_REFRESH_MS = MINUTE_MS;

export interface RegistryServiceOptions {
  db: Db;
  refreshMs?: number;
  now?: () => number;
}

/**
 * Quem o bot atende. Substitui o `GUILD_IDS` como fronteira de segurança
 * (plano, Etapa 1) e é consultado em **toda** interação, então a leitura é
 * síncrona e vem de um espelho em memória — nunca de uma query por evento.
 *
 * O registro inteiro cabe na memória com folga: o teto do produto é 100
 * servidores (as intents privilegiadas passam a exigir verificação acima
 * disso), e cada linha é um punhado de campos.
 */
export class RegistryService {
  private readonly db: Db;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, GuildRegistryEntry>();
  private readonly log = childLogger('registry');
  private timer: NodeJS.Timeout | null = null;

  constructor(options: RegistryServiceOptions) {
    this.db = options.db;
    this.refreshMs = options.refreshMs ?? REGISTRY_REFRESH_MS;
    this.now = options.now ?? Date.now;
  }

  /** Relê o registro inteiro. Chamado no boot e a cada `refreshMs`. */
  async refresh(): Promise<void> {
    const rows = await listGuildRegistry(this.db);
    this.entries.clear();
    for (const row of rows) this.entries.set(row.guildId, row);
    this.log.debug({ guilds: this.entries.size }, 'registro recarregado');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        // Falhar aqui não pode derrubar nada: o espelho anterior continua
        // valendo e a próxima volta tenta de novo.
        this.log.error({ err: error }, 'não consegui recarregar o registro');
      });
    }, this.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** O bot atende esta guild agora? Caminho quente: sem I/O. */
  serves(guildId: string): boolean {
    return isGuildServed(this.entries.get(guildId), new Date(this.now()));
  }

  entry(guildId: string): GuildRegistryEntry | undefined {
    return this.entries.get(guildId);
  }

  status(guildId: string): GuildStatus | undefined {
    return this.entries.get(guildId)?.status;
  }

  /** IDs atendidos agora — o que o `ready` prepara e o `/health` espera. */
  servedGuildIds(): string[] {
    const now = new Date(this.now());
    return [...this.entries.values()]
      .filter((entry) => isGuildServed(entry, now))
      .map((entry) => entry.guildId);
  }

  servedCount(): number {
    return this.servedGuildIds().length;
  }

  /**
   * Promove a `approved` os IDs herdados do `GUILD_IDS`. Idempotente: quem já
   * tem linha não é tocado, então um servidor bloqueado não volta sozinho.
   */
  async seed(guildIds: readonly string[]): Promise<number> {
    const inseridos = await seedApprovedGuilds(this.db, guildIds);
    if (inseridos > 0) {
      this.log.info({ guilds: inseridos }, 'servidores semeados a partir do GUILD_IDS');
    }
    await this.refresh();
    return inseridos;
  }

  /** `GUILD_CREATE`: garante linha (nasce `pending`) e devolve o estado dela. */
  async register(input: {
    guildId: string;
    status?: GuildStatus;
    invitedBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<GuildRegistryEntry> {
    const entry = await ensureGuildRegistered(this.db, input);
    this.entries.set(entry.guildId, entry);
    return entry;
  }

  async setStatus(guildId: string, input: SetGuildStatusInput): Promise<GuildRegistryEntry | null> {
    const entry = await setGuildStatus(this.db, guildId, input);
    if (entry) this.entries.set(guildId, entry);
    return entry;
  }

  /** `GUILD_DELETE`: marca a saída sem apagar o status já decidido. */
  async markLeft(guildId: string): Promise<void> {
    await markGuildLeft(this.db, guildId);
    const entry = this.entries.get(guildId);
    if (entry) this.entries.set(guildId, { ...entry, leftAt: new Date(this.now()) });
  }
}
