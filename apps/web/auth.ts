import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';

import { env } from '@/lib/env';
import { isStale, resolveGuildLevel, retryAt } from '@/lib/auth/resolve';

import type { AccessLevel } from '@/lib/auth/access';

/** Campos que o CoBot guarda no JWT, além dos do Auth.js. */
interface CobotToken {
  sub?: string;
  name?: string | null;
  picture?: string | null;
  /**
   * Snowflake do Discord. Guardado à parte porque o `sub` do Auth.js não é
   * confiável como identidade: sem adapter ele vem como UUID aleatório, e a
   * API do bot responde 404 para qualquer coisa que não seja snowflake — o
   * que o painel lê como "sem permissão".
   */
  discordId?: string;
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
    // Na Vercel o host chega por header e não há proxy nosso na frente; o
    // `AUTH_URL` é quem fixa a callback (PRD §7.3).
    trustHost: true,
    // Explícito em vez de inferido: em produção o cookie **tem** que sair com
    // prefixo `__Secure-` e `Secure`, e a inferência do Auth.js depende de o
    // host chegar como https até ele.
    useSecureCookies: config.AUTH_URL.startsWith('https://'),
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
      async jwt({ token, account, profile }) {
        const cobot = token as CobotToken;

        // Só existem no login; das renovações em diante vale o que ficou aqui.
        if (account?.providerAccountId) cobot.discordId = account.providerAccountId;
        else if (typeof profile?.id === 'string') cobot.discordId = profile.id;

        const userId = cobot.discordId;
        if (!userId) return token;
        if (cobot.guildId === config.GUILD_ID && !isStale(cobot.checkedAt)) return token;

        // Um `jwt` que lança faz o Auth.js descartar o token inteiro, e o
        // painel cai em `/login` no meio da sessão. Falar com a API do bot é a
        // parte que falha: numa rajada de escrita o teto de 60 req/min por IP
        // devolve 429 (a Vercel sai toda pelo mesmo IP) e a permissão não tem
        // como ser confirmada. Nesse caso vale o nível que já estava no token.
        try {
          cobot.level = await resolveGuildLevel(userId);
          cobot.guildId = config.GUILD_ID;
          cobot.checkedAt = Date.now();
        } catch {
          // Sem nível anterior desta guild não há o que preservar; segue sem
          // permissão e tenta de novo na próxima requisição.
          if (cobot.guildId !== config.GUILD_ID || !cobot.level) return token;
          cobot.checkedAt = retryAt();
        }
        return token;
      },
      session({ session, token }) {
        const cobot = token as CobotToken;
        session.user.id = cobot.discordId ?? '';
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
