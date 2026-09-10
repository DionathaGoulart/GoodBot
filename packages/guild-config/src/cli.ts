import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { createInternalClient } from '@goodbot/shared';

import { DEFAULT_MIN_INTERVAL_MS, Throttle, applyPlan } from './apply';
import { destructiveOps, formatPlan } from './format';
import { buildSpecFromState, toYaml } from './import';
import { ConfigError, listServers, loadServer, loadServerEnv, loadSpec } from './load';
import { buildPlan } from './plan';
import { fetchState } from './state';

import type { LoadedServer } from './load';
import type { InternalClient } from '@goodbot/shared';

/**
 * Uma guild grande faz o bot enfileirar chamadas no rate limit do próprio
 * Discord, e aí a resposta demora mais do que os 10 s do painel.
 */
const CLI_TIMEOUT_MS = 30_000;

const USO = `
goodbot-guild — aplica um guild.yaml num servidor do Discord

  pnpm guild list
  pnpm guild import --server <slug> [--force]
  pnpm guild plan   --server <slug> [--allow-delete] [--reorder]
  pnpm guild apply  --server <slug> [--allow-delete] [--reorder] [--yes] [--interval <ms>]

  import  lê o servidor e escreve o guild.yaml que o descreve.
  plan    mostra o que mudaria. Não escreve nada.
  apply   mostra o mesmo plano e executa depois de confirmar.

  --force         no import, sobrescreve um guild.yaml que já exista.
  --allow-delete  inclui remoções no plano. Sem isto, o apply só cria e edita.
  --reorder       corrige a ordem dos cargos (uma chamada por casa; é lento).
  --yes           não pergunta. Remoções continuam exigindo confirmação digitada.
  --interval      pausa entre chamadas, em ms (padrão ${DEFAULT_MIN_INTERVAL_MS}).
`;

interface Args {
  command: string;
  server?: string;
  allowDelete: boolean;
  reorder: boolean;
  yes: boolean;
  force: boolean;
  interval: number;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? 'help',
    allowDelete: false,
    reorder: false,
    yes: false,
    force: false,
    interval: DEFAULT_MIN_INTERVAL_MS,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--server' || flag === '-s') args.server = argv[++i];
    else if (flag === '--allow-delete') args.allowDelete = true;
    else if (flag === '--reorder') args.reorder = true;
    else if (flag === '--yes' || flag === '-y') args.yes = true;
    else if (flag === '--force') args.force = true;
    else if (flag === '--interval') args.interval = Number(argv[++i] ?? DEFAULT_MIN_INTERVAL_MS);
    else if (flag !== undefined && flag.startsWith('-')) {
      throw new ConfigError(`Flag desconhecida: ${flag}`);
    }
  }
  return args;
}

function requireServer(args: Args): LoadedServer {
  if (args.server === undefined) {
    const disponiveis = listServers();
    throw new ConfigError(
      `Faltou --server. ${disponiveis.length > 0 ? `Disponíveis: ${disponiveis.join(', ')}` : 'Nenhum servidor em infra/discord ainda.'}`,
    );
  }
  return loadServer(args.server);
}

async function confirm(pergunta: string, esperado?: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const resposta = (await rl.question(pergunta)).trim();
    return esperado === undefined ? /^(s|sim|y|yes)$/i.test(resposta) : resposta === esperado;
  } finally {
    rl.close();
  }
}

/** Cliente da API com o timeout folgado do CLI. */
function clientFor(env: { INTERNAL_API_URL: string; INTERNAL_API_TOKEN: string }): InternalClient {
  return createInternalClient({
    baseUrl: env.INTERNAL_API_URL.replace(/\/$/u, ''),
    token: env.INTERNAL_API_TOKEN,
    timeoutMs: CLI_TIMEOUT_MS,
  });
}

