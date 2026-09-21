import { MANAGED_CHANNEL_TYPES, bitfieldToPermissions, dangerousPermissions } from '@goodbot/shared';

import { EVERYONE } from './schema';

import type { CurrentState } from './plan';
import type {
  AdminGuildLive,
  ChannelOverride,
  GuildChannelSummary,
  GuildRoleSummary,
  InternalClient,
  PermissionName,
} from '@goodbot/shared';

/**
 * A varredura: pega o servidor pelo nome, lê a estrutura inteira e escreve um
 * `servidor.md` legível.
 *
 * O `guild.yaml` ao lado é a mesma informação em forma executável, e é ele que
 * o `plan` compara. Este arquivo existe para a outra metade do trabalho: para
 * decidir *o que* mudar é preciso primeiro entender o que há, e um yaml de
 * oitocentas linhas descreve sem explicar. A seção de observações é o ponto —
 * ela não repete os dados, aponta o que neles parece errado.
 */

export class ScanError extends Error {}

/** Só ASCII, minúsculas e hífen: vira nome de pasta em `infra/discord`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return slug === '' ? 'servidor' : slug;
}

const norm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .trim()
    .toLowerCase();

/**
 * Acha a guild pelo que você digitou. Aceita o ID, o nome inteiro ou um
 * pedaço dele.
 *
 * Um pedaço que casa com dois servidores é erro, não escolha: aplicar a
 * reforma no servidor errado é caro o bastante para valer a pergunta.
 */
export async function resolveGuild(api: InternalClient, termo: string): Promise<AdminGuildLive> {
  const { guilds } = await api.admin.guilds();
  if (guilds.length === 0) {
    throw new ScanError('O bot não está em nenhum servidor.');
  }

  const alvo = norm(termo);
  const porId = guilds.find((guild) => guild.id === termo.trim());
  if (porId) return porId;

  const exatos = guilds.filter((guild) => norm(guild.name) === alvo);
  if (exatos.length === 1) return exatos[0] as AdminGuildLive;

  const parciais = exatos.length > 0 ? exatos : guilds.filter((g) => norm(g.name).includes(alvo));
  if (parciais.length === 1) return parciais[0] as AdminGuildLive;

  if (parciais.length === 0) {
    throw new ScanError(
      `Nenhum servidor casa com "${termo}". O bot está em:\n${listar(guilds)}`,
    );
  }
  throw new ScanError(
    `"${termo}" casa com mais de um servidor. Seja específico (ou passe o ID):\n${listar(parciais)}`,
  );
}

export function listar(guilds: AdminGuildLive[]): string {
  return guilds.map((guild) => `  ${guild.name}  (${guild.id})`).join('\n');
}

// ── a análise ────────────────────────────────────────────────────────────────

/** Tipos de canal que existem no Discord mas o spec não representa. */
const TIPO_FORA_DO_ALCANCE: Record<number, string> = {
  13: 'palco',
  15: 'fórum',
  16: 'mídia',
};

const TIPO: Record<number, string> = {
  [MANAGED_CHANNEL_TYPES.text]: 'texto',
  [MANAGED_CHANNEL_TYPES.voice]: 'voz',
  [MANAGED_CHANNEL_TYPES.announcement]: 'anúncio',
  ...TIPO_FORA_DO_ALCANCE,
};

const numero = (valor: number): string => new Intl.NumberFormat('pt-BR').format(valor);

const plural = (n: number, um: string, varios: string): string =>
  `${numero(n)} ${n === 1 ? um : varios}`;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

const isCategoria = (channel: GuildChannelSummary): boolean =>
  channel.type === MANAGED_CHANNEL_TYPES.category;

/** Canal de texto o Discord escreve com `#`; voz e fórum, não. */
const rotulo = (channel: GuildChannelSummary): string =>
  channel.type === MANAGED_CHANNEL_TYPES.text ||
  channel.type === MANAGED_CHANNEL_TYPES.announcement
    ? `#${channel.name}`
    : channel.name;

/**
 * Permissões que contam na tabela de cargos. A lista inteira do Discord tem
 * quase cinquenta entradas e a maioria é ruído — `AddReactions` num cargo de
 * membro não diz nada sobre como o servidor é governado. Estas dizem.
 */
const RELEVANTES: PermissionName[] = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageWebhooks',
  'ManageNicknames',
  'ManageEvents',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
  'MentionEveryone',
  'ViewAuditLog',
];

function permissoesEmDestaque(bitfield: string): string {
  const todas = bitfieldToPermissions(bitfield);
  if (todas.includes('Administrator')) return '**Administrator** (tudo)';
  const fortes = RELEVANTES.filter((nome) => todas.includes(nome));
  if (fortes.length > 0) return fortes.join(', ');
  return todas.length === 0 ? '—' : `${numero(todas.length)} básicas`;
}

