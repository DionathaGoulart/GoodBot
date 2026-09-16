import {
  getSquad,
  getSquadGame,
  listSquadMembers,
  listSquads,
  listUpcomingSessions,
  setSquadGuideMessage,
} from '@goodbot/db';
import { PermissionFlagsBits } from 'discord.js';

import { discordErrorCode, log, logFailure } from './context';
import { guideMessage } from './embeds';

import type { SquadContext } from './context';
import type { Squad } from '@goodbot/db';
import type { BaseMessageOptions, Guild, Message, TextChannel } from 'discord.js';

/** `DiscordAPIError` de mensagem inexistente: alguém apagou o guia. */
const DISCORD_UNKNOWN_MESSAGE = 10008;

export interface PublishGuideOptions {
  /** Só na criação do squad: é o aviso de que o canal existe. */
  mentionMembers: boolean;
}

/**
 * O guia fixo de cada squad: a primeira mensagem do canal, pinada, com quem
 * está, as próximas jogatinas e os botões do squad. Toda mudança que ele
 * mostra chama `refresh`, que reedita (ou publica de novo, se sumiu). Nada
 * aqui lança: o guia é consequência do que aconteceu, não condição.
 */
export class GuideService {
  constructor(private readonly ctx: SquadContext) {}

  async render(guildId: string, squad: Squad, options: PublishGuideOptions): Promise<BaseMessageOptions> {
    const { db } = this.ctx;
    const [config, embedColor, game, members, upcoming] = await Promise.all([
      this.ctx.config.get(guildId, 'squads'),
      this.ctx.embedColor(guildId),
      getSquadGame(db, guildId, squad.gameId),
      listSquadMembers(db, guildId, squad.id),
      listUpcomingSessions(db, guildId, this.ctx.date(), { squadIds: [squad.id] }),
    ]);
    return guideMessage({
      squad,
      game: game ?? { id: squad.gameId, name: 'o jogo', squadSize: members.length },
      memberIds: members.map((member) => member.userId),
      upcoming,
      canJoinAnother: config.maxSquadsPerUser > 1,
      embedColor,
      mentionMembers: options.mentionMembers,
    });
  }

  /**
   * Publica o guia de um squad que ainda não tem. Grava o id só se ninguém
   * gravou antes: quem perde a corrida apaga a própria mensagem. `null`
   * quando não há canal ou o Discord recusou.
   */
  async publish(guild: Guild, squadId: string, options: PublishGuideOptions): Promise<string | null> {
    const bindings = { guildId: guild.id, squadId };
    try {
      const squad = await getSquad(this.ctx.db, guild.id, squadId);
      if (!squad || squad.status === 'archived') return null;
      // Alguém entrou enquanto o canal nascia e o guia já saiu por essa entrada.
      if (squad.guideMessageId) return await this.refresh(guild, squad.id);
      const channel = await this.ctx.textChannel(guild, squad);
      if (!channel) return null;
      return await this.send(guild, channel, squad, options);
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao publicar o guia do squad');
      return null;
    }
  }

  /**
   * Reedita o guia; publica de novo se a mensagem foi apagada. Squad
   * arquivado ganha a versão sem botões, mas guia novo não nasce num canal
   * arquivado. Falha passageira do Discord não republica: dois guias no
   * canal são piores que um guia desatualizado até a próxima mudança.
   */
  async refresh(guild: Guild, squadId: string): Promise<string | null> {
    const bindings = { guildId: guild.id, squadId };
    try {
      const squad = await getSquad(this.ctx.db, guild.id, squadId);
      if (!squad) return null;
      const channel = await this.ctx.textChannel(guild, squad);
      if (!channel) return null;

      if (squad.guideMessageId) {
        const message = await this.fetchGuide(channel, squad.guideMessageId);
        if (message === 'retry') return null;
        if (message) {
          await message.edit(await this.render(guild.id, squad, { mentionMembers: false }));
          return message.id;
        }
      }
      if (squad.status === 'archived') return null;
      return await this.send(guild, channel, squad, { mentionMembers: false });
    } catch (error) {
      log.warn({ err: error, ...bindings }, 'falha ao atualizar o guia do squad');
      return null;
    }
  }

  /**
   * Passo diário: todo squad vivo com o guia em dia. Cobre os squads que
   * nasceram antes do guia e o que ficou velho sem nenhuma mudança (uma
   * jogatina que já acabou ainda listada). Devolve quantos guias estão no ar.
   */
  async syncAll(guild: Guild): Promise<number> {
    const squads = await listSquads(this.ctx.db, guild.id, { statuses: ['open', 'full'] });
    let synced = 0;
    for (const squad of squads) {
      if (await this.refresh(guild, squad.id)) synced++;
    }
    return synced;
  }

  private async send(
    guild: Guild,
    channel: TextChannel,
    squad: Squad,
    options: PublishGuideOptions,
  ): Promise<string | null> {
    const message = await channel.send(await this.render(guild.id, squad, options));
    const saved = await setSquadGuideMessage(
      this.ctx.db,
      guild.id,
      squad.id,
      message.id,
      squad.guideMessageId,
    );
    if (!saved) {
      await message.delete().catch(() => null);
      return (await getSquad(this.ctx.db, guild.id, squad.id))?.guideMessageId ?? null;
    }
    await this.pin(guild, channel, message);
    return message.id;
  }

  /**
   * Fixar exige `PinMessages` no canal. O convite antigo não pedia: sem ela o
   * guia fica no ar sem pin e o log avisa, como o resto do módulo faz.
   */
  private async pin(guild: Guild, channel: TextChannel, message: Message): Promise<void> {
    const me = guild.members.me;
    const permissions = me ? channel.permissionsFor(me) : null;
    const bindings = { guildId: guild.id, channelId: channel.id };
    if (!permissions?.has(PermissionFlagsBits.PinMessages)) {
      log.warn(bindings, 'guia do squad sem pin: falta PinMessages no canal');
      return;
    }
    await message.pin('Guia do squad').catch(logFailure('não foi possível fixar o guia', bindings));
  }

  /** A mensagem do guia; `null` quando foi apagada, `'retry'` quando o Discord falhou. */
  private async fetchGuide(channel: TextChannel, messageId: string): Promise<Message | null | 'retry'> {
    try {
      return await channel.messages.fetch(messageId);
    } catch (error) {
      if (discordErrorCode(error) === DISCORD_UNKNOWN_MESSAGE) return null;
      log.warn(
        { err: error, channelId: channel.id, messageId },
        'não foi possível buscar o guia do squad',
      );
      return 'retry';
    }
  }
}
