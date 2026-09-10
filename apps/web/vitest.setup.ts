import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

import type * as navigation from 'next/navigation';

/**
 * Todo componente cliente do painel lê a guild da rota (`/g/[guildId]`), pelo
 * `useGuildId`: os seletores para não oferecerem a lista do servidor errado, e
 * quem dispara uma action porque a guild vai explícita na chamada. Fora de uma
 * rota do Next o `useParams` não existe, então os testes de componente ganham
 * a guild daqui.
 */
export const TEST_GUILD_ID = '111111111111111111';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof navigation>('next/navigation');
  return { ...actual, useParams: () => ({ guildId: TEST_GUILD_ID }) };
});
