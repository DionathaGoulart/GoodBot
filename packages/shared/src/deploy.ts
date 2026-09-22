/**
 * Que tipo de deploy é este, pelo que mudou desde a versão no ar. É o que
 * decide se o bot reinicia e que aviso de manutenção os servidores recebem,
 * com a previsão de volta de cada tipo. Puro: a CI passa a lista de arquivos
 * (`git diff --name-only <no ar> <novo>`) e o bot usa o tipo para escrever o
 * aviso.
 *
 * - `none`: nada que entra na imagem do bot nem na VM (painel, docs, CI). O bot
 *   não é reconstruído nem reiniciado, e ninguém é avisado.
 * - `restart`: código ou dependências do bot. Reinício rápido.
 * - `database`: tem migration nova. O schema muda antes do reinício.
 * - `infra`: compose, Caddy ou scripts da VM. Pode recriar mais que o bot,
 *   inclusive a porta por onde o painel fala com ele.
 */
export const DEPLOY_KINDS = ['none', 'restart', 'database', 'infra'] as const;
export type DeployKind = (typeof DEPLOY_KINDS)[number];

/** Os tipos que reiniciam o bot, e por isso avisam. */
export const NOTICE_DEPLOY_KINDS = ['restart', 'database', 'infra'] as const;
export type NoticeDeployKind = (typeof NOTICE_DEPLOY_KINDS)[number];

/**
 * Quanto o bot fica fora, por tipo, com folga. Medido na E2.1.Micro: o
 * container novo responde em ~15 s e o reinício inteiro fica abaixo de 1 min;
 * migration e infra ganham margem para o primeiro boot no schema novo e para
 * o Caddy subir de novo.
 */
export const DEPLOY_DOWNTIME_MINUTES: Record<NoticeDeployKind, number> = {
  restart: 1,
  database: 2,
  infra: 3,
};

/** Arquivos que a VM recebe do repositório a cada deploy (o passo `scp`). */
const INFRA_PATHS = [
  /^infra\/docker-compose\.yml$/,
  /^infra\/Caddyfile$/,
  /^infra\/fail2ban\//,
  /^infra\/scripts\//,
];

const DATABASE_PATHS = [/^packages\/db\/drizzle\//];

/**
 * O que entra na imagem do bot (`infra/docker/bot.Dockerfile`): o código dos
 * três pacotes, os manifests e o lockfile. O `package.json` do painel entra
 * porque o `pnpm install --frozen-lockfile` do build lê o workspace inteiro.
 */
const RESTART_PATHS = [
  /^apps\/bot\//,
  /^packages\/shared\//,
  /^packages\/db\//,
  /^apps\/web\/package\.json$/,
  /^infra\/docker\/bot\.Dockerfile$/,
  /^\.dockerignore$/,
  /^\.nvmrc$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
];

const matches = (path: string, patterns: readonly RegExp[]) =>
  patterns.some((pattern) => pattern.test(path));

/** O tipo mais pesado de dois: `infra` > `database` > `restart` > `none`. */
export function heavierDeploy(a: DeployKind, b: DeployKind): DeployKind {
  return DEPLOY_KINDS.indexOf(a) >= DEPLOY_KINDS.indexOf(b) ? a : b;
}

/** O tipo de um deploy pelos arquivos que mudaram; vale o mais pesado. */
export function classifyDeploy(paths: readonly string[]): DeployKind {
  let kind: DeployKind = 'none';
  for (const raw of paths) {
    const path = raw.trim();
    if (!path) continue;
    if (matches(path, INFRA_PATHS)) return 'infra';
    if (matches(path, DATABASE_PATHS)) kind = heavierDeploy(kind, 'database');
    else if (matches(path, RESTART_PATHS)) kind = heavierDeploy(kind, 'restart');
  }
  return kind;
}
