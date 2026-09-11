import { z } from 'zod';

import { GuildImageSchema } from './guild';
import { actorFields } from './roles';
import { SnowflakeSchema } from '../config/common';

/** Teto do Discord para o apelido de um membro. */
export const MAX_BOT_NICK_LENGTH = 32;
/** Teto do Discord para a bio de um perfil. */
export const MAX_BOT_BIO_LENGTH = 190;

/**
 * O perfil do bot **dentro de um servidor** (PRD §6.6).
 *
 * O Discord guarda apelido, avatar, capa e bio no *membro*, não na aplicação:
 * cada servidor tem os seus, e o que falta cai no perfil global do bot.
 *
 * Três dos quatro vêm do `GuildMember` lido ao vivo. A bio é a exceção: o
 * Discord aceita escrevê-la e não a devolve em endpoint nenhum, então ela é
 * espelhada em `guild_settings.bot_bio` e o painel mostra a última que salvou.
 */
export const BotProfileSchema = z.object({
  id: SnowflakeSchema,
  /** Apelido só deste servidor; `null` = o servidor vê o nome global. */
  nick: z.string().nullable(),
  /** O que o servidor lê hoje: o apelido, se houver; senão o nome global. */
  displayName: z.string(),
  /** O nome da aplicação, igual em todo servidor. */
  globalName: z.string(),
  /** Avatar só deste servidor; `null` = cai no global. */
  avatarUrl: z.url().nullable(),
  /** O global, para o preview mostrar o que fica valendo sem avatar próprio. */
  globalAvatarUrl: z.url(),
  /** Capa só deste servidor. O bot não tem capa global para cair. */
  bannerUrl: z.url().nullable(),
  /**
   * A última bio que o painel gravou (espelho em `guild_settings.bot_bio`).
   * O Discord não devolve a bio do membro: se alguém a mudar por fora, isto
   * fica velho e não há como perceber.
   */
  bio: z.string().nullable(),
  permissions: z.object({
    /** Sem `CHANGE_NICKNAME` o Discord recusa o apelido — e só ele. */
    changeNickname: z.boolean(),
  }),
});
export type BotProfile = z.infer<typeof BotProfileSchema>;

/**
 * O corpo do `PATCH /bot-profile`. Mesma forma do `PATCH /guild`: apelido e bio
 * vão sempre (o formulário salva inteiro, e `''` remove), e as imagens são
 * opcionais em três estados — ausente = não mexer, `null` = remover, data URL
 * = trocar. Sem os três estados não haveria como distinguir "não toquei na
 * capa" de "apague a capa".
 */
export const BotProfileInputSchema = z.object({
  ...actorFields,
  /**
   * `''` (ou só espaço) remove o apelido, e o servidor volta a ver o nome
   * global. O `emptyToNull` de `config/common` não serve aqui: ele olha a
   * string antes do `trim`, e `'   '` chegaria ao Discord como apelido vazio.
   */
  nick: z
    .string()
    .trim()
    .max(MAX_BOT_NICK_LENGTH)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
  avatar: GuildImageSchema.nullable().optional(),
  banner: GuildImageSchema.nullable().optional(),
  /** Como o apelido, vai sempre e `''` limpa. */
  bio: z
    .string()
    .trim()
    .max(MAX_BOT_BIO_LENGTH)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value)),
});
export type BotProfileInput = z.infer<typeof BotProfileInputSchema>;
