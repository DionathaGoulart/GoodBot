import { describe } from './apply';

import type { Operation, Plan } from './plan';

const DESTRUCTIVE = new Set<Operation['kind']>([
  'role.delete',
  'channel.delete',
  'category.delete',
]);

export const isDestructive = (operation: Operation): boolean => DESTRUCTIVE.has(operation.kind);

export const destructiveOps = (plan: Plan): Operation[] => plan.operations.filter(isDestructive);

/**
 * O plano impresso é a única coisa que o usuário lê antes de autorizar a
 * escrita. As remoções saem num bloco separado no fim, porque são as únicas
 * que não têm volta.
 */
export function formatPlan(plan: Plan, servidor: string): string {
  const lines: string[] = [];
  const safe = plan.operations.filter((op) => !isDestructive(op));
  const danger = destructiveOps(plan);

  lines.push(`Plano para "${servidor}"`);
  lines.push('');

  if (plan.warnings.length > 0) {
    lines.push('Avisos:');
    for (const warning of plan.warnings) lines.push(`  ! ${warning}`);
    lines.push('');
  }

  if (plan.operations.length === 0) {
    lines.push('  Nada a fazer: a guild já corresponde ao guild.yaml.');
    return lines.join('\n');
  }

  if (safe.length > 0) {
    lines.push(`Criar e editar (${safe.length}):`);
    for (const operation of safe) lines.push(`  + ${describe(operation)}`);
    lines.push('');
  }

  if (danger.length > 0) {
    lines.push(`REMOVER (${danger.length}) — irreversível, leva o conteúdo junto:`);
    for (const operation of danger) lines.push(`  - ${describe(operation)}`);
    lines.push('');
  }

  lines.push(`Total: ${plan.operations.length} chamadas à API do bot.`);
  return lines.join('\n');
}
