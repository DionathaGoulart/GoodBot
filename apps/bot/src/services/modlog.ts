import { childLogger } from '../logger';

import type { Case } from '@cobot/db';

/**
 * Publicação de casos no canal de mod-log. A implementação real (fila por
 * canal com coalescing, edição da mensagem quando o caso muda) é a Etapa 5;
 * aqui existe só o contrato para que `ModerationService` já chame o lugar
 * certo e não precise ser mexido depois.
 */
export interface ModlogService {
  /** Publica um caso recém-criado. Nunca lança: falhar o log não desfaz a punição. */
  postCase(kase: Case): Promise<void>;
  /** Reflete uma edição de motivo na mensagem já publicada. */
  updateCase(kase: Case): Promise<void>;
}

/** Stub da Etapa 4: só registra em log de debug. */
export function createModlogService(): ModlogService {
  const log = childLogger('modlog');
  return {
    postCase(kase) {
      log.debug({ caseNumber: kase.caseNumber, type: kase.type }, 'mod-log pendente (etapa 5)');
      return Promise.resolve();
    },
    updateCase(kase) {
      log.debug({ caseNumber: kase.caseNumber }, 'edição de mod-log pendente (etapa 5)');
      return Promise.resolve();
    },
  };
}
