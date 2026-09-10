import { countWarnsSince } from '@goodbot/db';
import { DAY_MS } from '@goodbot/shared';

import type { Db } from '@goodbot/db';
import type { ModerationConfig } from '@goodbot/shared';

export type EscalationStep = ModerationConfig['escalation']['steps'][number];

/**
 * Escolhe o degrau que a contagem atual de warns dispara.
 *
 * O gatilho é **igualdade** (`count === step.warns`), não `>=`: com degraus em
 * 3 e 5 warns, o quarto warn não pode reaplicar a ação do terceiro. Cada
 * degrau tem a sua própria janela, então `counts` traz uma contagem por
 * `withinDays`. Havendo mais de um degrau satisfeito, vence o de maior
 * `warns` (o mais severo).
 */
export function matchEscalationStep(
  steps: readonly EscalationStep[],
  counts: ReadonlyMap<number, number>,
): EscalationStep | null {
  let match: EscalationStep | null = null;
  for (const step of steps) {
    if (counts.get(step.withinDays) !== step.warns) continue;
    if (!match || step.warns > match.warns) match = step;
  }
  return match;
}

/** Janelas distintas entre os degraus — uma query de contagem por janela. */
export function escalationWindows(steps: readonly EscalationStep[]): number[] {
  return [...new Set(steps.map((step) => step.withinDays))].sort((a, b) => a - b);
}

export interface ResolveEscalationInput {
  db: Db;
  guildId: string;
  targetId: string;
  config: ModerationConfig;
  now?: Date;
}

/**
 * Conta os warns nas janelas configuradas e devolve o degrau disparado, ou
 * `null`. Quem aplica a punição é o `ModerationService` — manter a decisão
 * separada da execução evita um ciclo entre os dois módulos e deixa a regra
 * testável sem Discord.
 */
export async function resolveEscalation(
  input: ResolveEscalationInput,
): Promise<EscalationStep | null> {
  const { escalation } = input.config;
  if (!escalation.enabled || escalation.steps.length === 0) return null;

  const now = input.now ?? new Date();
  const counts = new Map<number, number>();
  for (const days of escalationWindows(escalation.steps)) {
    const since = new Date(now.getTime() - days * DAY_MS);
    counts.set(days, await countWarnsSince(input.db, input.guildId, input.targetId, since));
  }

  return matchEscalationStep(escalation.steps, counts);
}
