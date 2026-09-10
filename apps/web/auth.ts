import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';

import { env } from '@/lib/env';
import { isStale, resolveGuildLevel, retryAt } from '@/lib/auth/resolve';

import type { AccessLevel } from '@/lib/auth/access';

/** Campos que o Goodbot guarda no JWT, além dos do Auth.js. */
interface GoodbotToken {
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
        const goodbot = token as GoodbotToken;

        // Só existem no login; das renovações em diante vale o que ficou aqui.
        if (account?.providerAccountId) goodbot.discordId = account.providerAccountId;
        else if (typeof profile?.id === 'string') goodbot.discordId = profile.id;

        const userId = goodbot.discordId;
        if (!userId) return token;
        if (goodbot.guildId === config.GUILD_ID && !isStale(goodbot.checkedAt)) return token;

        // Um `jwt` que lança faz o Auth.js descartar o token inteiro, e o
        // painel cai em `/login` no meio da sessão. Falar com a API do bot é a
        // parte que falha: numa rajada de escrita o teto de 60 req/min por IP
        // devolve 429 (a Vercel sai toda pelo mesmo IP) e a permissão não tem
        // como ser confirmada. Nesse caso vale o nível que já estava no token.
        try {
          goodbot.level = await resolveGuildLevel(userId);
          goodbot.guildId = config.GUILD_ID;
          goodbot.checkedAt = Date.now();
        } catch {
          // Sem nível anterior desta guild não há o que preservar; segue sem
          // permissão e tenta de novo na próxima requisição.
          if (goodbot.guildId !== config.GUILD_ID || !goodbot.level) return token;
          goodbot.checkedAt = retryAt();
        }
        return token;
      },
      session({ session, token }) {
        const goodbot = token as GoodbotToken;
        session.user.id = goodbot.discordId ?? '';
        session.user.name = goodbot.name ?? 'desconhecido';
        session.user.image = goodbot.picture ?? null;
        session.level = goodbot.level ?? 'none';
        session.guildId = goodbot.guildId ?? config.GUILD_ID;
        session.checkedAt = goodbot.checkedAt ?? 0;
        return session;
      },
    },
  };
});
