import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Logger raiz. Lê `process.env` direto (e não `./env`) para que qualquer
 * módulo possa logar sem arrastar a validação de ambiente — que só deve
 * falhar no boot, nunca num teste unitário.
 *
 * `redact` cobre os caminhos por onde um segredo costuma vazar (token do bot,
 * header de autorização da API interna); conteúdo de mensagem nunca é logado
 * acima de `debug` — ver CLAUDE.md.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { app: 'goodbot-bot' },
    redact: {
      paths: [
        'token',
        '*.token',
        'authorization',
        '*.authorization',
        'headers.authorization',
        'req.headers.authorization',
        'DISCORD_TOKEN',
        '*.DISCORD_TOKEN',
        'INTERNAL_API_TOKEN',
        '*.INTERNAL_API_TOKEN',
      ],
      censor: '[redacted]',
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
          },
        }),
  },
  // Em produção escrevemos direto no stdout de forma síncrona: o volume de log
  // do bot é baixo e assim nada se perde quando o container recebe SIGTERM.
  isProduction ? pino.destination({ dest: 1, sync: true }) : undefined,
);

/** Logger filho com um escopo fixo (`{ scope: 'registry' }`). */
export function childLogger(scope: string) {
  return logger.child({ scope });
}
