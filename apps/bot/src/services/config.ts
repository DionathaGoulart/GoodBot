import { getAllModuleConfigs, getModuleConfig, guildSettings } from '@goodbot/db';
import { MINUTE_MS, MODULES } from '@goodbot/shared';
import { eq } from 'drizzle-orm';

import { childLogger } from '../logger';

import type { Db } from '@goodbot/db';
import type { DmOnPunish, Module, ModuleConfig } from '@goodbot/shared';

/** `guild_settings` com defaults aplicados quando a guild ainda não tem linha. */
export interface ResolvedSettings {
  guildId: string;
  timezone: string;
  embedColor: number;
  modRoleIds: string[];
  adminRoleIds: string[];
  dashboardAccessRoleIds: string[];
  logChannelId: string | null;
  dmOnPunish: DmOnPunish | null;
  /** `false` quando não há linha no banco (tudo default). */
  stored: boolean;
}

export const DEFAULT_SETTINGS: Omit<ResolvedSettings, 'guildId' | 'stored'> = {
  timezone: 'America/Sao_Paulo',
  embedColor: 0xdc143c,
  modRoleIds: [],
  adminRoleIds: [],
  dashboardAccessRoleIds: [],
  logChannelId: null,
  dmOnPunish: null,
};

/**
 * Canal de invalidação de cache. Hoje é in-memory (bot e painel falam por
 * HTTP, etapa 11); trocar por `LISTEN/NOTIFY` depois não toca nos módulos.
 * PRD §5.7.
 */
export interface ConfigBus {
  publish(guildId: string, module?: Module): void;
  subscribe(listener: (guildId: string, module?: Module) => void): () => void;
}

export function createInMemoryConfigBus(): ConfigBus {
  const listeners = new Set<(guildId: string, module?: Module) => void>();
  return {
    publish(guildId, module) {
      for (const listener of listeners) listener(guildId, module);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ConfigServiceOptions {
  /** TTL do cache em ms (default 5 min). */
  ttl?: number;
  bus?: ConfigBus;
  now?: () => number;
}

/**
 * Leitura de config com cache por guild+módulo. Nenhum comando ou evento
 * consulta `module_configs` direto — CLAUDE.md.
 */
export class ConfigService {
  private readonly modules = new Map<string, CacheEntry<ModuleConfig>>();
  private readonly settings = new Map<string, CacheEntry<ResolvedSettings>>();
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly log = childLogger('config');
  readonly bus: ConfigBus;

  constructor(
    private readonly db: Db,
    options: ConfigServiceOptions = {},
  ) {
    this.ttl = options.ttl ?? 5 * MINUTE_MS;
    this.now = options.now ?? Date.now;
    this.bus = options.bus ?? createInMemoryConfigBus();
    this.bus.subscribe((guildId, module) => this.invalidate(guildId, module));
  }

  private key(guildId: string, module: Module): string {
    return `${guildId}:${module}`;
  }

  /** Config de um módulo, do cache ou do banco. Nunca lança por jsonb ruim. */
  async get<M extends Module>(guildId: string, module: M): Promise<ModuleConfig<M>> {
    const key = this.key(guildId, module);
    const cached = this.modules.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value as ModuleConfig<M>;

    const result = await getModuleConfig(this.db, guildId, module);
    if (!result.stored && result.updatedAt) {
      this.log.warn({ guildId, module }, 'config inválido no banco; usando o default');
    }
    this.modules.set(key, { value: result.config, expiresAt: this.now() + this.ttl });
    return result.config;
  }

  /** `true` se o módulo está ligado para a guild. */
  async isEnabled(guildId: string, module: Module): Promise<boolean> {
    return (await this.get(guildId, module)).enabled;
  }

  /** `guild_settings` (cargos, cor, timezone) com defaults. */
  async getSettings(guildId: string): Promise<ResolvedSettings> {
    const cached = this.settings.get(guildId);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const [row] = await this.db
      .select()
      .from(guildSettings)
      .where(eq(guildSettings.guildId, guildId))
      .limit(1);

    const value: ResolvedSettings = row
      ? {
          guildId,
          timezone: row.timezone,
          embedColor: row.embedColor,
          modRoleIds: row.modRoleIds,
          adminRoleIds: row.adminRoleIds,
          dashboardAccessRoleIds: row.dashboardAccessRoleIds,
          logChannelId: row.logChannelId,
          dmOnPunish: row.dmOnPunish,
          stored: true,
        }
      : { guildId, ...DEFAULT_SETTINGS, stored: false };

    this.settings.set(guildId, { value, expiresAt: this.now() + this.ttl });
    return value;
  }

  /** Carrega todos os módulos de uma guild numa query só (boot). */
  async warm(guildId: string): Promise<void> {
    const all = await getAllModuleConfigs(this.db, guildId);
    const expiresAt = this.now() + this.ttl;
    for (const module of MODULES) {
      this.modules.set(this.key(guildId, module), { value: all[module].config, expiresAt });
    }
    await this.getSettings(guildId);
  }

  /** Sem `module`: derruba tudo da guild (inclusive as settings). */
  invalidate(guildId: string, module?: Module): void {
    if (module) {
      this.modules.delete(this.key(guildId, module));
    } else {
      for (const m of MODULES) this.modules.delete(this.key(guildId, m));
      this.settings.delete(guildId);
    }
    this.log.debug({ guildId, module: module ?? 'todos' }, 'cache de config invalidado');
  }

  /** Usado pela API interna e por `/config reload`. */
  publishInvalidate(guildId: string, module?: Module): void {
    this.bus.publish(guildId, module);
  }

  clear(): void {
    this.modules.clear();
    this.settings.clear();
  }
}
