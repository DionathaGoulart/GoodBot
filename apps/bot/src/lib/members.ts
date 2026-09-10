import type { Guild, GuildMember } from 'discord.js';

/** Máximo que o Discord devolve numa página de `GET /guilds/:id/members`. */
export const MEMBER_LIST_PAGE = 1_000;

/**
 * Quantas páginas varremos para contar membros por cargo. Cinco mil membros
 * são cinco chamadas; acima disso a conta sai cara e a resposta vira "não sei"
 * — no molde do `BAN_SCAN_PAGES`, e pelo mesmo motivo: um servidor grande não
 * pode fazer uma tela do painel pendurar a VM.
 */
export const ROLE_SCAN_MAX_PAGES = 5;

/**
 * Quantos membros têm cada cargo, ou `null` quando não dá para saber sem varrer
 * um servidor grande inteiro.
 *
 * Antes da Etapa 6 isto era `role.members.size`, que lia o cache — e o cache
 * tinha o servidor inteiro. Com o teto por guild ele passou a ser uma amostra,
 * e contar nele daria um número **errado com cara de certo**, que é pior do
 * que não ter número. Daí as três respostas possíveis:
 *
 * · cache completo (servidor pequeno, todo mundo já apareceu) → conta nele, de
 *   graça;
 * · servidor até `ROLE_SCAN_MAX_PAGES × MEMBER_LIST_PAGE` → varre por REST sem
 *   cachear nada e conta exato;
 * · acima disso → `null`, e quem mostra escreve "—".
 */
export async function roleMemberCounts(guild: Guild): Promise<Map<string, number> | null> {
  if (guild.members.cache.size >= guild.memberCount) {
    return countRoles(guild.members.cache.values());
  }
  if (guild.memberCount > MEMBER_LIST_PAGE * ROLE_SCAN_MAX_PAGES) return null;

  const counts = new Map<string, number>();
  let after: string | undefined;

  try {
    for (let page = 0; page < ROLE_SCAN_MAX_PAGES; page += 1) {
      const batch = await guild.members.list({
        limit: MEMBER_LIST_PAGE,
        ...(after === undefined ? {} : { after }),
        // Varredura não é cache: estes membros não voltam a ser usados, e
        // cachear cinco mil deles despejaria quem a moderação está tratando.
        cache: false,
      });
      if (batch.size === 0) break;
      for (const member of batch.values()) {
        countMember(counts, member.roles.cache.keys());
        after = member.id;
      }
      if (batch.size < MEMBER_LIST_PAGE) break;
    }
  } catch {
    // Sem a intent `GuildMembers` no portal, ou com o Discord recusando: "não
    // sei" é uma resposta honesta; derrubar a tela de cargos não é.
    return null;
  }

  return counts;
}

function countRoles(members: Iterable<GuildMember>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const member of members) countMember(counts, member.roles.cache.keys());
  return counts;
}

function countMember(counts: Map<string, number>, roleIds: Iterable<string>): void {
  for (const roleId of roleIds) counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
}
