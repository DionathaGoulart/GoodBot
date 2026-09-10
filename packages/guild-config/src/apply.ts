import { InternalApiError, MANAGED_CHANNEL_TYPES } from '@goodbot/shared';

import { EVERYONE } from './schema';

import type { Operation, Plan, CurrentState } from './plan';
import type { OverrideSpec } from './schema';
import type { ChannelOverride, InternalClient } from '@goodbot/shared';

const norm = (value: string): string => value.trim().toLowerCase();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Quem apresenta o `INTERNAL_API_TOKEN` cai no teto alto da API (600/min por
 * IP e por rota). 120 ms entre chamadas deixa folga para o painel estar em uso
 * ao mesmo tempo sem que o apply coma a janela inteira.
 */
export const DEFAULT_MIN_INTERVAL_MS = 120;

export class Throttle {
  private last = 0;

  constructor(private readonly minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS) {}

  async wait(): Promise<void> {
    const since = Date.now() - this.last;
    if (since < this.minIntervalMs) await sleep(this.minIntervalMs - since);
    this.last = Date.now();
  }
}

export interface ApplyOptions {
  api: InternalClient;
  guildId: string;
  actorId: string;
  reason?: string;
  throttle?: Throttle;
  onStep?: (step: {
    index: number;
    total: number;
    label: string;
    ok: boolean;
    error?: string;
  }) => void;
}

export interface ApplyResult {
  applied: number;
  failures: { operation: Operation; message: string }[];
}

export class ApplyError extends Error {}

/** Rótulo curto de uma operação, usado no plano impresso e no log do apply. */
export function describe(operation: Operation): string {
  switch (operation.kind) {
    case 'role.create':
      return `criar cargo "${operation.name}"`;
    case 'role.update':
      return `editar cargo "${operation.name}" (${operation.changes.join(', ')})`;
    case 'role.delete':
      return `APAGAR cargo "${operation.name}"`;
    case 'role.move':
      return `mover cargo "${operation.name}" uma casa para cima`;
    case 'category.create':
      return `criar categoria "${operation.name}"`;
    case 'category.delete':
      return `APAGAR categoria "${operation.name}"`;
    case 'channel.create':
      return `criar canal "${operation.name}"${operation.category ? ` em "${operation.category}"` : ''}`;
    case 'channel.update':
      return `editar canal "${operation.name}" (${operation.changes.join(', ')})`;
    case 'channel.delete':
      return `APAGAR canal "${operation.name}"${operation.category ? ` de "${operation.category}"` : ''}`;
    case 'overrides.set':
      return `permissões de ${operation.targetKind === 'category' ? 'categoria' : 'canal'} "${operation.target}"`;
  }
}

/**
 * Índice nome para ID que nasce do estado atual e cresce conforme o apply cria
 * coisas. É o que permite um `guild.yaml` sem nenhum ID dentro.
 */
class Registry {
  readonly roles = new Map<string, string>();
  readonly categories = new Map<string, string>();
  readonly channels = new Map<string, string>();

  constructor(current: CurrentState, guildId: string) {
    for (const role of current.roles) {
      if (!this.roles.has(norm(role.name))) this.roles.set(norm(role.name), role.id);
    }
    this.roles.set(norm(EVERYONE), guildId);

    for (const channel of current.channels) {
      if (channel.type === MANAGED_CHANNEL_TYPES.category) {
        if (!this.categories.has(norm(channel.name))) {
          this.categories.set(norm(channel.name), channel.id);
        }
        continue;
      }
      const key = this.channelKey(channel.parentId, channel.name);
      if (!this.channels.has(key)) this.channels.set(key, channel.id);
    }
  }

  channelKey(parentId: string | null, name: string): string {
    return `${parentId ?? ''} ${norm(name)}`;
  }

  keyByCategoryName(categoryName: string | null, name: string): string {
    const parentId = categoryName === null ? null : (this.categories.get(norm(categoryName)) ?? '');
    return this.channelKey(parentId, name);
  }

  requireRole(name: string): string {
    const id = this.roles.get(norm(name));
    if (id === undefined) {
      throw new ApplyError(`O spec cita o cargo "${name}", que não existe na guild.`);
    }
    return id;
  }

  requireCategory(name: string): string {
    const id = this.categories.get(norm(name));
    if (id === undefined) {
      throw new ApplyError(`A categoria "${name}" não existe (a criação dela falhou antes?).`);
    }
    return id;
  }

  requireChannel(categoryName: string | null, name: string): string {
    const id = this.channels.get(this.keyByCategoryName(categoryName, name));
    if (id === undefined) {
      throw new ApplyError(`O canal "${name}" não existe (a criação dele falhou antes?).`);
    }
    return id;
  }
}

