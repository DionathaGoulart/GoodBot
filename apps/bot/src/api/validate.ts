import { zValidator } from '@hono/zod-validator';

import { ApiHttpError } from './errors';

import type { ValidationTargets } from 'hono';
import type { z } from 'zod';

/**
 * `zValidator` com o formato de erro da casa: todo 400 de validação sai como
 * `{error: {code, message, issues}}`, igual ao resto da API, e nunca com o
 * dump do Zod (que carrega os valores recebidos).
 */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;
    throw new ApiHttpError(
      400,
      'VALIDATION',
      'Dados inválidos.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  });
}
