import { describe, expect, it } from 'vitest';

import { BotProfileInputSchema, MAX_BOT_BIO_LENGTH, MAX_BOT_NICK_LENGTH } from './bot-profile';

const ACTOR = '100000000000000001';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('BotProfileInputSchema', () => {
  it('apelido vazio vira `null` — é assim que o bot volta ao nome global', () => {
    const parsed = BotProfileInputSchema.parse({ actorId: ACTOR, nick: '   ' });
    expect(parsed.nick).toBeNull();
  });

  it('bio vazia vira `null`, e a que passa do teto é recusada', () => {
    expect(BotProfileInputSchema.parse({ actorId: ACTOR, nick: 'Bot', bio: '  ' }).bio).toBeNull();
    expect(
      BotProfileInputSchema.safeParse({
        actorId: ACTOR,
        nick: 'Bot',
        bio: 'a'.repeat(MAX_BOT_BIO_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('recusa apelido maior que o teto do Discord', () => {
    const nick = 'a'.repeat(MAX_BOT_NICK_LENGTH + 1);
    expect(BotProfileInputSchema.safeParse({ actorId: ACTOR, nick }).success).toBe(false);
  });

  it('guarda os três estados da imagem: ausente, `null` e data URL', () => {
    const intocado = BotProfileInputSchema.parse({ actorId: ACTOR, nick: 'Bot' });
    expect(intocado).not.toHaveProperty('avatar');

    const removido = BotProfileInputSchema.parse({ actorId: ACTOR, nick: 'Bot', avatar: null });
    expect(removido.avatar).toBeNull();

    const trocado = BotProfileInputSchema.parse({ actorId: ACTOR, nick: 'Bot', banner: PNG });
    expect(trocado.banner).toBe(PNG);
  });

  it('recusa imagem que não é data URL de imagem', () => {
    const parsed = BotProfileInputSchema.safeParse({
      actorId: ACTOR,
      nick: 'Bot',
      avatar: 'https://cdn.example/foto.png',
    });
    expect(parsed.success).toBe(false);
  });

  it('exige `actorId`: o Bearer prova o painel, não quem clicou', () => {
    expect(BotProfileInputSchema.safeParse({ nick: 'Bot' }).success).toBe(false);
  });
});
