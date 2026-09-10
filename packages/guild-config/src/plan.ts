import { MANAGED_CHANNEL_TYPES, PERMISSION_BITS, permissionsToBitfield } from '@cobot/shared';

import { EVERYONE } from './schema';

import type { CategorySpec, ChannelSpec, GuildSpec, OverrideSpec, RoleSpec } from './schema';
import type { GuildChannelDetail, GuildChannelSummary, GuildRoleSummary } from '@cobot/shared';

/**
 * Toda operação aponta para o alvo **pelo nome**, nunca por ID. Um `create`
 * mais cedo no plano é o que dá o ID que um `overrides.set` mais tarde precisa,
 * e esse ID só existe durante o apply — por isso o plano é de intenção, e a
 * resolução nome para ID acontece na execução (ver `apply.ts`).
 */
export type Operation =
  | { kind: 'role.create'; name: string; spec: RoleSpec }
  | { kind: 'role.update'; name: string; spec: RoleSpec; changes: string[] }
  | { kind: 'role.delete'; name: string }
  | { kind: 'role.move'; name: string; direction: 'up' | 'down' }
  | { kind: 'category.create'; name: string }
  | { kind: 'channel.create'; name: string; category: string | null; spec: ChannelSpec }
  | {
      kind: 'channel.update';
      name: string;
      category: string | null;
      spec: ChannelSpec;
      changes: string[];
    }
  | { kind: 'channel.delete'; name: string; category: string | null }
  | { kind: 'category.delete'; name: string }
  | {
      kind: 'overrides.set';
      target: string;
      /** Distingue canal solto de categoria: os dois tem `category: null`. */
      targetKind: 'category' | 'channel';
      category: string | null;
      overrides: OverrideSpec[];
    };

export interface CurrentState {
  roles: GuildRoleSummary[];
  channels: GuildChannelSummary[];
  /** Detalhe por ID de canal — só do que já existe na guild. */
  details: Map<string, GuildChannelDetail>;
}

export interface PlanOptions {
  guildId: string;
  /** Sem isto, nada é apagado: o plano só cria e edita. */
  allowDelete?: boolean;
  /** Reordenar cargos custa uma chamada por casa; fica atrás de uma flag. */
  reorder?: boolean;
}

export interface Plan {
  operations: Operation[];
  warnings: string[];
}

/** Só os bits que o painel conhece; o resto do bitfield é preservado pelo bot. */
const MANAGED_MASK = Object.values(PERMISSION_BITS).reduce((acc, bit) => acc | bit, 0n);

const norm = (value: string): string => value.trim().toLowerCase();

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function bitfieldOf(spec: RoleSpec): bigint {
  return BigInt(permissionsToBitfield(spec.permissions));
}

function currentManagedBits(role: GuildRoleSummary): bigint {
  try {
    return BigInt(role.permissions) & MANAGED_MASK;
  } catch {
    return 0n;
  }
}

function roleChanges(spec: RoleSpec, current: GuildRoleSummary): string[] {
  const changes: string[] = [];
  if (spec.name !== current.name) changes.push(`nome: ${current.name} para ${spec.name}`);
  if (spec.color !== current.color) {
    changes.push(`cor: ${hex(current.color)} para ${hex(spec.color)}`);
  }
  if (spec.hoist !== current.hoist) changes.push(`hoist: ${current.hoist} para ${spec.hoist}`);
  if (spec.mentionable !== current.mentionable) {
    changes.push(`mencionavel: ${current.mentionable} para ${spec.mentionable}`);
  }
  if (bitfieldOf(spec) !== currentManagedBits(current)) changes.push('permissoes');
  return changes;
}

function channelChanges(spec: ChannelSpec, detail: GuildChannelDetail | undefined): string[] {
  if (!detail) return [];
  const changes: string[] = [];
  if ((spec.topic ?? null) !== (detail.topic ?? null)) changes.push('topico');
  if (spec.nsfw !== detail.nsfw) changes.push(`nsfw: ${detail.nsfw} para ${spec.nsfw}`);
  if (spec.slowmode !== detail.slowmodeSeconds) {
    changes.push(`slowmode: ${detail.slowmodeSeconds}s para ${spec.slowmode}s`);
  }
  return changes;
}