function toOverrides(spec: OverrideSpec[], registry: Registry): ChannelOverride[] {
  return spec
    .filter((o) => o.view !== 'inherit' || o.send !== 'inherit')
    .map((o) => ({ roleId: registry.requireRole(o.role), view: o.view, send: o.send }));
}

export async function applyPlan(
  plan: Plan,
  current: CurrentState,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const { api, guildId, actorId } = options;
  const reason = options.reason ?? 'guild.yaml aplicado pelo Goodbot';
  const throttle = options.throttle ?? new Throttle();
  const registry = new Registry(current, guildId);
  const failures: ApplyResult['failures'] = [];
  let applied = 0;

  /** Uma chamada à API, com a pausa do throttle e uma repescagem em 503. */
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    await throttle.wait();
    try {
      return await fn();
    } catch (error) {
      if (error instanceof InternalApiError && error.retryAfter !== null) {
        await sleep((error.retryAfter + 1) * 1000);
        return await fn();
      }
      throw error;
    }
  };

  const run = async (operation: Operation): Promise<void> => {
    switch (operation.kind) {
      case 'role.create': {
        const role = await call(() =>
          api.createRole(guildId, { ...operation.spec, actorId, reason }),
        );
        registry.roles.set(norm(role.name), role.id);
        return;
      }
      case 'role.update': {
        const id = registry.requireRole(operation.name);
        await call(() => api.updateRole(guildId, id, { ...operation.spec, actorId, reason }));
        return;
      }
      case 'role.move': {
        const id = registry.requireRole(operation.name);
        await call(() =>
          api.moveRole(guildId, id, { direction: operation.direction, actorId, reason }),
        );
        return;
      }
      case 'role.delete': {
        const id = registry.requireRole(operation.name);
        await call(() => api.deleteRole(guildId, id, { actorId, reason }));
        registry.roles.delete(norm(operation.name));
        return;
      }
      case 'category.create': {
        const category = await call(() =>
          api.createChannel(guildId, {
            name: operation.name,
            type: MANAGED_CHANNEL_TYPES.category,
            parentId: null,
            topic: null,
            nsfw: false,
            slowmodeSeconds: 0,
            actorId,
            reason,
          }),
        );
        registry.categories.set(norm(category.name), category.id);
        return;
      }
      case 'channel.create': {
        const parentId = operation.category ? registry.requireCategory(operation.category) : null;
        const channel = await call(() =>
          api.createChannel(guildId, {
            name: operation.spec.name,
            type: operation.spec.type,
            parentId,
            topic: operation.spec.topic,
            nsfw: operation.spec.nsfw,
            slowmodeSeconds: operation.spec.slowmode,
            actorId,
            reason,
          }),
        );
        registry.channels.set(registry.channelKey(parentId, channel.name), channel.id);
        return;
      }
      case 'channel.update': {
        const id = registry.requireChannel(operation.category, operation.name);
        const parentId = operation.category ? registry.requireCategory(operation.category) : null;
        await call(() =>
          api.updateChannel(guildId, id, {
            name: operation.spec.name,
            parentId,
            topic: operation.spec.topic,
            nsfw: operation.spec.nsfw,
            slowmodeSeconds: operation.spec.slowmode,
            actorId,
            reason,
          }),
        );
        return;
      }
      case 'channel.delete': {
        const id = registry.requireChannel(operation.category, operation.name);
        await call(() => api.deleteChannel(guildId, id, { actorId, reason }));
        registry.channels.delete(registry.keyByCategoryName(operation.category, operation.name));
        return;
      }
      case 'category.delete': {
        const id = registry.requireCategory(operation.name);
        await call(() => api.deleteChannel(guildId, id, { actorId, reason }));
        registry.categories.delete(norm(operation.name));
        return;
      }
      case 'overrides.set': {
        const id =
          operation.targetKind === 'category'
            ? registry.requireCategory(operation.target)
            : registry.requireChannel(operation.category, operation.target);
        await call(() =>
          api.setChannelOverrides(guildId, id, {
            overrides: toOverrides(operation.overrides, registry),
            actorId,
            reason,
          }),
        );
        return;
      }
    }
  };

  const total = plan.operations.length;
  for (const [index, operation] of plan.operations.entries()) {
    const label = describe(operation);
    try {
      await run(operation);
      applied += 1;
      options.onStep?.({ index: index + 1, total, label, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ operation, message });
      options.onStep?.({ index: index + 1, total, label, ok: false, error: message });
    }
  }

  return { applied, failures };
}
