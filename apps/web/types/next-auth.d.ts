import type { DefaultSession } from 'next-auth';
import type { AccessLevel } from '@/lib/auth/access';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: { id: string } & DefaultSession['user'];
    /** Nível resolvido para `guildId` (PRD §9.2). */
    level: AccessLevel;
    guildId: string;
    /** Epoch ms da última verificação de permissão. */
    checkedAt: number;
  }
}

// O `JWT` mora em `@auth/core/jwt`, que não é dependência direta do painel:
// os campos extras do token são tipados em `auth.ts` (`GoodbotToken`).

export {};
