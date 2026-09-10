'use client';

import { useParams } from 'next/navigation';

/**
 * O `guildId` da rota, para o componente cliente que dispara uma action.
 *
 * Toda escrita do painel leva a guild **explícita** no primeiro argumento
 * (invariante §10.2 do `architecture.md`): quem decide é a guild da URL, e é
 * ela que o `requireGuildAccess` do lado do servidor confere. Antes as actions
 * resolviam sozinhas a "primeira guild atendida", o que escrevia no servidor
 * errado para quem tem acesso a mais de um.
 */
export function useGuildId(): string {
  return useParams<{ guildId: string }>().guildId;
}
