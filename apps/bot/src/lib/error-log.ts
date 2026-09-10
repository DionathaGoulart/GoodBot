import { metrics } from '../metrics';

import type { ErrorEntry } from '@goodbot/shared';

/**
 * Quantos erros o anel guarda. Cem cobre uma rajada inteira sem virar memória
 * relevante (~20 KB), e o container tem 384 MB no total.
 */
export const ERROR_LOG_SIZE = 100;

/**
 * Os últimos erros do processo, para o card "Saúde e uso" do painel admin
 * (plano, Etapa 4).
 *
 * O `/metrics` já conta **quantos** erros houve por escopo; isto diz **quais**,
 * que é o que decide se vale abrir o log da VM. Nada aqui substitui o pino: a
 * stack continua indo para lá inteira, e o que fica na memória é só a linha
 * que dá para ler numa tela.
 *
 * Some no restart, de propósito. Persistir erro em tabela seria mais uma
 * escrita por falha — logo, mais uma coisa para falhar quando o banco é o que
 * está com problema.
 */
class ErrorLog {
  private readonly entries: ErrorEntry[] = [];

  push(entry: ErrorEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > ERROR_LOG_SIZE) this.entries.length = ERROR_LOG_SIZE;
  }

  /** Do mais novo para o mais velho. */
  recent(limit = ERROR_LOG_SIZE): ErrorEntry[] {
    return this.entries.slice(0, limit);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const errorLog = new ErrorLog();

export interface ErrorContext {
  /** Comando, evento ou `custom_id` em que aconteceu. */
  where?: string | null;
  guildId?: string | null;
}

/** Mensagem curta e sem stack — o painel mostra uma linha, não um dump. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Registra um erro nos dois lugares de uma vez: o contador do `/metrics` e o
 * anel que o painel admin lê. Andam juntos de propósito — um escopo contado
 * mas invisível na tela é exatamente o que faz alguém procurar no lugar errado.
 */
export function recordError(scope: string, error: unknown, context: ErrorContext = {}): void {
  metrics.errors.inc({ scope });
  errorLog.push({
    at: new Date().toISOString(),
    scope,
    message: describe(error).slice(0, 300),
    where: context.where ?? null,
    guildId: context.guildId ?? null,
  });
}
