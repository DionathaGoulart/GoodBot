import { redirect } from 'next/navigation';

import { listAccessibleGuilds } from '@/lib/guilds';

/**
 * `force-dynamic` é obrigatório: o destino sai do registro no banco e da
 * sessão, e prerenderizar esta rota no build faria o `next build` exigir um
 * Postgres.
 */
export const dynamic = 'force-dynamic';

/**
 * A raiz decide para onde a pessoa vai:
 *
 * · um servidor acessível → direto para ele, sem tela intermediária;
 * · mais de um → o seletor;
 * · nenhum → o seletor também, que é quem explica o que aconteceu.
 *
 * O destino sai do que **este usuário** pode abrir, não do primeiro servidor
 * do registro: com servidores de terceiros, "o primeiro" quase nunca é o dele.
 */
export default async function Home() {
  const guilds = await listAccessibleGuilds();
  const [only] = guilds;
  redirect(guilds.length === 1 && only ? `/g/${only.id}` : '/servidores');
}