function descreverOverride(override: ChannelOverride, nome: string): string {
  const partes: string[] = [];
  if (override.view !== 'inherit') partes.push(override.view === 'allow' ? 'vê' : 'não vê');
  if (override.send !== 'inherit') {
    partes.push(override.send === 'allow' ? 'escreve' : 'não escreve');
  }
  return `\`${nome}\` — ${partes.join(', ')}`;
}

interface AnaliseInput {
  guild: AdminGuildLive;
  state: CurrentState;
  /** Avisos que o `buildSpecFromState` levantou ao montar o yaml. */
  avisosDoYaml: string[];
}

export function renderAnalysis({ guild, state, avisosDoYaml }: AnaliseInput): string {
  const nomePorCargoId = new Map(
    state.roles.map((role) => [role.id, role.id === guild.id ? EVERYONE : role.name]),
  );

  const everyone = state.roles.find((role) => role.id === guild.id);
  const cargosDeBot = state.roles.filter((role) => role.managed);
  const cargos = state.roles
    .filter((role) => !role.managed && role.id !== guild.id)
    .sort((a, b) => b.position - a.position);

  const canais = state.channels.filter((channel) => !isCategoria(channel));
  const categorias = state.channels.filter(isCategoria).sort((a, b) => a.position - b.position);

  const linhas: string[] = [];
  const p = (texto = ''): void => void linhas.push(texto);

  // ----- cabeçalho -----
  // Sem snowflake nenhum, nem o do servidor nem o do dono: o servidor.md é
  // versionado ao lado do guild.yaml, e os dois seguem a mesma regra de não
  // carregar ID (o GUILD_ID mora no .env, que é gitignored).
  p(`# ${guild.name}`);
  p();
  p(`- **Membros** ${numero(guild.memberCount)}`);
  p(`- **Dono** ${guild.ownerTag ?? '(fora do cache)'}`);
  p(`- **Varrido em** ${new Date().toLocaleString('pt-BR')}`);
  p();
  p('> Retrato do servidor na hora da varredura, gerado por `pnpm guild scan`.');
  p('> Para reformar, edite o `guild.yaml` ao lado, rode `pnpm guild plan` para');
  p('> ver a diferença e `pnpm guild apply` para escrever.');
  p();

  // ----- cargos -----
  p(`## Cargos (${numero(cargos.length)})`);
  p();
  p('Do topo da hierarquia para a base — é nesta ordem que eles aparecem no');
  p('`guild.yaml`, e é ela que decide quem manda em quem.');
  p();
  p('| # | Cargo | Cor | Destacado | Mencionável | Permissões |');
  p('| --- | --- | --- | --- | --- | --- |');
  cargos.forEach((role, i) => {
    const cor = role.color === 0 ? '—' : `\`${hex(role.color)}\``;
    p(
      `| ${String(i + 1)} | ${role.name} | ${cor} | ${role.hoist ? 'sim' : 'não'} ` +
        `| ${role.mentionable ? 'sim' : 'não'} | ${permissoesEmDestaque(role.permissions)} |`,
    );
  });
  p();
  if (everyone) {
    p(`\`@everyone\`: ${permissoesEmDestaque(everyone.permissions)}`);
    p();
  }
  if (cargosDeBot.length > 0) {
    const nomes = cargosDeBot.map((role) => role.name).join(', ');
    p(`**Cargos de bot** (o Discord não deixa editar): ${nomes}`);
    p();
  }

  // ----- canais -----
  p(`## Canais (${numero(categorias.length)} categorias, ${numero(canais.length)} canais)`);
  p();

  const filhosDe = (parentId: string | null): GuildChannelSummary[] =>
    canais.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position);

  const escreverCanal = (channel: GuildChannelSummary): void => {
    const detail = state.details.get(channel.id);
    const marcas: string[] = [TIPO[channel.type] ?? `tipo ${String(channel.type)}`];
    if (detail?.nsfw === true) marcas.push('nsfw');
    if (detail !== undefined && detail.slowmodeSeconds > 0) {
      marcas.push(`slowmode ${String(detail.slowmodeSeconds)}s`);
    }
    p(`- **${rotulo(channel)}** · ${marcas.join(' · ')}`);
    if (detail?.topic) p(`  - _${detail.topic}_`);
    for (const override of detail?.overrides ?? []) {
      const nome = nomePorCargoId.get(override.roleId);
      p(`  - ${descreverOverride(override, nome ?? `cargo ${override.roleId} (sumiu)`)}`);
    }
  };

  const soltos = filhosDe(null);
  if (soltos.length > 0) {
    p('### Sem categoria');
    p();
    soltos.forEach(escreverCanal);
    p();
  }

  for (const categoria of categorias) {
    p(`### ${categoria.name}`);
    p();
    const detail = state.details.get(categoria.id);
    for (const override of detail?.overrides ?? []) {
      const nome = nomePorCargoId.get(override.roleId);
      p(`- _(categoria)_ ${descreverOverride(override, nome ?? `cargo ${override.roleId}`)}`);
    }
    const filhos = filhosDe(categoria.id);
    if (filhos.length === 0) p('- _(vazia)_');
    filhos.forEach(escreverCanal);
    p();
  }

  // ----- observações -----
  p('## Observações');
  p();
  const observacoes = observar({ guild, state, cargos, canais, categorias, everyone });

  // O `buildSpecFromState` avisa canal por canal sobre tipo que não sabe
  // representar, e a observação acima já os agrupa numa linha. Repetir os dois
  // faria a seção parecer mais longa do que o problema é.
  const jaDito = state.channels
    .filter((channel) => TIPO_FORA_DO_ALCANCE[channel.type] !== undefined)
    .map((channel) => `"${channel.name}"`);
  for (const aviso of avisosDoYaml) {
    if (!jaDito.some((nome) => aviso.includes(nome))) observacoes.push(aviso);
  }
  if (observacoes.length === 0) {
    p('Nada fora do lugar saltou aos olhos.');
  } else {
    for (const obs of observacoes) p(`- ${obs}`);
  }
  p();

  return linhas.join('\n');
}