/** Override que não libera nem nega nada não precisa existir no canal. */
const meaningful = (o: { view: string; send: string }): boolean =>
  o.view !== 'inherit' || o.send !== 'inherit';

/**
 * `detail` ausente é canal que ainda vai nascer: ele nasce sem override
 * nenhum, então só há trabalho a fazer se o spec pedir algum. Cargo do spec
 * que ainda não existe também obriga a escrever, porque o ID dele só aparece
 * durante o apply.
 */
function overridesMatch(
  spec: OverrideSpec[],
  detail: GuildChannelDetail | undefined,
  roleIdByName: Map<string, string>,
): boolean {
  const wanted = spec.filter(meaningful);
  if (!detail) return wanted.length === 0;

  const resolved = new Map<string, OverrideSpec>();
  for (const override of wanted) {
    const id = roleIdByName.get(norm(override.role));
    if (id === undefined) return false;
    resolved.set(id, override);
  }
  const current = detail.overrides.filter(meaningful);
  if (current.length !== resolved.size) return false;
  return current.every((o) => {
    const want = resolved.get(o.roleId);
    return want !== undefined && want.view === o.view && want.send === o.send;
  });
}

/** Chave de canal: um nome só é único dentro de uma categoria. */
const channelKey = (parentId: string | null, name: string): string =>
  `${parentId ?? ''} ${norm(name)}`;

function channelIndex(channels: GuildChannelSummary[]): Map<string, GuildChannelSummary> {
  const index = new Map<string, GuildChannelSummary>();
  for (const channel of channels) {
    const key = channelKey(channel.parentId, channel.name);
    if (!index.has(key)) index.set(key, channel);
  }
  return index;
}

