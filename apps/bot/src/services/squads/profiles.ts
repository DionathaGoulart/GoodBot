import {
  getSquadGame,
  getSquadProfile,
  listSquadGames,
  listSquadsForUser,
  setSquadProfileStatus,
  upsertSquadProfile,
} from '@goodbot/db';
import {
  SquadProfileInputSchema,
  SquadProfileInputStatusSchema,
  UserFacingError,
  validateAnswers,
} from '@goodbot/shared';

import { firstIssue, log } from './context';
import { availabilityGridMessage, profileModal } from './forms';

import type { SquadContext } from './context';
import type { MatchResult } from './matcher';
import type { SquadGame, SquadProfile } from '@goodbot/db';
import type { SquadAnswers, SquadProfileStatus } from '@goodbot/shared';
import type { BaseMessageOptions, Guild, ModalBuilder } from 'discord.js';

export interface ProfileResult {
  profile: SquadProfile;
  /** Resultado do match disparado pelo `searching`; `null` quando não rodou ou falhou. */
  match: MatchResult | null;
}

export interface AvailabilityResult extends ProfileResult {
  game: SquadGame;
}

export interface ProfileDraft {
  game: SquadGame;
  /** `null` = a pessoa ainda não tem perfil neste jogo. */
  profile: SquadProfile | null;
}

/** O primeiro passo do perfil: modal quando o jogo tem campos, grade quando não tem. */
export type ProfileForm =
  { kind: 'modal'; modal: ModalBuilder } | { kind: 'grid'; message: BaseMessageOptions };

/** Perfil de jogador por jogo: grade, respostas e status. */
export class ProfileService {
  constructor(private readonly ctx: SquadContext) {}

  /** Jogos ligados da guild, por nome. Não exige o módulo ligado: é leitura de autocomplete. */
  async listGames(guildId: string): Promise<SquadGame[]> {
    return (await listSquadGames(this.ctx.db, guildId)).filter((game) => game.enabled);
  }

  /** O jogo e o perfil atual, para preencher os formulários. */
  async draft(guildId: string, userId: string, gameId: string): Promise<ProfileDraft> {
    await this.ctx.requireConfig(guildId);
    const game = await this.requireGame(guildId, gameId);
    const profile = await getSquadProfile(this.ctx.db, guildId, userId, gameId);
    return { game, profile };
  }

  async form(guildId: string, userId: string, gameId: string): Promise<ProfileForm> {
    const { game, profile } = await this.draft(guildId, userId, gameId);
    if (game.fields.length > 0) {
      return { kind: 'modal', modal: profileModal(game, profile?.answers ?? {}) };
    }
    return { kind: 'grid', message: await this.grid(guildId, userId, gameId, profile) };
  }

  /**
   * A grade de horários. Sem `mask`, parte da grade salva: é o que a pessoa
   * vê ao abrir o formulário; com `mask`, é a grade no meio da edição.
   */
  async grid(
    guildId: string,
    userId: string,
    gameId: string,
    current: SquadProfile | null | number,
  ): Promise<BaseMessageOptions> {
    const config = await this.ctx.requireConfig(guildId);
    const game = await this.requireGame(guildId, gameId);
    const mask =
      typeof current === 'number'
        ? current
        : (current ?? (await getSquadProfile(this.ctx.db, guildId, userId, gameId)))
            ?.availability ?? 0;
    return availabilityGridMessage({
      game,
      mask,
      blocks: config.blocks,
      embedColor: await this.ctx.embedColor(guildId),
    });
  }

  /**
   * Salva (ou sobrescreve) o perfil. Quem está num squad deste jogo continua
   * `in_squad` mesmo pedindo `searching`: é o bot quem tira esse status, ao
   * sair ou arquivar. Com `searching`, roda o match na hora.
   */
  async save(guild: Guild, userId: string, gameId: string, input: unknown): Promise<ProfileResult> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const game = await this.requireGame(guild.id, gameId);

