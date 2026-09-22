/** O que decide se uma jogatina acabou. */
export interface SessionEndFields {
  endsAt: Date;
  startedAt: Date | null;
  voiceReleasedAt: Date | null;
}

/**
 * A jogatina acabou: passou do fim previsto (`ends_at`) ou, depois do início,
 * a reserva foi liberada porque o voice esvaziou. Liberação antes do início
 * não conta: é a sala que não saiu (a jogatina vai sem sala) ou a remarcação
 * devolvendo a sala, e nos dois casos a jogatina ainda vai acontecer.
 * Cancelamento fica com quem chama, que em geral diz outra coisa.
 */
export function isSessionOver(session: SessionEndFields, now: number): boolean {
  if (session.endsAt.getTime() <= now) return true;
  const { startedAt, voiceReleasedAt } = session;
  return (
    startedAt !== null &&
    voiceReleasedAt !== null &&
    voiceReleasedAt.getTime() >= startedAt.getTime()
  );
}
