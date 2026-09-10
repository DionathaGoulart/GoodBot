import { getMaintenance, setMaintenance, type Db, type MaintenanceRecord } from '@goodbot/db';
import { MINUTE_MS } from '@goodbot/shared';

import { childLogger } from '../logger';

import type { MaintenanceState } from '@goodbot/shared';

/**
 * De quanto em quanto tempo a chave é relida. Mesmo intervalo do registro, e
 * pelo mesmo motivo: quem liga a manutenção é uma escrita do painel direto no
 * Postgres, e sem esta releitura o bot só a enxergaria no próximo reinício.
 *
 * Quando quem liga é a **API** do bot (o caminho normal do painel), o espelho é
 * atualizado na hora e este intervalo não chega a ser usado — ele é a rede de
 * segurança para o dia em que a chave for mexida na mão, com o painel fora.
 */
export const MAINTENANCE_REFRESH_MS = MINUTE_MS;

/** O texto que o usuário vê quando não há um escrito pelo dono. */
export const DEFAULT_MAINTENANCE_MESSAGE =
  'O Goodbot está em manutenção e volta em instantes. Nenhuma configuração foi perdida.';

export interface MaintenanceServiceOptions {
  db: Db;
  refreshMs?: number;
  now?: () => number;
}

/**
 * Modo manutenção (plano, Etapa 4).
 *
 * Ligado, o bot continua no ar — `/health` responde, o gateway segue conectado,
 * os eventos continuam sendo registrados — e recusa **interação** com um aviso
 * efêmero. É a diferença entre "estou mexendo no banco" e "caí": derrubar o
 * container faria o Discord marcar o bot como offline e ninguém saberia por quê.
 *
 * A leitura é síncrona e vem de um espelho em memória porque acontece em
 * **toda** interação, logo depois do `registry.serves` — o mesmo motivo e o
 * mesmo desenho do `RegistryService`.
 */
export class MaintenanceService {
  private readonly db: Db;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private readonly log = childLogger('maintenance');
  private state: MaintenanceRecord = { enabled: false, message: null, since: null, by: null };
  private timer: NodeJS.Timeout | null = null;

  constructor(options: MaintenanceServiceOptions) {
    this.db = options.db;
    this.refreshMs = options.refreshMs ?? MAINTENANCE_REFRESH_MS;
    this.now = options.now ?? Date.now;
  }

  async refresh(): Promise<void> {
    this.state = await getMaintenance(this.db);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh().catch((error: unknown) => {
        // O espelho anterior continua valendo: um banco instável não pode
        // decidir sozinho que a manutenção acabou.
        this.log.error({ err: error }, 'não consegui recarregar o modo manutenção');
      });
    }, this.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Caminho quente: sem I/O. */
  active(): boolean {
    return this.state.enabled;
  }

  /** O texto para o embed efêmero de quem tentou usar o bot. */
  message(): string {
    return this.state.message ?? DEFAULT_MAINTENANCE_MESSAGE;
  }

  current(): MaintenanceState {
    return { ...this.state };
  }

  /**
   * Liga ou desliga. Escreve no banco e atualiza o espelho na mesma chamada —
   * é a API do bot que chama isto, então o efeito precisa valer para a próxima
   * interação, não para a próxima releitura.
   */
  async set(input: { enabled: boolean; message: string | null; by: string }): Promise<
    MaintenanceState
  > {
    const record: MaintenanceRecord = {
      enabled: input.enabled,
      message: input.enabled ? input.message : null,
      since: input.enabled ? new Date(this.now()).toISOString() : null,
      by: input.enabled ? input.by : null,
    };
    this.state = await setMaintenance(this.db, record);
    this.log.warn({ enabled: record.enabled, by: input.by }, 'modo manutenção alterado');
    return { ...this.state };
  }
}
