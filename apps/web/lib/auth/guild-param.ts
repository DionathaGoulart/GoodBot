import 'server-only';

import { isConfiguredGuild } from './require';

/**
 * Lê `?guildId=` de uma rota de apoio (os seletores de canal, cargo e membro,
 * o export de casos em CSV). Não há padrão: sem o parâmetro a rota não sabe de
 * qual servidor está falando, e adivinhar devolveria os canais de um servidor
 * para o formulário de outro — exatamente o tipo de erro que ninguém percebe
 * até salvar. Quem chama monta a URL com o `guildId` da rota.
 *
 * Um valor que o bot não atende também vira `null`: uma URL inventada não deve
 * virar tráfego para o bot nem revelar se aquele servidor existe.
 */
export async function guildFromQuery(url: string): Promise<string | null> {
  const informado = new URL(url).searchParams.get('guildId');
  if (informado === null || informado === '') return null;
  return (await isConfiguredGuild(informado)) ? informado : null;
}
