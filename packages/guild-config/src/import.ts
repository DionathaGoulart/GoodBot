import { MANAGED_CHANNEL_TYPES, bitfieldToPermissions } from '@goodbot/shared';
import { stringify } from 'yaml';

import { EVERYONE } from './schema';

import type { CurrentState } from './plan';
import type { ChannelTypeName } from './schema';
import type { GuildChannelDetail, GuildChannelSummary } from '@goodbot/shared';

/**
 * O caminho inverso do apply: lê a guild e escreve o `guild.yaml` que a
 * descreve. Sem isto, trazer um servidor que já existe para o controle do
 * arquivo significaria transcrever cada cargo, canal e permissão à mão — e
 * qualquer esquecimento viraria uma diferença falsa no primeiro `plan`.
 *
 * O teste de que a captura ficou fiel é o próprio `plan` logo em seguida: ele
 * tem de sair vazio.
 */

/** O inverso de `CHANNEL_TYPE_NAMES` do schema. */
const TYPE_NAME: Record<number, ChannelTypeName> = {
  [MANAGED_CHANNEL_TYPES.text]: 'text',
  [MANAGED_CHANNEL_TYPES.voice]: 'voice',
  [MANAGED_CHANNEL_TYPES.announcement]: 'announcement',
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export interface ImportedSpec {
  /** Pronto para virar YAML: só os campos que fogem do padrão. */
  doc: Record<string, unknown>;
  warnings: string[];
}

export function buildSpecFromState(state: CurrentState, guildId: string): ImportedSpec {
  const warnings: string[] = [];

  const roleNameById = new Map<string, string>(
    state.roles.map((role) => [role.id, role.id === guildId ? EVERYONE : role.name]),
  );

  // ----- cargos -----
  const seenRoleNames = new Set<string>();
  const roles = state.roles
    .filter((role) => !role.managed && role.id !== guildId)
    // Posição maior fica mais acima no Discord; o yaml lê de cima para baixo.
    .sort((a, b) => b.position - a.position)
    .map((role) => {
      const key = role.name.trim().toLowerCase();
      if (seenRoleNames.has(key)) {
        warnings.push(
          `Há mais de um cargo chamado "${role.name}". O yaml não distingue os dois; revise à mão.`,
        );
      }
      seenRoleNames.add(key);

      const out: Record<string, unknown> = { name: role.name };
      if (role.color !== 0) out.color = hex(role.color);
      if (role.hoist) out.hoist = true;
      if (role.mentionable) out.mentionable = true;
      const permissions = bitfieldToPermissions(role.permissions);
      if (permissions.length > 0) out.permissions = permissions;
      return out;
    });

  // ----- overrides -----
  const overridesOf = (detail: GuildChannelDetail | undefined, alvo: string): unknown[] => {
    const out: Record<string, unknown>[] = [];
    for (const override of detail?.overrides ?? []) {
      if (override.view === 'inherit' && override.send === 'inherit') continue;
      const name = roleNameById.get(override.roleId);
      if (name === undefined) {
        warnings.push(
          `"${alvo}" tem override de um cargo que não está mais na guild (${override.roleId}); ignorado.`,
        );
        continue;
      }
      const entry: Record<string, unknown> = { role: name };
      if (override.view !== 'inherit') entry.view = override.view;
      if (override.send !== 'inherit') entry.send = override.send;
      out.push(entry);
    }
    return out;
  };

  // ----- canais -----
  const byPosition = (a: GuildChannelSummary, b: GuildChannelSummary): number =>
    a.position - b.position;

  const channelDoc = (channel: GuildChannelSummary): Record<string, unknown> | null => {
    const type = TYPE_NAME[channel.type];
    if (type === undefined) {
      warnings.push(
        `"${channel.name}" é de um tipo que o spec não representa (${channel.type}); ficou de fora.`,
      );
      return null;
    }
    const detail = state.details.get(channel.id);
    const out: Record<string, unknown> = { name: channel.name };
    if (type !== 'text') out.type = type;
    if (detail?.topic) out.topic = detail.topic;
    if (detail?.nsfw === true) out.nsfw = true;
    if (detail !== undefined && detail.slowmodeSeconds > 0) out.slowmode = detail.slowmodeSeconds;
    const overrides = overridesOf(detail, channel.name);
    if (overrides.length > 0) out.overrides = overrides;
    return out;
  };

  const isCategory = (c: GuildChannelSummary): boolean => c.type === MANAGED_CHANNEL_TYPES.category;

  const childrenOf = (parentId: string | null): Record<string, unknown>[] =>
    state.channels
      .filter((c) => !isCategory(c) && c.parentId === parentId)
      .sort(byPosition)
      .map(channelDoc)
      .filter((c): c is Record<string, unknown> => c !== null);

  const channels = childrenOf(null);

  const categories = state.channels
    .filter(isCategory)
    .sort(byPosition)
    .map((category) => {
      const detail = state.details.get(category.id);
      const out: Record<string, unknown> = { name: category.name };
      const overrides = overridesOf(detail, category.name);
      if (overrides.length > 0) out.overrides = overrides;
      const filhos = childrenOf(category.id);
      if (filhos.length > 0) out.channels = filhos;
      return out;
    });

  const doc: Record<string, unknown> = {};
  if (roles.length > 0) doc.roles = roles;
  if (channels.length > 0) doc.channels = channels;
  if (categories.length > 0) doc.categories = categories;

  return { doc, warnings };
}

const cabecalho = (origem: string): string =>
  `# Gerado por \`pnpm guild ${origem}\`. Retrato do servidor no momento da captura.
#
# Daqui em diante o arquivo é a fonte: edite, rode \`pnpm guild plan\` para ver a
# diferença e \`pnpm guild apply\` para escrever.
#
# Não há ID nenhum aqui de propósito — tudo é por nome, resolvido contra a guild
# durante o apply. Os segredos ficam no .env ao lado, que não é versionado.
#
# O que a captura NÃO traz, porque o spec não representa: fóruns, palcos,
# tópicos, threads, emojis, stickers, eventos e webhooks. Eles continuam
# existindo no servidor; o apply simplesmente não mexe neles.
`;

/**
 * `origem` é o comando que escreveu o arquivo. Vai no cabeçalho porque a
 * primeira pergunta de quem abre um yaml que não escreveu é como refazê-lo, e
 * `scan` e `import` não se refazem do mesmo jeito.
 */
export function toYaml(spec: ImportedSpec, nome?: string, origem = 'scan'): string {
  const doc = nome === undefined ? spec.doc : { name: nome, ...spec.doc };
  return `${cabecalho(origem)}\n${stringify(doc, { lineWidth: 0 })}`;
}
