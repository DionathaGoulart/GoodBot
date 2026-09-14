import 'server-only';

import { InternalApiError, MAX_MEMBER_LOOKUP_IDS } from '@goodbot/shared';

import { cachedInternalApi } from './internal-api';

import type { MemberSummaryRow } from './squad-players';

/** Os canais mudam pouco; um minuto de cache é o mesmo do `DiscordPicker`. */
const CACHE_SECONDS = 60;

/**
 * `id → #nome` dos canais da guild, para as tabelas mostrarem nome em vez de
 * snowflake. Bot fora do ar devolve `{}`: a tabela cai para o ID, que ainda é
 * legível, em vez de sumir com a coluna.
 */
export async function loadChannelNames(guildId: string): Promise<Record<string, string>> {
  try {
    const channels = await cachedInternalApi(CACHE_SECONDS).channels(guildId);
    return Object.fromEntries(channels.map((channel) => [channel.id, `#${channel.name}`]));
  } catch {
    return {};
  }
}

/** Idem para cargos (`@nome`). */
export async function loadRoleNames(guildId: string): Promise<Record<string, string>> {
  try {
    const roles = await cachedInternalApi(CACHE_SECONDS).roles(guildId);
    // O `@everyone` já vem com `@` no nome — dobrar viraria `@@everyone`.
    return Object.fromEntries(
      roles.map((role) => [role.id, role.name.startsWith('@') ? role.name : `@${role.name}`]),
    );
  } catch {
    return {};
  }
}

export interface MemberSummaries {
  members: Record<string, MemberSummaryRow>;
  /** Confirmados fora do servidor. */
  missing: string[];
  /** Sem resposta do bot ou do gateway. */
  unresolved: string[];
  /** Motivo quando algum lote falhou inteiro. */
  error: string | null;
}

/**
 * Nome e avatar de muita gente numa ida só por lote, com o mesmo minuto de
 * cache dos canais. Um lote que falha não derruba os outros: os IDs dele vão
 * para `unresolved`, e a tabela mostra o ID no lugar do nome.
 */
export async function loadMemberSummaries(
  guildId: string,
  ids: readonly string[],
): Promise<MemberSummaries> {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += MAX_MEMBER_LOOKUP_IDS) {
    batches.push(unique.slice(start, start + MAX_MEMBER_LOOKUP_IDS));
  }

  const result: MemberSummaries = { members: {}, missing: [], unresolved: [], error: null };
  const settled = await Promise.allSettled(
    batches.map((batch) => cachedInternalApi(CACHE_SECONDS).lookupMembers(guildId, batch)),
  );
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      result.unresolved.push(...(batches[index] ?? []));
      result.error ??=
        outcome.reason instanceof InternalApiError
          ? `O bot não respondeu: ${outcome.reason.message}`
          : 'O bot não respondeu.';
      return;
    }
    for (const member of outcome.value.members) {
      result.members[member.id] = {
        displayName: member.displayName,
        username: member.username,
        avatarUrl: member.avatarUrl,
      };
    }
    result.missing.push(...outcome.value.missing);
    result.unresolved.push(...outcome.value.unresolved);
  });
  return result;
}
