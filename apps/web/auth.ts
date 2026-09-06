import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';

import { env } from '@/lib/env';
import { isStale, resolveGuildLevel } from '@/lib/auth/resolve';

import type { AccessLevel } from '@/lib/auth/access';

/** Campos que o CoBot guarda no JWT, além dos do Auth.js. */
interface CobotToken {
  sub?: string;
  name?: string | null;
  picture?: string | null;
  level?: AccessLevel;
  guildId?: string;
  checkedAt?: number;
}

/**
 * Auth.js v5 com Discord (PRD §7.3). Config em função para só tocar no
 * ambiente na primeira requisição — assim o build não depende de segredo.
 *
 * O access token do usuário **não** é guardado: ele serve só para o login. A
 * permissão vem da API do bot e é recarregada a cada 15 min.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const config = env();

  return {
    secret: config.AUTH_SECRET,
    trustHost: true,
    session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
    pages: { signIn: '/login', error: '/login' },
    providers: [
      Discord({
        clientId: config.DISCORD_CLIENT_ID,
        clientSecret: config.DISCORD_CLIENT_SECRET,
        authorization: { params: { scope: 'identify guilds guilds.members.read' } },
      }),
    ],
    callbacks: {
      async jwt({ token }) {
        const cobot = token as CobotToken;
        if (!cobot.sub) return token;
        if (cobot.guildId === config.GUILD_ID && !isStale(cobot.checkedAt)) return token;

        cobot.level = await resolveGuildLevel(cobot.sub);
        cobot.guildId = config.GUILD_ID;
        cobot.checkedAt = Date.now();
        return token;
      },
      session({ session, token }) {
        const cobot = token as CobotToken;
        session.user.id = cobot.sub ?? '';
        session.user.name = cobot.name ?? 'desconhecido';
        session.user.image = cobot.picture ?? null;
        session.level = cobot.level ?? 'none';
        session.guildId = cobot.guildId ?? config.GUILD_ID;
        session.checkedAt = cobot.checkedAt ?? 0;
        return session;
      },
    },
  };
});
