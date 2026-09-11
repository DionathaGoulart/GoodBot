import { getBotBio, setBotBio } from '@goodbot/db';
import { BotProfileInputSchema } from '@goodbot/shared';
import { DiscordAPIError } from 'discord.js';
import { Hono } from 'hono';

import { requireActor, requireBotMember } from '../actor';
import { ApiHttpError, forbidden } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type { BotProfile } from '@goodbot/shared';
import type { ClientUser, GuildMember } from 'discord.js';

/**
 * O perfil do bot **neste** servidor (PRD §6.6). Apelido, avatar e capa moram
 * no `GuildMember` do próprio bot, e é de lá que eles são lidos: o Discord já
 * é a fonte de verdade e uma cópia nossa só poderia divergir dele.
 *
 * A bio não segue a mesma regra porque não dá: o Discord aceita escrevê-la e
 * não a devolve em endpoint nenhum. Ela chega aqui pelo espelho em
 * `guild_settings.bot_bio`, gravado só depois de o Discord aceitar.
 */
export function toBotProfile(me: GuildMember, user: ClientUser, bio: string | null): BotProfile {
  return {
    id: me.id,
    nick: me.nickname,
    displayName: me.displayName,
    globalName: user.globalName ?? user.username,
    avatarUrl: me.avatarURL({ size: 256 }),
    globalAvatarUrl: user.displayAvatarURL({ size: 256 }),
    bannerUrl: me.bannerURL({ size: 512 }) ?? null,
    bio,
    permissions: { changeNickname: me.permissions.has('ChangeNickname') },
  };
}

/** O `ClientUser` do bot; sem `ready` não existe perfil para mostrar. */
function requireClientUser(deps: ApiDeps): ClientUser {
  const user = deps.client.user;
  if (!user) throw new ApiHttpError(503, 'BOT_NOT_READY', 'O bot ainda está conectando.');
  return user;
}

/**
 * Traduz a recusa do Discord citando o campo que foi junto. O 400 dele é
 * genérico ("Invalid Form Body") e, numa tela com quatro campos, não dizer
 * qual deles caiu é o mesmo que não dizer nada.
 */
function rejected(error: DiscordAPIError, fields: string[]): ApiHttpError {
  const list = fields.join(', ');
  return new ApiHttpError(
    400,
    'BOT_PROFILE_REJECTED',
    `O Discord recusou o perfil do bot (${list}). Código ${String(error.code)}.`,
  );
}

export function createBotProfileRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return (
    new Hono<ApiEnv>()
      .get('/', async (c) => {
        const guild = c.get('guild');
        const bio = await getBotBio(deps.db, guild.id);
        return c.json(toBotProfile(requireBotMember(guild), requireClientUser(deps), bio));
      })

      /**
       * Salvar o perfil. Só `admin`, e o apelido é o único campo com permissão
       * atrás: `CHANGE_NICKNAME` costuma vir no convite, mas um cargo editado à
       * mão pode tê-la tirado — e aí o Discord responderia 403 sem explicar.
       */
      .patch('/', validate('json', BotProfileInputSchema), async (c) => {
        const input = c.req.valid('json');
        const guild = c.get('guild');
        const actor = await requireActor(deps, guild, input.actorId, 'admin');
        const me = requireBotMember(guild);

        if (input.nick !== me.nickname && !me.permissions.has('ChangeNickname')) {
          throw forbidden(
            'O bot não tem a permissão Alterar Apelido; reconvide-o com ela.',
            'MISSING_CHANGE_NICKNAME',
          );
        }

        // O que vai na mensagem de erro se o Discord recusar. `undefined` não
        // entra: o campo intocado não pode ser acusado de derrubar o save.
        const fields = [
          'apelido',
          'bio',
          ...(input.avatar === undefined ? [] : ['avatar']),
          ...(input.banner === undefined ? [] : ['capa']),
        ];

        try {
          const edited = await guild.members.editMe({
            nick: input.nick,
            bio: input.bio,
            // `undefined` não mexe, `null` remove, data URL troca — é o mesmo
            // contrato do `PATCH /guild`, e o discord.js respeita os três.
            ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
            ...(input.banner === undefined ? {} : { banner: input.banner }),
            reason: input.reason ?? `Perfil do bot editado pelo painel por ${actor.user.tag}`,
          });
          // O espelho só depois do aceite: se o Discord recusasse, o painel
          // passaria a mostrar uma bio que não está valendo em lugar nenhum.
          await setBotBio(deps.db, guild.id, input.bio);
          return c.json(toBotProfile(edited, requireClientUser(deps), input.bio));
        } catch (error) {
          // 429 e o resto seguem para o `mapError`, que já os traduz.
          if (error instanceof DiscordAPIError && (error.status === 400 || error.status === 403)) {
            throw rejected(error, fields);
          }
          throw error;
        }
      })
  );
}
