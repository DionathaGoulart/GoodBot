import {
  getSquadGame,
  getSquadProfile,
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

import type { SquadContext } from './context';
import type { MatchResult } from './matcher';
import type { SquadProfile } from '@goodbot/db';
import type { SquadProfileStatus } from '@goodbot/shared';
import type { Guild } from 'discord.js';

export interface ProfileResult {
  profile: SquadProfile;
  /** Resultado do match disparado pelo `searching`; `null` quando não rodou ou falhou. */
  match: MatchResult | null;
}

/** Perfil de jogador por jogo: grade, respostas e status. */
export class ProfileService {
  constructor(private readonly ctx: SquadContext) {}

  /**
   * Salva (ou sobrescreve) o perfil. Quem está num squad deste jogo continua
   * `in_squad` mesmo pedindo `searching`: é o bot quem tira esse status, ao
   * sair ou arquivar. Com `searching`, roda o match na hora.
   */
  async save(guild: Guild, userId: string, gameId: string, input: unknown): Promise<ProfileResult> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);

    const game = await getSquadGame(db, guild.id, gameId);
    if (!game?.enabled) {
      throw new UserFacingError('Este jogo não está disponível para squads.', {
        code: 'GAME_NOT_FOUND',
      });
    }

    const parsed = SquadProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new UserFacingError(firstIssue(parsed.error.issues, 'Perfil inválido.'), {
        code: 'INVALID_PROFILE',
      });
    }

    const answers = validateAnswers(game.fields, parsed.data.answers);
    if (!answers.success) {
      const issue = answers.error.issues[0];
      const label = game.fields.find((field) => field.key === issue?.path[0])?.label;
      const message = issue?.message ?? 'Respostas inválidas.';
      throw new UserFacingError(label ? `${label}: ${message}` : message, {
        code: 'INVALID_ANSWERS',
      });
    }

    const status: SquadProfileStatus = (await this.hasActiveSquad(guild.id, userId, gameId))
      ? 'in_squad'
      : parsed.data.status;
    const profile = await upsertSquadProfile(db, {
      guildId: guild.id,
      userId,
      gameId,
      availability: parsed.data.availability,
      answers: answers.data,
      status,
    });

    const match = status === 'searching' ? await this.matchQuietly(guild.id, gameId) : null;
    return { profile, match };
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
