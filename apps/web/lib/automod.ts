import 'server-only';

import {
  countAutomodHitsByRule,
  createAutomodRule,
  deleteAutomodRule,
  getAutomodRule,
  getAutomodRules,
  reorderAutomodRules,
  updateAutomodRule,
} from '@cobot/db';
import { AutomodRuleSchema, DAY_MS, type AutomodRule, type RaidModeState } from '@cobot/shared';
import { revalidatePath } from 'next/cache';

import { withAudit } from './audit';
import { defaultGuildId, requireGuildAccess } from './auth/require';
import { db } from './db';
import { internalApi } from './internal-api';
import { toFieldErrors, type ActionResult } from './module-config';

const PATH = (guildId: string) => `/g/${guildId}/config/automod`;

/** Uma linha da tabela de regras. `null` em `rule` = jsonb que não valida mais. */
export type AutomodRuleRow = {
  id: string;
  name: string;
  type: AutomodRule['type'];
  enabled: boolean;
  priority: number;
  actions: string[];
  hits24h: number;
  /** A regra completa, para abrir o `sheet` de edição. */
  rule: AutomodRule | null;
};

/**
 * Regras da guild na ordem de avaliação, já com os disparos das últimas 24h.
 * Uma regra com jsonb inválido continua na lista (dá para apagar ou corrigir)
 * — sumir da tela seria pior do que aparecer marcada como quebrada.
 */
export async function loadAutomodRules(guildId: string): Promise<AutomodRuleRow[]> {
  const [rows, hits] = await Promise.all([
    getAutomodRules(db(), guildId),
    countAutomodHitsByRule(db(), guildId, new Date(Date.now() - DAY_MS)),
  ]);

  return rows.map((row) => {
    const parsed = AutomodRuleSchema.safeParse({
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      priority: row.priority,
      config: row.config,
      actions: row.actions,
      exemptRoleIds: row.exemptRoleIds,
      exemptChannelIds: row.exemptChannelIds,
    });
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      priority: row.priority,
      actions: row.actions.map((action) => action.type),
      hits24h: hits.get(row.id) ?? 0,
      rule: parsed.success ? parsed.data : null,
    };
  });
}

function parseBody(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Depois de mexer nas regras o cache do motor precisa cair (PRD §5.7). */
async function invalidate(guildId: string): Promise<string | undefined> {
  try {
    await internalApi().invalidateConfig(guildId, { module: 'automod' });
    return undefined;
  } catch {
    return 'Salvo, mas o bot não respondeu: ele recarrega sozinho em alguns minutos.';
  }
}

/** Cria ou edita uma regra. `ruleId` no FormData = edição. */
export async function saveAutomodRule(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const parsed = AutomodRuleSchema.safeParse(parseBody(formData.get('rule')));
  if (!parsed.success) {
    return {
      ok: false,
      message: 'Confira os campos marcados.',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }
  const rule = parsed.data;
  const ruleId = formData.get('ruleId');
  const isEdit = typeof ruleId === 'string' && ruleId.length > 0;

  const before = isEdit ? await getAutomodRule(db(), guildId, ruleId) : null;
  if (isEdit && !before) return { ok: false, message: 'Essa regra não existe mais.' };

  const values = {
    name: rule.name,
    type: rule.type,
    enabled: rule.enabled,
    priority: rule.priority,
    config: rule.config as Record<string, unknown>,
    actions: [...rule.actions],
    exemptRoleIds: rule.exemptRoleIds,
    exemptChannelIds: rule.exemptChannelIds,
  };

  const saved = isEdit
    ? await updateAutomodRule(db(), guildId, ruleId, values)
    : await createAutomodRule(db(), { guildId, ...values });
  if (!saved) return { ok: false, message: 'Essa regra não existe mais.' };

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    isEdit ? 'automod.rule.update' : 'automod.rule.create',
    { type: 'automod_rule', id: saved.id },
    before,
    saved,
  );

  const warning = await invalidate(guildId);
  revalidatePath(PATH(guildId));
  return warning ? { ok: true, message: warning } : { ok: true };
}

export async function removeAutomodRule(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const ruleId = formData.get('ruleId');
  if (typeof ruleId !== 'string' || ruleId.length === 0) {
    return { ok: false, message: 'Regra inválida.' };
  }

  const before = await getAutomodRule(db(), guildId, ruleId);
  if (!before || !(await deleteAutomodRule(db(), guildId, ruleId))) {
    return { ok: false, message: 'Essa regra não existe mais.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'automod.rule.delete',
    { type: 'automod_rule', id: ruleId },
    before,
    null,
  );

  const warning = await invalidate(guildId);
  revalidatePath(PATH(guildId));
  return warning ? { ok: true, message: warning } : { ok: true };
}

/** Botões ▲▼: o cliente manda a lista inteira na ordem nova. */
export async function reorderAutomod(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');

  const body = parseBody(formData.get('ruleIds'));
  if (!Array.isArray(body) || body.some((id) => typeof id !== 'string')) {
    return { ok: false, message: 'Ordem inválida.' };
  }
  const ruleIds = body as string[];

  const before = (await getAutomodRules(db(), guildId)).map((row) => row.id);
  // Reordenar uma lista que mudou embaixo do usuário zeraria a prioridade de
  // quem não veio no payload.
  if (before.length !== ruleIds.length || !ruleIds.every((id) => before.includes(id))) {
    return { ok: false, message: 'A lista mudou. Recarregue a página.' };
  }

  await reorderAutomodRules(db(), guildId, ruleIds);
  await withAudit(
    { id: session.user.id, tag: session.user.name },
    'automod.rule.reorder',
    { type: 'module', id: 'automod' },
    before,
    ruleIds,
  );

  const warning = await invalidate(guildId);
  revalidatePath(PATH(guildId));
  return warning ? { ok: true, message: warning } : { ok: true };
}

/** Estado do modo raid; `null` quando o bot não respondeu (§8, bot offline). */
export async function loadRaidState(guildId: string): Promise<RaidModeState | null> {
  try {
    return await internalApi().raidMode(guildId);
  } catch {
    return null;
  }
}

export async function setRaidMode(formData: FormData): Promise<ActionResult> {
  const guildId = defaultGuildId();
  const session = await requireGuildAccess(guildId, 'admin');
  const active = formData.get('active') === 'true';

  try {
    await internalApi().setRaidMode(guildId, { active });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'O bot não respondeu.' };
  }

  await withAudit(
    { id: session.user.id, tag: session.user.name },
    active ? 'automod.raid.enable' : 'automod.raid.disable',
    { type: 'module', id: 'automod' },
    null,
    { active },
  );
  revalidatePath(PATH(guildId));
  return { ok: true, message: active ? 'Modo raid ativado.' : 'Modo raid desativado.' };
}
