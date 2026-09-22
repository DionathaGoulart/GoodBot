/**
 * Versão do Goodbot exibida em embeds, `/ping` e no painel.
 *
 * Espelha a `version` do `package.json` da raiz, que é a versão do produto
 * (CONTRIBUTING §10). Fica como literal, e não como import do JSON, para o
 * bundle do bot e o do painel não dependerem de um arquivo fora do pacote;
 * o `version.test.ts` reprova a CI se os dois divergirem.
 */
export const VERSION = '1.0.1';

export * from './constants';
export * from './deploy';
export * from './duration';
export * from './snowflake';
export * from './urls';
export * from './errors';
export * from './templates';
export * from './config/index';
export * from './api/index';
export * from './squads/index';
