import { MINUTE_MS, SECOND_MS, VERSION } from '@cobot/shared';

import { STATUS_COLORS } from '../lib/embeds';
import { childLogger } from '../logger';

const log = childLogger('alerts');

/** Janela de dedupe: o mesmo alerta não repete dentro de 5 min (PRD §11). */
export const DEDUPE_WINDOW_MS = 5 * MINUTE_MS;
/** Um webhook lento não pode segurar o shutdown. */
export const ALERT_TIMEOUT_MS = 5 * SECOND_MS;

export type AlertLevel = 'info' | 'warning' | 'danger' | 'success';

export interface AlertInput {
  /** Chave do dedupe: o mesmo `kind` não repete dentro da janela. */
  kind: string;
  title: string;
  description?: string;
  level?: AlertLevel;
  fields?: { name: string; value: string }[];
  /** Ignora o dedupe (boot, shutdown — eventos que sempre importam). */
  force?: boolean;
}

export interface AlertServiceOptions {
  /** Sem URL o serviço vira no-op: em dev ninguém configura webhook. */
  webhookUrl?: string;
  dedupeWindowMs?: number;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

/**
 * Alertas operacionais num webhook de Discord (PRD §11). É o canal mais barato
 * possível: sem Prometheus, sem Alertmanager, sem e-mail — o dono do servidor
 * já está no Discord o dia inteiro.
 *
 * Três invariantes: **nunca lança** (um alerta que quebra o bot é pior do que
 * alerta nenhum), **nunca bloqueia** por muito tempo (timeout de 5 s) e
 * **nunca loga a URL** — ela contém o token do webhook.
 */
export class AlertService {
  private readonly options: AlertServiceOptions;
  private readonly now: () => number;
  private readonly lastSent = new Map<string, number>();
  /** Alertas suprimidos por dedupe desde o último envio de cada chave. */
  private readonly suppressed = new Map<string, number>();

  constructor(options: AlertServiceOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return Boolean(this.options.webhookUrl);
  }

  /**
   * Enfileira um alerta sem esperar pelo envio. É o que quase todo chamador
   * quer: um handler de evento não deve pagar a latência do webhook.
   */
  emit(input: AlertInput): void {
    void this.send(input);
  }

  /** Envia e espera. Devolve `false` quando foi suprimido ou falhou. */
  async send(input: AlertInput): Promise<boolean> {
    const url = this.options.webhookUrl;
    if (!url) return false;

    const at = this.now();
    const window = this.options.dedupeWindowMs ?? DEDUPE_WINDOW_MS;
    const last = this.lastSent.get(input.kind);
    if (!input.force && last !== undefined && at - last < window) {
      this.suppressed.set(input.kind, (this.suppressed.get(input.kind) ?? 0) + 1);
      return false;
    }

    const repeats = this.suppressed.get(input.kind) ?? 0;
    this.lastSent.set(input.kind, at);
    this.suppressed.delete(input.kind);

    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(input, repeats)),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? ALERT_TIMEOUT_MS),
      });
      if (!response.ok) {
        // `status` e nada mais: o corpo de erro do Discord ecoa a URL.
        log.warn({ status: response.status, kind: input.kind }, 'webhook de alerta recusou');
        return false;
      }
      return true;
    } catch (error) {
      log.warn({ err: error, kind: input.kind }, 'falha ao enviar alerta');
      return false;
    }
  }
}

const LEVEL_COLOR: Record<AlertLevel, number> = {
  info: STATUS_COLORS.info,
  warning: STATUS_COLORS.warning,
  danger: STATUS_COLORS.danger,
  success: STATUS_COLORS.success,
};

/** Corpo do webhook. Exportado para os testes conferirem o formato. */
export function buildPayload(input: AlertInput, suppressed = 0): unknown {
  const fields = [...(input.fields ?? [])];
  if (suppressed > 0) {
    fields.push({ name: 'Repetições silenciadas', value: String(suppressed) });
  }

  return {
    username: 'CoBot',
    embeds: [
      {
        title: `> ${input.title.toUpperCase()}`,
        description: input.description,
        color: LEVEL_COLOR[input.level ?? 'warning'],
        fields: fields.map((field) => ({ ...field, inline: true })),
        footer: { text: `COBOT v${VERSION} · ALERTA` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
