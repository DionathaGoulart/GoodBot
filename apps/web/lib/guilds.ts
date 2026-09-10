import 'server-only';

import { cache } from 'react';

import { auth } from '@/auth';

import { cachedInternalApi } from './internal-api';
import { servedGuildIds } from './registry';

import type { AccessLevel } from './auth/access';

export interface ManagedGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  level: AccessLevel;
}

/**
 * Os servidores que **este usuário** pode abrir.
 *
 * Até aqui a lista era "tudo o que o bot atende", o que bastava enquanto os
 * servidores eram todos do dono do bot. Com servidores de terceiros isso virou
 * vazamento: quem entra num servidor não tem por que ler o nome dos outros.
 * O filtro é o nível **por guild** que já está na sessão — a mesma conta que
 * `requireGuildAccess` usa, e que o `jwt` recarrega a cada 15 minutos —, então
 * a lista não custa nenhuma chamada nova de permissão.
 *
 * Esconder não é a barreira: quem digitar `/g/<id>` de um servidor alheio bate
 * no `requireGuildAccess` da própria página (PRD §7.3).
 *
 * O `cache` do React memoiza por requisição (o layout e a topbar pedem a mesma
 * lista) e o `cachedInternalApi` de 60 s evita uma chamada por servidor a cada
 * navegação. Guild que o bot ainda não entrou responde 404 — não é erro, é o
 * estado normal entre a linha aparecer no registro e o bot ser convidado —,
 * então ela aparece com o próprio ID de rótulo em vez de sumir.
 */
export const listAccessibleGuilds = cache(async (): Promise<ManagedGuild[]> => {
  const session = await auth();
  const grants = session?.guilds ?? {};
  const api = cachedInternalApi(60);

  const acessiveis = (await servedGuildIds())
    .map((id) => ({ id, level: grants[id]?.level ?? ('none' as AccessLevel) }))
    .filter((guild) => guild.level !== 'none');

  const guilds = await Promise.all(
    acessiveis.map(async ({ id, level }) => {
      try {
        const profile = await api.guildProfile(id);
        return { id, name: profile.name, iconUrl: profile.iconUrl, level };
      } catch {
        return { id, name: id, iconUrl: null, level };
      }
    }),
  );

  return guilds.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
});
