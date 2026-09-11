import 'server-only';

import { guildSettings, guilds } from '@goodbot/db';
import { InternalApiError } from '@goodbot/shared';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '../db';
import { internalApi } from '../internal-api';
import { isStale, resolveAccessLevel, type AccessLevel } from './access';

export { ACCESS_CHECK_TTL_MS, isStale, retryAt } from './access';

/**
 * Pergunta ao bot (cache de membros e cargos ao vivo) e ao banco (cargos
 * configurados) qual o nível do usuário **naquela guild**. Bot fora do ar →
 * `none`: sem confirmação de permissão o painel não libera nada.
 *
 * O nível é por guild: alguém pode ser dono de um servidor e nem estar no
 * outro, então resolver uma vez e reaproveitar seria um furo de permissão.
 *
 * Duas idas à VM por chamada, e as duas de cache: `members/<id>` e a lista de
 * cargos **sem contagem**. A contagem por cargo custa uma varredura por REST no
 * Discord e esta checagem nunca precisou dela, só do bitfield de cada cargo.
 *
 * Quem chama é o `resolveGuildLevel`, que põe os prazos em volta.
 */
async function fetchGuildLevel(userId: string, guildId: string): Promise<AccessLevel> {
  let memberRoleIds: string[] | null = null;
  let rolePermissions: Record<string, string> = {};
  try {
    const api = internalApi();
    const [member, roles] = await Promise.all([api.member(guildId, userId), api.roles(guildId)]);
    memberRoleIds = [...member.roleIds, guildId]; // `@everyone` tem o id da guild.
    rolePermissions = Object.fromEntries(roles.map((role) => [role.id, role.permissions]));
  } catch (error) {
    // Não estar no servidor é uma resposta legítima, não uma falha.
    if (error instanceof InternalApiError && error.status === 404) return 'none';
    throw error;
  }

  const [guild] = await db().select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
  const [settings] = await db()
    .select()
    .from(guildSettings)
    .where(eq(guildSettings.guildId, guildId))
    .limit(1);

  return resolveAccessLevel({
    userId,
    ownerId: guild?.ownerId ?? null,
    memberRoleIds,
    rolePermissions,
    adminRoleIds: settings?.adminRoleIds,
    modRoleIds: settings?.modRoleIds,
    dashboardAccessRoleIds: settings?.dashboardAccessRoleIds,
  });
}

/**
 * Níveis já confirmados nesta instância, com o instante da confirmação.
 *
 * O prazo de 15 minutos (§6) deveria morar no JWT, e mora: o callback `jwt`
 * grava `checkedAt` no token. O que ele não consegue é **salvar** esse token
 * quando a requisição é um render de página. Gravar cookie durante o render de
 * um Server Component não é permitido pelo Next, o Auth.js engole o erro, e o
 * token que volta ao navegador continua com o `checkedAt` velho. Resultado: o
 * prazo nunca vencia porque nunca começava, e **cada** navegação reconfirmava a
 * permissão com a VM.
 *
 * Medido no log do Caddy, seis horas de uso de uma pessoa só renderam 345
 * confirmações onde o prazo permitiria duas dúzias.
 *
 * Este mapa devolve ao prazo o efeito que ele já deveria ter. Ele não afrouxa
 * nada: a janela é a mesma `ACCESS_CHECK_TTL_MS` que o token documenta, quem
 * decide acesso continua sendo o `requireGuildAccess`, e a chave é o par
 * usuário + guild, então nível de um servidor não vaza para outro. Falha não
 * entra aqui: só nível confirmado é guardado.
 *
 * Vive na memória da instância da Vercel, que é efêmera e plural. Isso é
 * aceitável de propósito: perder a memória custa uma confirmação a mais, nunca
 * uma permissão a mais.
 */
const NIVEIS = new Map<string, { level: AccessLevel; checkedAt: number }>();

/**
 * Teto do mapa. Cada entrada é um par usuário + guild; sem teto, uma instância
 * de vida longa acumularia uma linha por visitante. No estouro o mapa inteiro
 * é descartado: é mais barato do que ordenar por idade, e o preço de errar é
 * uma confirmação a mais.
 */
const MAX_NIVEIS = 500;

/**
 * O nível do usuário naquela guild, confirmado no máximo uma vez a cada
 * `ACCESS_CHECK_TTL_MS`.
 *
 * Dois cachês empilhados, de propósito e com prazos diferentes: o `cache` do
 * React derruba para uma as várias perguntas de um mesmo render, e o mapa
 * acima faz o prazo de 15 minutos valer entre requisições (ver `NIVEIS`).
 */
export const resolveGuildLevel = cache(async function resolveGuildLevel(
  userId: string,
  guildId: string,
): Promise<AccessLevel> {
  const chave = `${userId}:${guildId}`;
  const lembrado = NIVEIS.get(chave);
  if (lembrado && !isStale(lembrado.checkedAt)) return lembrado.level;

  const level = await fetchGuildLevel(userId, guildId);

  if (NIVEIS.size >= MAX_NIVEIS) NIVEIS.clear();
  NIVEIS.set(chave, { level, checkedAt: Date.now() });
  return level;
});