async function runImport(args: Args): Promise<number> {
  if (args.server === undefined) throw new ConfigError('Faltou --server.');
  const { dir, env } = loadServerEnv(args.server);
  const destino = join(dir, 'guild.yaml');

  if (existsSync(destino) && !args.force) {
    process.stderr.write(
      `${destino} já existe. Use --force para sobrescrever (o arquivo atual se perde).\n`,
    );
    return 1;
  }

  const api = clientFor(env);
  const throttle = new Throttle(args.interval);

  process.stdout.write(`Lendo "${args.server}"...\n`);
  const state = await fetchState(api, env.GUILD_ID, () => throttle.wait());
  const imported = buildSpecFromState(state, env.GUILD_ID);

  const perfil = await api.guildProfile(env.GUILD_ID).catch(() => null);
  writeFileSync(destino, toYaml(imported, perfil?.name), 'utf8');
  process.stdout.write(`\nEscrito: ${destino}\n`);

  for (const warning of imported.warnings) process.stdout.write(`  ! ${warning}\n`);

  // A prova de que a captura ficou fiel: reler o arquivo e conferir que ele
  // não pede nenhuma mudança. Se pedir, o import deixou algo passar.
  const plan = buildPlan(loadSpec(destino), state, { guildId: env.GUILD_ID });
  if (plan.operations.length === 0) {
    process.stdout.write('\nConferido: o plano contra este arquivo sai vazio.\n');
    return 0;
  }

  process.stdout.write(
    `\nAtenção: o plano ainda acusa ${plan.operations.length} diferença(s). ` +
      'O import não capturou tudo:\n',
  );
  process.stdout.write(`${formatPlan(plan, args.server)}\n`);
  return 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    process.stdout.write(`${USO}\n`);
    return 0;
  }

  if (args.command === 'list') {
    const servidores = listServers();
    if (servidores.length === 0) {
      process.stdout.write('Nenhum servidor configurado em infra/discord.\n');
      return 0;
    }
    for (const slug of servidores) process.stdout.write(`  ${slug}\n`);
    return 0;
  }

  if (args.command === 'import') return await runImport(args);

  if (args.command !== 'plan' && args.command !== 'apply') {
    process.stderr.write(`Comando desconhecido: ${args.command}\n${USO}\n`);
    return 2;
  }

  const server = requireServer(args);
  const api = clientFor(server.env);
  const throttle = new Throttle(args.interval);

  process.stdout.write(`Lendo o estado atual de "${server.slug}"...\n`);
  const current = await fetchState(api, server.env.GUILD_ID, () => throttle.wait());

  const plan = buildPlan(server.spec, current, {
    guildId: server.env.GUILD_ID,
    allowDelete: args.allowDelete,
    reorder: args.reorder,
  });

  process.stdout.write(`\n${formatPlan(plan, server.spec.name ?? server.slug)}\n\n`);

  if (args.command === 'plan') return 0;
  if (plan.operations.length === 0) return 0;

  const remocoes = destructiveOps(plan);
  if (remocoes.length > 0) {
    // Remoção nunca passa no `--yes`: apagar canal leva as mensagens junto.
    const ok = await confirm(
      `São ${remocoes.length} remoções irreversíveis. Digite APAGAR para confirmar: `,
      'APAGAR',
    );
    if (!ok) {
      process.stdout.write('Cancelado.\n');
      return 1;
    }
  } else if (!args.yes) {
    if (!(await confirm('Aplicar? [s/N] '))) {
      process.stdout.write('Cancelado.\n');
      return 1;
    }
  }

  const result = await applyPlan(plan, current, {
    api,
    guildId: server.env.GUILD_ID,
    actorId: server.env.ACTOR_ID,
    reason: `guild.yaml de ${server.slug}`,
    throttle,
    onStep: ({ index, total, label, ok, error }) => {
      const marca = ok ? 'ok  ' : 'FALHA';
      process.stdout.write(
        `  [${index}/${total}] ${marca} ${label}${error === undefined ? '' : ` — ${error}`}\n`,
      );
    },
  });

  process.stdout.write(`\n${result.applied} de ${plan.operations.length} aplicadas.\n`);
  if (result.failures.length > 0) {
    process.stdout.write(
      `${result.failures.length} falharam. Rode "plan" de novo para ver o que sobrou.\n`,
    );
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n${message}\n`);
    process.exitCode = 1;
  });
