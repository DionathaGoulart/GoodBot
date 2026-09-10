import 'server-only';

import {
  BROADCAST_CONFIRMATION,
  DAY_MS,
  MAX_EMBED_DESCRIPTION_LENGTH,
  MAX_EMBED_TITLE_LENGTH,
  MAX_REASON_LENGTH,
} from '@goodbot/shared';
import {
  isGuildServed,
  listGuildRegistry,
  setGuildStatus,
  usageByGuild,
  type GuildRegistryEntry,
} from '@goodbot/db';
import { revalidatePath } from 'next/cache';
import { cache } from 'react';

import { failure } from './action-error';
import { requireBotOwner } from './auth/owner';
import { db } from './db';
import { internalApi } from './internal-api';

import type { ActionResult } from './module-config';
import type {
  AdminDiagnostics,
  AdminGuildLive,
  BroadcastResult,
  GuildStatus,
  HealthResponse,
  MaintenanceState,
  ResyncCommandsResult,
} from '@goodbot/shared';

/**
 * Os dados do painel do dono do bot (plano, Etapa 4).
 *
 * A regra que organiza este arquivo: **o registro vem do Postgres, o estado ao
 * vivo vem do bot.** Não é gosto — é o que mantém a fila de aprovação
 * funcionando com o bot fora do ar. Aprovar um servidor é um `update` numa
 * tabela que o `RegistryService` relê a cada minuto; se dependesse de uma
 * chamada à API, o dia em que o bot estivesse quebrado seria justamente o dia
 * em que não daria para consertar nada pelo painel.
 *
 * O que **exige** o bot é o que só ele pode fazer: sair de um servidor, mandar
 * um aviso, re-registrar comandos, ligar a manutenção.
 *
 * Nada aqui escreve em `audit_logs`, e isso é decisão, não esquecimento:
 * aquela tabela tem `guild_id NOT NULL` com FK para `guilds`, e metade destas
 * ações não tem guild (broadcast, manutenção) ou acontece numa guild que ainda
 * não tem linha lá (a fila é feita de servidores `pending`, que o bot nunca
 * preparou). A trilha de aprovar e bloquear fica onde ela é o próprio dado —
 * `status`, `approved_at` e `note` no registro —, e o que o bot executa ele
 * loga em `warn` com quem pediu.
 */

/** Janela do "uso" da tabela de servidores. */
export const USAGE_WINDOW_MS = 7 * DAY_MS;

export interface AdminGuildUsage {
  commands: number;
  messages: number;
}

export interface AdminGuildRow {
  guildId: string;
  status: GuildStatus;
  /** O bot atende agora? Conta o prazo da demo na hora, como o bot conta. */
  served: boolean;
  invitedBy: string | null;
  invitedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  /**
   * A demo já foi usada até o fim. Um `demo` com esta marca não é uma demo em
   * curso: é alguém que testou, gostou (ou não) e agora depende de aprovação
   * como qualquer um — por isso ele entra na fila.
   */
  demoSpent: boolean;
  leftAt: string | null;
  note: string | null;
  /** O que o bot sabe agora; `null` quando ele não está (ou não respondeu). */
  live: AdminGuildLive | null;
  usage: AdminGuildUsage;
}

