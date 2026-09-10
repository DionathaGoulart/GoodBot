import 'server-only';

import { InternalApiError } from '@goodbot/shared';

import type { ActionResult } from './module-config';

/**
 * Erro da API do bot virando toast (§6.8). As mensagens que o bot manda já são
 * feitas para o usuário ("Esse cargo está acima do cargo do bot"), então elas
 * passam direto; o resto vira um texto genérico, porque não sabemos o que tem
 * dentro.
 */
export function failure(error: unknown, fallback = 'O bot não respondeu.'): ActionResult {
  if (error instanceof InternalApiError) {
    return {
      ok: false,
      message: error.code === 'NETWORK' || error.code === 'TIMEOUT' ? fallback : error.message,
    };
  }
  return { ok: false, message: fallback };
}
