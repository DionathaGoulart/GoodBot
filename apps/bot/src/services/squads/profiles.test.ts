import { toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { A, createHarness } from './__fixtures__/harness';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSquad } = fixtures;

const availability = toBits([{ day: 6, block: 2 }]);

describe('SquadService: perfis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recusa resposta fora das opções dizendo qual campo', async () => {
    const h = createHarness();
    const game = seedGame();

    await expect(
      h.service.saveProfile(h.discordGuild, A, game.id, {
        availability,
        answers: { platform: 'Xbox' },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_ANSWERS',
      message: 'Plataforma: Escolha uma das opções do campo.',
    });
    expect(store.profiles).toHaveLength(0);
  });

  it('quem já está num squad do jogo continua in_squad e não dispara match', async () => {
    const h = createHarness();
    const game = seedGame();
    const squad = seedSquad({ gameId: game.id });
    seedMember(squad.id, A);

    const result = await h.service.saveProfile(h.discordGuild, A, game.id, {
      availability,
      answers: { platform: 'PC' },
      status: 'searching',
    });

    expect(result.profile.status).toBe('in_squad');
    expect(result.match).toBeNull();
    expect(h.search.threads.create).not.toHaveBeenCalled();
  });

  it('salvar procurando roda o match e um erro nele não chega ao jogador', async () => {
    const h = createHarness();
    const game = seedGame();
    h.search.threads.create.mockRejectedValueOnce(new Error('discord fora'));
    const other = '300000000000000009';
    fixtures.seedProfile({ userId: other, gameId: game.id, availability });

    const result = await h.service.saveProfile(h.discordGuild, A, game.id, {
      availability,
      answers: { platform: 'PC' },
    });

    expect(result.profile.status).toBe('searching');
    expect(result.match).toEqual({ proposals: 0, joinRequests: 0 });
  });

  it('jogo desligado não aceita perfil', async () => {
    const h = createHarness();
    const game = seedGame({ enabled: false });

    await expect(
      h.service.saveProfile(h.discordGuild, A, game.id, { availability, answers: {} }),
    ).rejects.toMatchObject({ code: 'GAME_NOT_FOUND' });
  });
});
