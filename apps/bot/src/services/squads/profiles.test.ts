import { toBits } from '@goodbot/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { A, createHarness } from './__fixtures__/harness';

const fixtures = await vi.hoisted(async () => import('./__fixtures__/fake-db'));
vi.mock('@goodbot/db', () => fixtures.repositories);

const { store, seedGame, seedMember, seedSquad, GUILD_ID } = fixtures;

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

  it('as respostas do modal criam o perfil pausado e sem horário', async () => {
    const h = createHarness();
    const game = seedGame();

    const profile = await h.service.saveAnswers(h.discordGuild, A, game.id, { platform: 'PS5' });

    expect(profile).toMatchObject({ status: 'paused', availability: 0, answers: { platform: 'PS5' } });
    expect(h.search.threads.create).not.toHaveBeenCalled();
  });

  it('editar as respostas mantém a grade e o status', async () => {
    const h = createHarness();
    const game = seedGame();
    fixtures.seedProfile({ userId: A, gameId: game.id, availability, status: 'searching' });

    const profile = await h.service.saveAnswers(h.discordGuild, A, game.id, { platform: 'PS5' });

    expect(profile).toMatchObject({ status: 'searching', availability, answers: { platform: 'PS5' } });
  });

  it('salvar a grade põe o perfil na busca com as respostas já gravadas', async () => {
    const h = createHarness();
    const game = seedGame();
    await h.service.saveAnswers(h.discordGuild, A, game.id, { platform: 'PC' });

    const result = await h.service.saveAvailability(h.discordGuild, A, game.id, availability);

    expect(result.profile).toMatchObject({
      status: 'searching',
      availability,
      answers: { platform: 'PC' },
    });
    expect(result.game.id).toBe(game.id);
    expect(result.match).toEqual({ proposals: 0, joinRequests: 0 });
  });

  it('grade vazia não salva', async () => {
    const h = createHarness();
    const game = seedGame();

    await expect(h.service.saveAvailability(h.discordGuild, A, game.id, 0)).rejects.toMatchObject({
      code: 'NO_AVAILABILITY',
    });
    expect(store.profiles).toHaveLength(0);
  });

  it('o formulário abre o modal quando o jogo tem campos e a grade quando não tem', async () => {
    const h = createHarness();
    const withFields = seedGame();
    const withoutFields = seedGame({ name: 'Sem campos', fields: [] });
    fixtures.seedProfile({ userId: A, gameId: withoutFields.id, availability, answers: {} });

    expect((await h.service.profileForm(GUILD_ID, A, withFields.id)).kind).toBe('modal');
    const form = await h.service.profileForm(GUILD_ID, A, withoutFields.id);
    expect(form.kind).toBe('grid');
  });

  it('não volta a procurar sem horário salvo', async () => {
    const h = createHarness();
    const game = seedGame();
    await h.service.saveAnswers(h.discordGuild, A, game.id, { platform: 'PC' });

    await expect(h.service.setProfileStatus(GUILD_ID, A, game.id, 'searching')).rejects.toMatchObject(
      { code: 'NO_AVAILABILITY' },
    );
    expect(store.profiles[0]?.status).toBe('paused');
  });
});
