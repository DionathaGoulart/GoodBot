import 'server-only';

import { cache } from 'react';

import { auth } from '@/auth';

/**
 * A sessão desta requisição, resolvida **uma vez só**.
 *
 * `auth()` não é barato: cada chamada re-executa o callback `jwt`, que
 * reconfirma o nível de permissão com a API do bot quando o `checkedAt` está
 * velho (§6, 15 min). E ele fica velho durante a requisição inteira, porque o
 * token novo só é gravado no cookie na resposta — então cada `auth()` a mais
 * enxerga o mesmo valor vencido e paga a reconfirmação de novo.
 *
 * Uma tela do painel chamava `auth()` três vezes (o `requireGuildAccess` do
 * layout, o da própria página e o `listAccessibleGuilds`). Medido no log da
 * Vercel, um render de `/g/<id>/emojis` fazia `members/<userId>` e `roles`
 * **três vezes cada** — seis idas à VM onde bastavam duas — e terminava em
 * 6.3s. O `cache` do React memoiza por requisição e derruba as três para uma.
 *
 * Não troca o TTL nem afrouxa permissão: entre requisições nada é
 * reaproveitado, e quem decide acesso continua sendo o `requireGuildAccess`.
 */
export const currentSession = cache(async () => auth());