interface ObservarInput {
  guild: AdminGuildLive;
  state: CurrentState;
  cargos: GuildRoleSummary[];
  canais: GuildChannelSummary[];
  categorias: GuildChannelSummary[];
  everyone: GuildRoleSummary | undefined;
}

/**
 * O que na estrutura parece engano. Nada aqui é conclusivo — são pistas para
 * quem vai decidir a reforma, não veredictos.
 */
function observar({
  state,
  cargos,
  canais,
  categorias,
  everyone,
}: ObservarInput): string[] {
  const out: string[] = [];

  if (everyone) {
    const perigosas = dangerousPermissions(everyone.permissions);
    if (perigosas.length > 0) {
      out.push(
        `\`@everyone\` tem permissão perigosa: ${perigosas.join(', ')}. ` +
          'Vale conferir se é intencional.',
      );
    }
  }

  const contar = (nomes: string[]): Map<string, number> => {
    const mapa = new Map<string, number>();
    for (const nome of nomes) mapa.set(norm(nome), (mapa.get(norm(nome)) ?? 0) + 1);
    return mapa;
  };

  for (const [nome, n] of contar(cargos.map((c) => c.name))) {
    if (n > 1) {
      out.push(
        `Há ${numero(n)} cargos chamados "${nome}". O \`guild.yaml\` casa por nome ` +
          'e não distingue os dois — resolva antes de aplicar qualquer coisa.',
      );
    }
  }

  for (const [nome, n] of contar(canais.map((c) => c.name))) {
    if (n > 1) out.push(`Há ${numero(n)} canais chamados "${nome}", em categorias diferentes.`);
  }

  const vazias = categorias.filter(
    (categoria) => !canais.some((c) => c.parentId === categoria.id),
  );
  if (vazias.length > 0) {
    const rotulo = vazias.length === 1 ? 'Categoria vazia' : 'Categorias vazias';
    out.push(`${rotulo}: ${vazias.map((c) => c.name).join(', ')}.`);
  }

  const soltos = canais.filter((c) => c.parentId === null);
  if (soltos.length > 0) {
    out.push(
      `${plural(soltos.length, 'canal', 'canais')} fora de qualquer categoria: ` +
        `${soltos.map(rotulo).join(', ')}.`,
    );
  }

  const semPermissao = cargos.filter((role) => bitfieldToPermissions(role.permissions).length === 0);
  if (semPermissao.length > 0) {
    const rotulo = semPermissao.length === 1 ? 'Cargo sem' : 'Cargos sem';
    out.push(
      `${rotulo} nenhuma permissão — etiqueta ou alvo de override, sem poder próprio: ` +
        `${semPermissao.map((role) => role.name).join(', ')}.`,
    );
  }

  const foraDoAlcance = state.channels.filter(
    (channel) => TIPO_FORA_DO_ALCANCE[channel.type] !== undefined,
  );
  if (foraDoAlcance.length > 0) {
    const lista = foraDoAlcance
      .map((c) => `${c.name} (${TIPO_FORA_DO_ALCANCE[c.type] ?? '?'})`)
      .join(', ');
    out.push(
      `Fora do alcance do \`guild.yaml\` — existem no servidor e o apply não os ` +
        `toca: ${lista}.`,
    );
  }

  out.push(
    'Emojis, stickers, eventos, webhooks e threads não entram nesta varredura ' +
      'nem no `guild.yaml`; continuam intactos.',
  );

  return out;
}