export interface AdminGuildsView {
  rows: AdminGuildRow[];
  /** `null` quando o bot respondeu; a mensagem quando não. */
  botError: string | null;
  /** Guilds no cache do bot que não têm linha no registro — não deveria haver. */
  orphans: AdminGuildLive[];
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * A tabela de servidores: registro (banco) ∪ estado ao vivo (bot) ∪ uso (stats).
 *
 * O bot é consultado com tolerância a falha de propósito — sem ele a tela
 * perde nome, ícone e contagem de membros, mas continua mostrando a fila e
 * continua deixando aprovar. Perder o enfeite é aceitável; perder o botão que
 * conserta as coisas, não.
 */
export const loadAdminGuilds = cache(async (): Promise<AdminGuildsView> => {
  const [entries, usage] = await Promise.all([
    listGuildRegistry(db()),
    usageByGuild(db(), new Date(Date.now() - USAGE_WINDOW_MS)),
  ]);

  let live = new Map<string, AdminGuildLive>();
  let botError: string | null = null;
  try {
    const response = await internalApi().admin.guilds();
    live = new Map(response.guilds.map((guild) => [guild.id, guild]));
  } catch (error) {
    botError = failure(error).message ?? 'O bot não respondeu.';
  }

  const usageById = new Map(usage.map((row) => [row.guildId, row]));
  const now = new Date();

  const rows = entries
    .map((entry: GuildRegistryEntry): AdminGuildRow => {
      const stats = usageById.get(entry.guildId);
      return {
        guildId: entry.guildId,
        status: entry.status,
        served: isGuildServed(entry, now),
        invitedBy: entry.invitedBy,
        invitedAt: entry.invitedAt.toISOString(),
        approvedAt: iso(entry.approvedAt),
        expiresAt: iso(entry.expiresAt),
        demoSpent: entry.status === 'demo' && entry.demoEndedAt !== null,
        leftAt: iso(entry.leftAt),
        note: entry.note,
        live: live.get(entry.guildId) ?? null,
        usage: { commands: stats?.commands ?? 0, messages: stats?.messages ?? 0 },
      };
    })
    .sort((a, b) => {
      const nomeA = a.live?.name ?? a.guildId;
      const nomeB = b.live?.name ?? b.guildId;
      return nomeA.localeCompare(nomeB, 'pt-BR');
    });

  const conhecidos = new Set(entries.map((entry) => entry.guildId));
  const orphans = [...live.values()].filter((guild) => !conhecidos.has(guild.id));

  return { rows, botError, orphans };
});

/**
 * A fila de decisão: quem espera aprovação e quem já gastou a demonstração.
 *
 * As duas coisas são a mesma pergunta com histórias diferentes — "este
 * servidor deve continuar a ser atendido?" —, então elas moram na mesma tela.
 */
export function queueOf(rows: readonly AdminGuildRow[]): AdminGuildRow[] {
  return rows.filter((row) => row.status === 'pending' || row.demoSpent);
}

export interface AdminSystemView {
  health: HealthResponse | null;
  diagnostics: AdminDiagnostics | null;
  maintenance: MaintenanceState | null;
  roundTripMs: number | null;
  error: string | null;
}

/**
 * Saúde e uso. Uma chamada por assunto, todas tolerantes: um card vazio é
 * informação ("o bot não respondeu"), uma tela de erro inteira não é.
 */
export async function loadAdminSystem(): Promise<AdminSystemView> {
  const api = internalApi();
  const start = performance.now();
  const [health, diagnostics, maintenance] = await Promise.all([
    api.health().catch((error: unknown) => ({ error })),
    api.admin.diagnostics().catch(() => null),
    api.admin.maintenance().catch(() => null),
  ]);

  if (health !== null && typeof health === 'object' && 'error' in health) {
    return {
      health: null,
      diagnostics: null,
      maintenance: null,
      roundTripMs: null,
      error: failure(health.error).message ?? 'O bot não respondeu.',
    };
  }

  return {
    health,
    diagnostics,
    maintenance,
    roundTripMs: Math.round(performance.now() - start),
    error: null,
  };
}

// ── escritas ────────────────────────────────────────────────────────────────

const ADMIN_PATHS = ['/admin', '/admin/servidores', '/admin/fila', '/admin/manutencao'];

function revalidateAdmin(): void {
  for (const path of ADMIN_PATHS) revalidatePath(path);
}

function readGuildId(formData: FormData): string | null {
  const value = formData.get('guildId');
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNote(formData: FormData): string | null {
  const value = formData.get('note');
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, MAX_REASON_LENGTH);
}

/**
 * Aprovar um servidor.
 *
 * É uma escrita no banco e nada mais: o `RegistryService` do bot relê o
 * registro a cada minuto, então o efeito chega sozinho — e chega mesmo que o
 * bot esteja fora agora, porque ele relê no boot também. Nada aqui depende de
 * a API responder.
 */
export async function approveGuild(formData: FormData): Promise<ActionResult> {
  await requireBotOwner();
  const guildId = readGuildId(formData);
  if (!guildId) return { ok: false, message: 'Servidor inválido.' };

  const entry = await setGuildStatus(db(), guildId, {
    status: 'approved',
    // O prazo da demo some junto: aprovado não tem prazo, e uma data velha aqui
    // faria o `isGuildServed` continuar contando um relógio que não existe mais.
    expiresAt: null,
    note: readNote(formData),
  });
  if (!entry) return { ok: false, message: 'Servidor não está no registro.' };

  revalidateAdmin();
  return { ok: true, message: 'Aprovado. O bot passa a atender em até um minuto.' };
}

/**
 * Bloquear (ou recusar) um servidor.
 *
 * Duas metades, nesta ordem: primeiro o banco — que é o que **decide** —, e só
 * então o pedido de saída ao bot. Se a saída falhar, o bloqueio continua
 * valendo: o bot já não responde a nada ali, e ele mesmo abandona servidores
 * bloqueados no próximo boot e no próximo `guildCreate`. O contrário (sair
 * primeiro) deixaria a porta aberta se o banco recusasse a escrita.
 */
export async function blockGuild(formData: FormData): Promise<ActionResult> {
  const session = await requireBotOwner();
  const guildId = readGuildId(formData);
  if (!guildId) return { ok: false, message: 'Servidor inválido.' };

  const note = readNote(formData);
  const entry = await setGuildStatus(db(), guildId, { status: 'blocked', note });
  if (!entry) return { ok: false, message: 'Servidor não está no registro.' };
  revalidateAdmin();

  try {
    await internalApi().admin.leaveGuild(guildId, {
      actorId: session.user.id,
      announce: true,
      ...(note ? { reason: note } : {}),
    });
  } catch (error) {
    // 404 é o caso normal: bloquear um servidor em que o bot nunca entrou.
    const message = failure(error).message;
    return {
      ok: true,
      message: `Bloqueado. O bot não saiu agora (${message ?? 'sem resposta'}); ele sai sozinho no próximo boot.`,
    };
  }

  return { ok: true, message: 'Bloqueado e fora do servidor.' };
}

/** Expulsar sem bloquear: o bot sai, mas o status decidido continua valendo. */
export async function leaveGuild(formData: FormData): Promise<ActionResult> {
  const session = await requireBotOwner();
  const guildId = readGuildId(formData);
  if (!guildId) return { ok: false, message: 'Servidor inválido.' };

  const reason = readNote(formData);
  const announce = formData.get('announce') !== 'false';
  try {
    const result = await internalApi().admin.leaveGuild(guildId, {
      actorId: session.user.id,
      announce,
      ...(reason ? { reason } : {}),
    });
    revalidateAdmin();
    return {
      ok: true,
      message: result.announced
        ? `Saiu de ${result.name}, com aviso.`
        : `Saiu de ${result.name} (sem canal onde avisar).`,
    };
  } catch (error) {
    return failure(error, 'O bot não respondeu; ele continua no servidor.');
  }
}

export interface BroadcastOutcome extends ActionResult {
  result?: BroadcastResult;
}

/**
 * O aviso para todos os servidores.
 *
 * A confirmação digitada vai no corpo e é conferida pela API do bot, não só
 * aqui: uma trava que existe só no navegador protege contra o clique errado,
 * não contra a chamada solta — e este é o único endpoint do projeto que
 * escreve em servidores que não são nossos.
 */
export async function broadcast(formData: FormData): Promise<BroadcastOutcome> {
  const session = await requireBotOwner();

  const title = String(formData.get('title') ?? '').trim();
  const message = String(formData.get('message') ?? '').trim();
  const dryRun = formData.get('dryRun') === 'true';
  const confirm = String(formData.get('confirm') ?? '').trim();

  if (title === '' || title.length > MAX_EMBED_TITLE_LENGTH) {
    return { ok: false, message: 'Título vazio ou longo demais.' };
  }
  if (message === '' || message.length > MAX_EMBED_DESCRIPTION_LENGTH) {
    return { ok: false, message: 'Mensagem vazia ou longa demais.' };
  }
  // O ensaio não manda nada, então não precisa da palavra; o envio precisa.
  if (!dryRun && confirm !== BROADCAST_CONFIRMATION) {
    return { ok: false, message: `Digite ${BROADCAST_CONFIRMATION} para confirmar.` };
  }

  try {
    const result = await internalApi().admin.broadcast({
      actorId: session.user.id,
      title,
      message,
      confirm: BROADCAST_CONFIRMATION,
      dryRun,
    });
    return {
      ok: true,
      result,
      message: dryRun
        ? `Ensaio: ${String(result.total)} servidores na lista.`
        : `Enviado para ${String(result.delivered)} de ${String(result.total)}.`,
    };
  } catch (error) {
    return failure(error, 'O bot não respondeu; nada foi enviado.');
  }
}

export interface MaintenanceOutcome extends ActionResult {
  state?: MaintenanceState;
}

export async function setMaintenance(formData: FormData): Promise<MaintenanceOutcome> {
  const session = await requireBotOwner();
  const enabled = formData.get('enabled') === 'true';
  const raw = formData.get('message');
  const message = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

  try {
    const state = await internalApi().admin.setMaintenance({
      actorId: session.user.id,
      enabled,
      message,
    });
    revalidateAdmin();
    return {
      ok: true,
      state,
      message: enabled ? 'Manutenção ligada.' : 'Manutenção desligada.',
    };
  } catch (error) {
    return failure(error, 'O bot não respondeu; a manutenção não mudou.');
  }
}

export interface ResyncOutcome extends ActionResult {
  result?: ResyncCommandsResult;
}

export async function resyncCommands(formData: FormData): Promise<ResyncOutcome> {
  const session = await requireBotOwner();
  const guildId = readGuildId(formData);

  try {
    const result = await internalApi().admin.resyncCommands({
      actorId: session.user.id,
      ...(guildId ? { guildId } : {}),
    });
    const ok = result.guilds.filter((guild) => guild.registered).length;
    return {
      ok: true,
      result,
      message: `${String(result.count)} comandos re-registrados em ${String(ok)} de ${String(result.guilds.length)} servidores.`,
    };
  } catch (error) {
    return failure(error, 'O bot não respondeu; nada foi re-registrado.');
  }
}
