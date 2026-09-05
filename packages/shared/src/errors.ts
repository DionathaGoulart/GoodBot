/**
 * Erro cuja mensagem pode ser mostrada ao usuário final (embed efêmero no bot,
 * toast no painel). Qualquer outro erro é considerado interno: sobe, é logado
 * e o usuário recebe uma mensagem genérica.
 */
export class UserFacingError extends Error {
  /** Código estável para i18n/telemetria (ex.: `'HIERARCHY'`, `'NOT_FOUND'`). */
  readonly code: string;
  /** No bot: responder de forma efêmera (padrão `true`). */
  readonly ephemeral: boolean;

  constructor(
    message: string,
    options: { code?: string; ephemeral?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'UserFacingError';
    this.code = options.code ?? 'USER_ERROR';
    this.ephemeral = options.ephemeral ?? true;
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return error instanceof UserFacingError;
}
