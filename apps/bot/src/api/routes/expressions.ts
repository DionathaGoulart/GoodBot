import {
  ActorInputSchema,
  EmojiCreateInputSchema,
  EmojiUpdateInputSchema,
  StickerCreateInputSchema,
  StickerUpdateInputSchema,
  emojiSlotState,
  slotsFullMessage,
  stickerSlotState,
} from '@cobot/shared';
import { Hono } from 'hono';

import { requireActor } from '../actor';
import { ApiHttpError, forbidden, notFound } from '../errors';
import { validate } from '../validate';

import type { ApiDeps, ApiEnv } from '../context';
import type {
  ExpressionLimits,
  GuildEmojiSummary,
  GuildStickerSummary,
  SlotState,
} from '@cobot/shared';
import type { Guild, GuildEmoji, Sticker } from 'discord.js';

function toEmojiSummary(emoji: GuildEmoji): GuildEmojiSummary {
  return {
    id: emoji.id,
    name: emoji.name ?? emoji.id,
    url: emoji.imageURL({ size: 128 }),
    animated: emoji.animated ?? false,
    available: emoji.available ?? true,
    managed: emoji.managed ?? false,
    roleIds: [...emoji.roles.cache.keys()],
    createdAt: emoji.createdAt.toISOString(),
  };
}

function toStickerSummary(sticker: Sticker): GuildStickerSummary {
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description,
    tags: sticker.tags,
    url: sticker.url,
    available: sticker.available ?? true,
    format: sticker.format,
    createdAt: sticker.createdAt?.toISOString() ?? null,
  };
}

function canManage(guild: Guild): boolean {
  return guild.members.me?.permissions.has('ManageGuildExpressions') ?? false;
}

function requireManage(guild: Guild): void {
  if (canManage(guild)) return;
  throw forbidden(
    'O bot não tem a permissão Gerenciar Expressões; reconvide-o com ela.',
    'MISSING_MANAGE_EXPRESSIONS',
  );
}

/**
 * O que já está ocupado hoje, separado por pool como o Discord conta: emoji
 * animado e emoji estático têm cotas independentes.
 */
async function readExpressions(guild: Guild): Promise<{
  emojis: GuildEmojiSummary[];
  stickers: GuildStickerSummary[];
  limits: ExpressionLimits;
}> {
  const [emojis, stickers] = await Promise.all([guild.emojis.fetch(), guild.stickers.fetch()]);
  const animated = [...emojis.values()].filter((emoji) => emoji.animated).length;

  return {
    emojis: [...emojis.values()]
      .map(toEmojiSummary)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    stickers: [...stickers.values()]
      .map(toStickerSummary)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    limits: {
      premiumTier: guild.premiumTier,
      staticEmojis: emojis.size - animated,
      animatedEmojis: animated,
      stickers: stickers.size,
    },
  };
}

/**
 * Recusa antes de o upload sair daqui, com a contagem dentro da mensagem. O
 * Discord responderia `50138` sem dizer quantos slots faltam, e é justamente
 * essa conta que quem administra precisa ver.
 */
function assertSlot(state: SlotState, kind: 'emoji-static' | 'emoji-animated' | 'sticker'): void {
  if (!state.full) return;
  throw new ApiHttpError(400, 'SLOTS_FULL', slotsFullMessage(kind, state));
}

/**
 * A imagem chega como data URL e o discord.js quer bytes. `Buffer.from` com a
 * base64 já validada pelo schema evita o caminho em que uma string vira nome
 * de arquivo e o upload falha com um erro de `fs`.
 */
function toBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function requireEmoji(guild: Guild, emojiId: string): Promise<GuildEmoji> {
  const emoji = await guild.emojis.fetch(emojiId).catch(() => null);
  if (!emoji) throw notFound('Emoji não encontrado.', 'EMOJI_NOT_FOUND');
  if (emoji.managed) {
    throw forbidden('Esse emoji é de uma integração; só ela pode mexer nele.', 'EMOJI_MANAGED');
  }
  return emoji;
}

async function requireSticker(guild: Guild, stickerId: string): Promise<Sticker> {
  const sticker = await guild.stickers.fetch(stickerId).catch(() => null);
  if (!sticker) throw notFound('Sticker não encontrado.', 'STICKER_NOT_FOUND');
  return sticker;
}

/**
 * Emojis e stickers pelo painel (PRD §6.3). O `GuildStickerManager` está com
 * cache 0 (§7.2), então cada tela é um REST sob demanda — e é o mesmo fetch
 * que serve para contar os slots.
 */
export function createExpressionRoutes(deps: ApiDeps): Hono<ApiEnv> {
  return new Hono<ApiEnv>()
    .get('/', async (c) => {
      const guild = c.get('guild');
      return c.json({ ...(await readExpressions(guild)), canManage: canManage(guild) });
    })

    .post('/emojis', validate('json', EmojiCreateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      // O schema já validou tipo e tamanho; aqui só falta saber em qual dos
      // dois pools o emoji cai — e é o `image/gif` que decide isso.
      const animated = input.image.startsWith('data:image/gif;');

      const { limits } = await readExpressions(guild);
      assertSlot(emojiSlotState(limits, animated), animated ? 'emoji-animated' : 'emoji-static');

      const emoji = await guild.emojis.create({
        attachment: toBuffer(input.image),
        name: input.name,
        roles: input.roleIds,
        reason: input.reason ?? `Criado pelo painel por ${actor.user.tag}`,
      });
      return c.json(toEmojiSummary(emoji));
    })

    .patch('/emojis/:emojiId', validate('json', EmojiUpdateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      const emoji = await requireEmoji(guild, c.req.param('emojiId'));
      const edited = await emoji.edit({
        name: input.name,
        roles: input.roleIds,
        reason: input.reason ?? `Renomeado pelo painel por ${actor.user.tag}`,
      });
      return c.json(toEmojiSummary(edited));
    })

    .delete('/emojis/:emojiId', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      const emoji = await requireEmoji(guild, c.req.param('emojiId'));
      await emoji.delete(input.reason ?? `Apagado pelo painel por ${actor.user.tag}`);
      return c.json({ ok: true as const });
    })

    .post('/stickers', validate('json', StickerCreateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      const { limits } = await readExpressions(guild);
      assertSlot(stickerSlotState(limits), 'sticker');

      const sticker = await guild.stickers.create({
        file: toBuffer(input.image),
        name: input.name,
        tags: input.tags,
        description: input.description,
        reason: input.reason ?? `Criado pelo painel por ${actor.user.tag}`,
      });
      return c.json(toStickerSummary(sticker));
    })

    .patch('/stickers/:stickerId', validate('json', StickerUpdateInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      const sticker = await requireSticker(guild, c.req.param('stickerId'));
      const edited = await sticker.edit({
        name: input.name,
        tags: input.tags,
        description: input.description,
        reason: input.reason ?? `Renomeado pelo painel por ${actor.user.tag}`,
      });
      return c.json(toStickerSummary(edited));
    })

    .delete('/stickers/:stickerId', validate('json', ActorInputSchema), async (c) => {
      const input = c.req.valid('json');
      const guild = c.get('guild');
      const actor = await requireActor(deps, guild, input.actorId, 'admin');
      requireManage(guild);

      const sticker = await requireSticker(guild, c.req.param('stickerId'));
      await sticker.delete(input.reason ?? `Apagado pelo painel por ${actor.user.tag}`);
      return c.json({ ok: true as const });
    });
}