export function buildPlan(spec: GuildSpec, current: CurrentState, options: PlanOptions): Plan {
  const operations: Operation[] = [];
  const warnings: string[] = [];

  // ----- cargos -----
  const editableRoles = current.roles.filter(
    (role) => !role.managed && role.id !== options.guildId,
  );
  const roleByName = new Map<string, GuildRoleSummary>();
  for (const role of editableRoles) {
    const key = norm(role.name);
    if (roleByName.has(key)) {
      warnings.push(`Há mais de um cargo chamado "${role.name}"; o apply usa o primeiro.`);
      continue;
    }
    roleByName.set(key, role);
  }

  /** Inclui `@everyone`, que é alvo válido de override. */
  const roleIdByName = new Map<string, string>([...roleByName].map(([k, r]) => [k, r.id]));
  roleIdByName.set(norm(EVERYONE), options.guildId);

  const specRoleNames = new Set<string>();
  for (const roleSpec of spec.roles) {
    const key = norm(roleSpec.name);
    if (specRoleNames.has(key)) {
      warnings.push(`O spec declara "${roleSpec.name}" duas vezes; a segunda é ignorada.`);
      continue;
    }
    if (key === norm(EVERYONE)) {
      warnings.push('`@everyone` não é gerenciado como cargo; use-o apenas em `overrides`.');
      continue;
    }
    specRoleNames.add(key);

    const existing = roleByName.get(key);
    if (!existing) {
      operations.push({ kind: 'role.create', name: roleSpec.name, spec: roleSpec });
      continue;
    }
    const changes = roleChanges(roleSpec, existing);
    if (changes.length > 0) {
      operations.push({ kind: 'role.update', name: roleSpec.name, spec: roleSpec, changes });
    }
  }

  if (options.reorder) {
    const moves = reorderOperations(spec.roles, editableRoles, specRoleNames);
    if (moves.length > 0) {
      warnings.push(
        `Reordenar cargos custa ${moves.length} chamadas: a API move uma casa por vez.`,
      );
      operations.push(...moves);
    }
  }

  // ----- categorias e canais -----
  const byName = channelIndex(current.channels);
  const categoryByName = new Map<string, GuildChannelSummary>();
  for (const category of current.channels) {
    if (category.type !== MANAGED_CHANNEL_TYPES.category) continue;
    const key = norm(category.name);
    if (!categoryByName.has(key)) categoryByName.set(key, category);
  }

  const seenChannels = new Set<string>();
  const seenCategories = new Set<string>();

  const planChannel = (channelSpec: ChannelSpec, category: CategorySpec | null): void => {
    const parent = category ? categoryByName.get(norm(category.name)) : undefined;
    // Categoria que ainda vai nascer não pode ter filho antigo para casar.
    const existing =
      category && !parent
        ? undefined
        : byName.get(channelKey(parent?.id ?? null, channelSpec.name));
    const categoryName = category?.name ?? null;

    if (existing) {
      seenChannels.add(existing.id);
      const changes = channelChanges(channelSpec, current.details.get(existing.id));
      if (changes.length > 0) {
        operations.push({
          kind: 'channel.update',
          name: channelSpec.name,
          category: categoryName,
          spec: channelSpec,
          changes,
        });
      }
      if (existing.type !== channelSpec.type) {
        warnings.push(
          `"${channelSpec.name}" já existe com outro tipo; o Discord não converte tipo de canal.`,
        );
      }
    } else {
      operations.push({
        kind: 'channel.create',
        name: channelSpec.name,
        category: categoryName,
        spec: channelSpec,
      });
    }

    const detail = existing ? current.details.get(existing.id) : undefined;
    if (!overridesMatch(channelSpec.overrides, detail, roleIdByName)) {
      operations.push({
        kind: 'overrides.set',
        target: channelSpec.name,
        targetKind: 'channel',
        category: categoryName,
        overrides: channelSpec.overrides,
      });
    }
  };

  for (const channelSpec of spec.channels) planChannel(channelSpec, null);

  for (const categorySpec of spec.categories) {
    const existing = categoryByName.get(norm(categorySpec.name));
    if (existing) seenCategories.add(existing.id);
    else operations.push({ kind: 'category.create', name: categorySpec.name });

    const detail = existing ? current.details.get(existing.id) : undefined;
    if (!overridesMatch(categorySpec.overrides, detail, roleIdByName)) {
      operations.push({
        kind: 'overrides.set',
        target: categorySpec.name,
        targetKind: 'category',
        category: null,
        overrides: categorySpec.overrides,
      });
    }

    for (const channelSpec of categorySpec.channels) planChannel(channelSpec, categorySpec);
  }

  // ----- remoções -----
  if (options.allowDelete) {
    for (const channel of current.channels) {
      if (channel.type === MANAGED_CHANNEL_TYPES.category) {
        if (!seenCategories.has(channel.id)) {
          operations.push({ kind: 'category.delete', name: channel.name });
        }
        continue;
      }
      if (seenChannels.has(channel.id)) continue;
      const parent = channel.parentId
        ? current.channels.find((c) => c.id === channel.parentId)
        : undefined;
      operations.push({
        kind: 'channel.delete',
        name: channel.name,
        category: parent?.name ?? null,
      });
    }
    for (const role of editableRoles) {
      if (!specRoleNames.has(norm(role.name))) {
        operations.push({ kind: 'role.delete', name: role.name });
      }
    }
  }

  return { operations, warnings };
}

/**
 * O spec lista os cargos de cima para baixo. A API move uma casa por chamada,
 * então a reordenação é uma bolha: cada troca de vizinhos vira um `role.move`.
 */
function reorderOperations(
  specRoles: RoleSpec[],
  current: GuildRoleSummary[],
  specRoleNames: Set<string>,
): Operation[] {
  const wanted = specRoles.map((role) => norm(role.name)).filter((name) => specRoleNames.has(name));
  // No Discord, posição maior fica mais acima; o spec lê de cima para baixo.
  const list = [...current]
    .sort((a, b) => b.position - a.position)
    .map((role) => norm(role.name))
    .filter((name) => specRoleNames.has(name));

  const operations: Operation[] = [];
  for (let target = 0; target < wanted.length; target += 1) {
    const name = wanted[target];
    if (name === undefined) continue;
    const at = list.indexOf(name);
    if (at === -1 || at <= target) continue;
    for (let i = at; i > target; i -= 1) {
      const above = list[i - 1];
      if (above === undefined) continue;
      list[i] = above;
      list[i - 1] = name;
      operations.push({ kind: 'role.move', name, direction: 'up' });
    }
  }
  return operations;
}
