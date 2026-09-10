import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';

import { env } from '@/lib/env';
import { isStale, resolveGuildLevel, retryAt } from '@/lib/auth/resolve';

import type { GuildGrant } from '@/lib/auth/access';

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
  /**
   * Um nível por guild. Era um `level` só, o que bastava enquanto havia um
   * servidor; com mais de um vira furo de permissão, porque alguém pode ser
   * dono de um e nem estar no outro.
   */
  guilds?: Record<string, GuildGrant>;
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

        const anterior = goodbot.guilds ?? {};
        const guilds: Record<string, GuildGrant> = {};

        for (const guildId of config.guildIds) {
          const atual = anterior[guildId];
          if (atual && !isStale(atual.checkedAt)) {
            guilds[guildId] = atual;
            continue;
          }
          // Um `jwt` que lança faz o Auth.js descartar o token inteiro, e o
          // painel cai em `/login` no meio da sessão. Falar com a API do bot é
          // a parte que falha: numa rajada de escrita o teto por IP devolve 429
          // (a Vercel sai toda pelo mesmo punhado de IPs) e a permissão não tem
          // como ser confirmada. Nesse caso vale o nível que já estava no token.
          try {
            guilds[guildId] = {
              level: await resolveGuildLevel(userId, guildId),
              checkedAt: Date.now(),
            };
          } catch {
            // Sem nível anterior nesta guild não há o que preservar: ela fica
            // de fora do mapa (= sem acesso) e tenta de novo na requisição
            // seguinte. Uma guild que falha não derruba as outras.
            if (atual) guilds[guildId] = { ...atual, checkedAt: retryAt() };
          }
        }

        // Guild que saiu do `GUILD_IDS` sai do token junto: manter um nível
        // órfão seria acesso a um servidor que o painel já não gerencia.
        goodbot.guilds = guilds;
        return token;
      },
      session({ session, token }) {
        const goodbot = token as GoodbotToken;
        session.user.id = goodbot.discordId ?? '';
        session.user.name = goodbot.name ?? 'desconhecido';
        session.user.image = goodbot.picture ?? null;
        session.guilds = goodbot.guilds ?? {};
        return session;
      },
    },
  };
});
