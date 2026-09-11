import { z } from 'zod';

import { GuildImageSchema } from './guild';
import { actorFields } from './roles';
import { SnowflakeSchema } from '../config/common';

/** Teto do Discord para o apelido de um membro. */
export const MAX_BOT_NICK_LENGTH = 32;

/**
 * O perfil do bot **dentro de um servidor** (PRD §6.6).
 *
 * O Discord guarda apelido, avatar e capa no *membro*, não na aplicação: cada
 * servidor tem os seus, e o que falta cai no perfil global do bot. Por isso
 * esta tela não tem nada no banco — a fonte é o `GuildMember` do próprio bot,
 * lido ao vivo.
 *
 * A bio de membro fica de fora de propósito: o Discord aceita escrevê-la, mas
 * não a devolve no membro, então o painel não teria como mostrar a que está
 * valendo e cada save escreveria por cima de um valor invisível.
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
  permissions: z.object({
    /** Sem `CHANGE_NICKNAME` o Discord recusa o apelido — e só ele. */
    changeNickname: z.boolean(),
  }),
});
export type BotProfile = z.infer<typeof BotProfileSchema>;

/**
 * O corpo do `PATCH /bot-profile`. Mesma forma do `PATCH /guild`: o apelido vai
 * sempre (o formulário salva inteiro, e `''` remove), e as imagens são
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
});
export type BotProfileInput = z.infer<typeof BotProfileInputSchema>;
