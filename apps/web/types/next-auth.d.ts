import type { DefaultSession } from 'next-auth';
import type { GuildGrant } from '@/lib/auth/access';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: { id: string } & DefaultSession['user'];
    /**
     * Nível confirmado por guild (PRD §9.2). Guild ausente do mapa é guild sem
     * acesso — a checagem é sempre contra a guild da URL, nunca contra "a"
     * guild da sessão.
     */
    guilds: Record<string, GuildGrant>;
  }
}

// O `JWT` mora em `@auth/core/jwt`, que não é dependência direta do painel:
// os campos extras do token são tipados em `auth.ts` (`GoodbotToken`).

export {};
