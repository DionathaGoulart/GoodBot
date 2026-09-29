import 'server-only';

import {
  getAllModuleConfigs,
  getGuildSettings,
  getLogConfigs,
  getModuleConfig,
  setGuildSettings,
  setLogConfig,
  setModuleConfig,
  type ModuleConfigResult,
} from '@goodbot/db';
import {
  DEFAULT_GUILD_SETTINGS,
  LOG_KINDS,
  type GeneralPageValues,
  type LogKindsConfig,
  type LogsPageValues,
  type Module,
  type ModuleConfigInput,
} from '@goodbot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { requireGuildAccess } from './auth/require';
import { CONFIG_PAGES, type ConfigPage, type ConfigPageValues } from './config-pages';
import { db } from './db';
import { internalApi } from './internal-api';

import type { z } from 'zod';

/**
 * Resposta de toda server action de configuração. Erro de campo volta como
 * `caminho → mensagem` para o react-hook-form marcar o input (§6.4); erro
 * geral vira toast (§6.8).
 */
export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function loadModuleConfig<M extends Module>(
  guildId: string,
  module: M,
): Promise<ModuleConfigResult<M>> {
  return getModuleConfig(db(), guildId, module);
}

/**
 * `module → ligado?` de todos os módulos numa query. A tela índice de
 * `/config` mostra onze telas de uma vez; onze `getModuleConfig` seriam onze
 * idas ao banco para ler o mesmo `enabled`.
 */
export async function loadModulesEnabled(guildId: string): Promise<Record<Module, boolean>> {
  const all = await getAllModuleConfigs(db(), guildId);
  return Object.fromEntries(
    Object.entries(all).map(([module, result]) => [module, result.config.enabled]),
  ) as Record<Module, boolean>;
}

/** `guild_settings` + módulo `general` no formato do formulário. */
export async function loadGeneralPage(guildId: string): Promise<GeneralPageValues> {
  const [row, module] = await Promise.all([
    getGuildSettings(db(), guildId),
    loadModuleConfig(guildId, 'general'),
  ]);

  return {
    settings: row
      ? {
          timezone: row.timezone,
          embedColor: row.embedColor,
          modRoleIds: row.modRoleIds,
          adminRoleIds: row.adminRoleIds,
          dashboardAccessRoleIds: row.dashboardAccessRoleIds,
          logChannelId: row.logChannelId,
          noticeChannelId: row.noticeChannelId,
          dmOnPunish: row.dmOnPunish,
        }
      : DEFAULT_GUILD_SETTINGS,
    module: module.config,
  };
}

/** Módulo `logs` + a grade de `log_configs`, um item por `LOG_KINDS`. */
export async function loadLogsPage(guildId: string): Promise<LogsPageValues> {
  const [byKind, module] = await Promise.all([
    getLogConfigs(db(), guildId),
    loadModuleConfig(guildId, 'logs'),
  ]);

  const kinds = Object.fromEntries(
    LOG_KINDS.map((kind) => [
      kind,
      {
        enabled: byKind[kind].enabled,
        channelId: byKind[kind].channelId,
        ignoredChannelIds: byKind[kind].ignoredChannelIds,
        ignoredRoleIds: byKind[kind].ignoredRoleIds,
      },
    ]),
  ) as LogKindsConfig;

  return { module: module.config, kinds };
}

/** O estado atual da página, no mesmo formato que o formulário envia. */
async function loadPage<P extends ConfigPage>(
  guildId: string,
  page: P,
): Promise<ConfigPageValues<P>> {
  if (page === 'general') return (await loadGeneralPage(guildId)) as ConfigPageValues<P>;
  if (page === 'logs') return (await loadLogsPage(guildId)) as ConfigPageValues<P>;
  const result = await loadModuleConfig(guildId, CONFIG_PAGES[page].module);
  return result.config as ConfigPageValues<P>;
}

async function writePage(
  guildId: string,
  page: ConfigPage,
  values: ConfigPageValues,
  actorId: string,
): Promise<void> {
  if (page === 'general') {
    const { settings, module } = values as GeneralPageValues;
    await setGuildSettings(db(), guildId, settings);
    await setModuleConfig(db(), guildId, 'general', module, actorId);
    return;
  }

  if (page === 'logs') {
    const { module, kinds } = values as LogsPageValues;
    await setModuleConfig(db(), guildId, 'logs', module, actorId);
    for (const kind of LOG_KINDS) {
      await setLogConfig(db(), guildId, kind, kinds[kind]);
    }
    return;
  }

  // `module` como nome de variável é proibido pelo lint do Next (colide com o
  // `module` do CommonJS), daí `target`.
  const target: Module = CONFIG_PAGES[page].module;
  await setModuleConfig(db(), guildId, target, values as ModuleConfigInput, actorId);
}

/** `caminho.0.campo` — o mesmo formato de nome que o react-hook-form usa. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    // Só a primeira mensagem por campo: o painel mostra uma linha por input.
    errors[issue.path.join('.')] ??= issue.message;
  }
  return errors;
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Derruba o cache do `ConfigService` (PRD §5.7). A página `general` mexe em
 * `guild_settings`, que só sai do cache na invalidação sem módulo.
 */
async function invalidateBotCache(guildId: string, page: ConfigPage): Promise<string | undefined> {
  try {
    await internalApi().invalidateConfig(
      guildId,
      page === 'general' ? {} : { module: CONFIG_PAGES[page].module },
    );
    return undefined;
  } catch {
    return 'Salvo, mas o bot não respondeu: ele recarrega sozinho em alguns minutos.';
  }
}

/**
 * Salva uma página de configuração (PRD §6.2): valida com o schema de
 * `@goodbot/shared`, grava, registra a auditoria com o diff, invalida o cache do
 * bot e revalida a rota. Nada é gravado se a validação falhar.
 *
 * O bot fora do ar **não** desfaz o salvamento: o config já está no banco e o
 * cache dele expira sozinho em minutos — só avisamos no toast.
 */
export async function saveModuleConfig(
  guildId: string,
  page: ConfigPage,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = CONFIG_PAGES[page].schema.safeParse(parseBody(formData.get('config')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const before = await loadPage(guildId, page);
  const after = parsed.data as ConfigPageValues;
  await writePage(guildId, page, after, session.user.id);
  await withAudit(
    { id: session.user.id, tag: session.user.name, guildId: session.guildId },
    `config.${page}.update`,
    { type: 'module', id: CONFIG_PAGES[page].module },
    before,
    after,
  );

  const warning = await invalidateBotCache(guildId, page);
  revalidatePath(`/g/${guildId}/config/${page}`);
  return warning ? { ok: true, message: warning } : { ok: true };
}