    const parsed = SquadProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new UserFacingError(firstIssue(parsed.error.issues, 'Perfil inválido.'), {
        code: 'INVALID_PROFILE',
      });
    }
    const answers = this.checkAnswers(game, parsed.data.answers);

    const status: SquadProfileStatus = (await this.hasActiveSquad(guild.id, userId, gameId))
      ? 'in_squad'
      : parsed.data.status;
    const profile = await upsertSquadProfile(db, {
      guildId: guild.id,
      userId,
      gameId,
      availability: parsed.data.availability,
      answers,
      status,
    });

    const match = status === 'searching' ? await this.matchQuietly(guild.id, gameId) : null;
    return { profile, match };
  }

  /**
   * Primeiro passo do formulário: as respostas do modal. A grade fica como
   * estava e o status também; um perfil novo nasce pausado e sem horário,
   * porque só entra na busca quando a grade for salva.
   */
  async saveAnswers(
    guild: Guild,
    userId: string,
    gameId: string,
    answers: SquadAnswers,
  ): Promise<SquadProfile> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const game = await this.requireGame(guild.id, gameId);
    const checked = this.checkAnswers(game, answers);
    const current = await getSquadProfile(db, guild.id, userId, gameId);
    return upsertSquadProfile(db, {
      guildId: guild.id,
      userId,
      gameId,
      availability: current?.availability ?? 0,
      answers: checked,
      ...(current ? {} : { status: 'paused' as const }),
    });
  }

  /**
   * Último passo do formulário: a grade. Salvar a grade é o "quero procurar",
   * então o perfil volta para `searching` (ou fica `in_squad`) e o match roda.
   */
  async saveAvailability(
    guild: Guild,
    userId: string,
    gameId: string,
    availability: number,
  ): Promise<AvailabilityResult> {
    if (availability === 0) {
      throw new UserFacingError('Marque pelo menos um dia numa faixa antes de salvar.', {
        code: 'NO_AVAILABILITY',
      });
    }
    const { game, profile } = await this.draft(guild.id, userId, gameId);
    const result = await this.save(guild, userId, gameId, {
      availability,
      answers: profile?.answers ?? {},
      status: 'searching',
    });
    return { ...result, game };
  }

  /** Procurar ou pausar, com a mesma regra do `in_squad`. */
  async setStatus(
    guildId: string,
    userId: string,
    gameId: string,
    status: 'searching' | 'paused',
  ): Promise<ProfileResult> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guildId);

    const requested = SquadProfileInputStatusSchema.safeParse(status);
    if (!requested.success) {
      throw new UserFacingError('Status inválido.', { code: 'INVALID_STATUS' });
    }
    const profile = await getSquadProfile(db, guildId, userId, gameId);
    if (!profile) {
      throw new UserFacingError('Você ainda não tem perfil neste jogo. Monte o perfil primeiro.', {
        code: 'PROFILE_NOT_FOUND',
      });
    }
    if (requested.data === 'searching' && profile.availability === 0) {
      throw new UserFacingError(
        'Seu perfil ainda não tem horários. Marque os horários com /squad perfil.',
        { code: 'NO_AVAILABILITY' },
      );
    }

    const final: SquadProfileStatus = (await this.hasActiveSquad(guildId, userId, gameId))
      ? 'in_squad'
      : requested.data;
    const updated = (await setSquadProfileStatus(db, guildId, userId, gameId, final)) ?? profile;
    const match = final === 'searching' ? await this.matchQuietly(guildId, gameId) : null;
    return { profile: updated, match };
  }

  /**
   * Depois de sair ou arquivar: quem ficou sem squad deste jogo e ainda está
   * `in_squad` vira `paused`. Não volta sozinho para `searching`: ninguém quer
   * uma proposta nova no minuto em que saiu de um squad.
   */
  async refreshStatus(
    guildId: string,
    userId: string,
    gameId: string,
  ): Promise<SquadProfile | null> {
    const { db } = this.ctx;
    const profile = await getSquadProfile(db, guildId, userId, gameId);
    if (profile?.status !== 'in_squad') return profile;
    if (await this.hasActiveSquad(guildId, userId, gameId)) return profile;
    return (await setSquadProfileStatus(db, guildId, userId, gameId, 'paused')) ?? profile;
  }

  async markInSquad(guildId: string, userId: string, gameId: string): Promise<void> {
    await setSquadProfileStatus(this.ctx.db, guildId, userId, gameId, 'in_squad');
  }

  async requireGame(guildId: string, gameId: string): Promise<SquadGame> {
    const game = await getSquadGame(this.ctx.db, guildId, gameId);
    if (!game?.enabled) {
      throw new UserFacingError('Este jogo não está disponível para squads.', {
        code: 'GAME_NOT_FOUND',
      });
    }
    return game;
  }

  /** Respostas conferidas contra os campos do jogo; o erro diz qual campo. */
  private checkAnswers(game: SquadGame, answers: unknown): SquadAnswers {
    const checked = validateAnswers(game.fields, answers);
    if (checked.success) return checked.data;
    const issue = checked.error.issues[0];
    const label = game.fields.find((field) => field.key === issue?.path[0])?.label;
    const message = issue?.message ?? 'Respostas inválidas.';
    throw new UserFacingError(label ? `${label}: ${message}` : message, {
      code: 'INVALID_ANSWERS',
    });
  }

  private async hasActiveSquad(guildId: string, userId: string, gameId: string): Promise<boolean> {
    const squads = await listSquadsForUser(this.ctx.db, guildId, userId);
    return squads.some((squad) => squad.gameId === gameId);
  }

  /** O perfil já está salvo; um match que falha não pode virar erro para o jogador. */
  private async matchQuietly(guildId: string, gameId: string): Promise<MatchResult | null> {
    try {
      return await this.ctx.parts.matcher.runFor(guildId, gameId);
    } catch (error) {
      log.error({ err: error, guildId, gameId }, 'falha no match depois de salvar o perfil');
      return null;
    }
  }
}
