import 'server-only';

import { defaultGuildId, isConfiguredGuild } from './require';

/**
 * Lê `?guildId=` de uma rota de apoio (os seletores de canal, cargo e membro).
 * Sem o parâmetro vale a primeira guild — é o que o painel de um servidor só
 * sempre fez, e mantém as URLs antigas funcionando.
 *
 * Um valor que o bot não atende **não** cai no padrão em silêncio: isso
 * devolveria os canais do servidor errado para um formulário do outro, que é
 * exatamente o tipo de erro que ninguém percebe até salvar.
 */
export async function guildFromQuery(url: string): Promise<string | null> {
  const informado = new URL(url).searchParams.get('guildId');
  if (informado === null) return defaultGuildId();
  return (await isConfiguredGuild(informado)) ? informado : null;
}
