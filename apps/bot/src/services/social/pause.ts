import { SOCIAL_MAX_FAILURES, SOCIAL_PAUSE_BASE_MS, SOCIAL_PAUSE_MAX_MS } from '@goodbot/shared';

/**
 * Quanto tempo a conta fica em pausa depois de `failures` falhas seguidas.
 *
 * Abaixo do teto não há pausa: a passada seguinte tenta de novo. No teto a
 * pausa começa em 15 min e dobra a cada falha, até 1 h. Até a v2.x a décima
 * falha desligava a conta de vez, e uma indisponibilidade de algumas horas do
 * YouTube (404 no feed, que depois voltou sozinho) deixava o anúncio parado até
 * alguém perceber. A pausa resolve os dois lados: não bate a cada três minutos
 * numa API fora do ar e volta sozinha quando ela volta.
 *
 * O teto já foi de 6 h, e foi o que fez a falha parecer maior do que era: a
 * conta só tentava de novo a cada 4 h no fim da noite, então a volta do feed
 * era notada até 4 h depois de acontecer.
 */
export function socialPauseMs(failures: number): number | null {
  if (failures < SOCIAL_MAX_FAILURES) return null;
  // O limite do expoente só evita `Infinity` num contador absurdo: o teto de
  // 1 h já é alcançado na segunda dobra.
  const doublings = Math.min(failures - SOCIAL_MAX_FAILURES, 16);
  return Math.min(SOCIAL_PAUSE_BASE_MS * 2 ** doublings, SOCIAL_PAUSE_MAX_MS);
}

/** Se a conta está em pausa neste instante. Pausa vencida volta para a passada. */
export function isSocialPaused(pausedUntil: Date | null, now: number): boolean {
  return pausedUntil !== null && pausedUntil.getTime() > now;
}
