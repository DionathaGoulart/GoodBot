import {
  addSquadMember,
  archiveSquad,
  clearSquadWarned,
  countSquadsForUser,
  getSquad,
  getSquadGame,
  listSquadMembers,
  listSquads,
  removeSquadMember,
  renameSquad,
  setSquadStatus,
  setSquadTextChannel,
  setSquadVoiceChannel,
  touchSquadConfirmed,
} from '@goodbot/db';
import { SquadNameSchema, UserFacingError } from '@goodbot/shared';
import { ChannelType, OverwriteType } from 'discord.js';

import { discordErrorCode, firstIssue, log, logFailure, settleWithin } from './context';
import {
  archivedNoticeMessage,
  LEAVE_NOTICE,
  memberJoinedMessage,
  memberLeftMessage,
  RENAME_LATER_NOTE,
} from './embeds';
import { archivedTextOverwrites, SQUAD_MEMBER_TEXT_EDIT, squadTextOverwrites } from './overwrites';
import { renderSquadChannelName } from './slots';
import { currentOverwrites } from '../../lib/overwrites';

import type { SquadContext } from './context';
import type { Squad, SquadGame, SquadMember } from '@goodbot/db';
import type { AuditSource, SquadProfileStatus, SquadsConfig } from '@goodbot/shared';
import type { Guild, TextChannel } from 'discord.js';

/** Quanto o rename espera o Discord antes de responder "atualiza depois". */
export const RENAME_WAIT_MS = 4_000;

/** Códigos do Discord que um admin resolve; o resto sobe como erro comum. */
const DISCORD_MAX_CHANNELS = 30013;
const DISCORD_MISSING_PERMISSIONS = 50013;

export interface AddMemberOptions {
  source: AuditSource;
  /** Chama a pessoa na mensagem de "entrou": é assim que ela acha o canal. */
  ping: boolean;
  /** Quem aprovou a entrada (pedido); ausente = a própria pessoa. */
  actorId?: string;
}

export interface AddMemberResult {
  squad: Squad;
  /** `false` quando a pessoa já era membro. */
  joined: boolean;
}

export interface RemoveMemberResult {
  squad: Squad;
  archived: boolean;
  profileStatus: SquadProfileStatus | null;
  /** Frase para a resposta efêmera de quem saiu. */
  notice: string;
}

export interface RemoveMemberOptions {
  source?: AuditSource;
  actorId?: string;
  /** Painel: dispensa o módulo ligado, como `rename`. */
  force?: boolean;
  /** Quem tirou a pessoa pelo painel; o canal só fica sabendo que foi a staff. */
  removedBy?: string;
}

export interface ArchiveOptions {
  actorId?: string;
  reason: string | null;
  source?: AuditSource;
}

export interface RenameOptions {
  /** Painel ou moderação: dispensa ser membro e o módulo ligado. */
  force?: boolean;
  source?: AuditSource;
}

export interface RenameResult {
  squad: Squad;
  channelRenamed: boolean;
  /** Recado para quem renomeou; `null` quando não há o que avisar. */
  note: string | null;
}

function channelCreationError(error: unknown): unknown {
  switch (discordErrorCode(error)) {
    case DISCORD_MAX_CHANNELS:
      return new UserFacingError(
        'O servidor chegou ao limite de 500 canais. Peça a um admin para arquivar squads antigos.',
        { code: 'CHANNEL_LIMIT', cause: error },
      );
    case DISCORD_MISSING_PERMISSIONS:
      return new UserFacingError(
        'Não tenho permissão para criar o canal do squad na categoria configurada. Peça a um admin para revisar as permissões.',
        { code: 'MISSING_PERMISSIONS', cause: error },
      );
    default:
      return error;
  }
}

/** Ciclo de vida de um squad: casa nova, entrada, saída, arquivamento, nome. */
export class SquadLifecycleService {
  constructor(private readonly ctx: SquadContext) {}

  async assertCanJoinAnother(guildId: string, userId: string, config: SquadsConfig): Promise<void> {
    const count = await countSquadsForUser(this.ctx.db, guildId, userId);
    if (count < config.maxSquadsPerUser) return;
    throw new UserFacingError(
      config.maxSquadsPerUser === 1
        ? 'Você já está num squad. Saia dele antes de entrar em outro.'
        : `Você já está em ${String(count)} squads, o máximo neste servidor.`,
      { code: 'SQUAD_LIMIT' },
    );
  }

  async assertJoinable(
    guildId: string,
    squadId: string,
    game: Pick<SquadGame, 'squadSize'>,
  ): Promise<{ squad: Squad; members: SquadMember[] }> {
    const squad = await getSquad(this.ctx.db, guildId, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    const members = await listSquadMembers(this.ctx.db, guildId, squadId);
    if (members.length >= game.squadSize) {
      throw new UserFacingError('O squad já encheu.', { code: 'SQUAD_FULL' });
    }
    return { squad, members };
  }

  /**
   * Casa do squad recém-criado (depois do commit que reivindicou a proposta):
   * membro fundador, canal privado, voice preferido e o guia fixo, que chama
   * os membros. Sem canal o squad não tem casa, então falha ao criá-lo
   * arquiva a linha.
   */
  async setUpHome(
    guild: Guild,
    config: SquadsConfig,
    game: SquadGame,
    squad: Squad,
    creatorId: string,
  ): Promise<Squad> {
    const { db } = this.ctx;
    const guildId = guild.id;
    await addSquadMember(db, { guildId, squadId: squad.id, userId: creatorId });
    const initialIds = (await listSquadMembers(db, guildId, squad.id)).map(
      (member) => member.userId,
    );

    let channel: TextChannel;
    try {
      channel = await guild.channels.create({
        name: renderSquadChannelName(config.channelNaming, squad.name),
        type: ChannelType.GuildText,
        parent: config.categoryId,
        permissionOverwrites: squadTextOverwrites({
          everyoneId: guild.roles.everyone.id,
          botId: guild.members.me?.id ?? null,
          memberIds: initialIds,
        }),
        reason: `Squad ${squad.name}`,
      });
    } catch (error) {
      log.error(
        { err: error, guildId, squadId: squad.id },
        'não foi possível criar o canal do squad',
      );
      await archiveSquad(db, guildId, squad.id, this.ctx.date()).catch(() => null);
      throw channelCreationError(error);
    }

    let current = (await setSquadTextChannel(db, guildId, squad.id, channel.id)) ?? squad;
    // Quem perdeu a corrida do primeiro aceite entrou enquanto o canal nascia
    // e não achou canal para se dar acesso: quem cria concede.
    const memberIds = (await listSquadMembers(db, guildId, squad.id)).map(
      (member) => member.userId,
    );
    for (const id of memberIds) {
      if (!initialIds.includes(id)) await this.grantText(channel, id, squad.name);
    }

    const voiceId = await this.pickPreferredVoice(guild, config, current);
    if (voiceId) current = (await setSquadVoiceChannel(db, guildId, squad.id, voiceId)) ?? current;
    await this.ctx.parts.profiles.markInSquad(guildId, creatorId, game.id);

    await this.ctx.parts.guide.publish(guild, squad.id, { mentionMembers: true });

    this.ctx.record({
      guildId,
      action: 'squad.create',
      source: 'event',
      actor: creatorId,
      target: { type: 'squad', id: squad.id },
      after: {
        name: current.name,
        gameId: game.id,
        textChannelId: channel.id,
        voiceChannelId: current.voiceChannelId,
      },
    });
    this.ctx.record({
      guildId,
      action: 'squad.member.join',
      source: 'event',
      actor: creatorId,
      target: { type: 'member', id: creatorId },
      after: { squadId: squad.id, memberCount: memberIds.length },
    });
    return current;
  }

  /** Põe alguém num squad existente, respeitando o tamanho. Idempotente. */
  async addMember(
    guild: Guild,
    squadId: string,
    userId: string,
    options: AddMemberOptions,
  ): Promise<AddMemberResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const squad = await getSquad(db, guildId, squadId);
    const game = squad ? await getSquadGame(db, guildId, squad.gameId) : null;
    if (!squad || !game || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }

    const before = await listSquadMembers(db, guildId, squadId);
    if (before.some((member) => member.userId === userId)) return { squad, joined: false };
    if (before.length >= game.squadSize) {
      throw new UserFacingError('O squad já encheu.', { code: 'SQUAD_FULL' });
    }
    if (!(await addSquadMember(db, { guildId, squadId, userId }))) return { squad, joined: false };

    // Duas entradas ao mesmo tempo na última vaga passam as duas pela conta
    // acima; a ordem de chegada decide quem fica.
    const after = await listSquadMembers(db, guildId, squadId);
    if (after.findIndex((member) => member.userId === userId) >= game.squadSize) {
      await removeSquadMember(db, guildId, squadId, userId);
      throw new UserFacingError('O squad já encheu.', { code: 'SQUAD_FULL' });
    }

    // Relido depois do insert: se o canal ainda estava nascendo, quem o cria
    // concede o acesso (ver `setUpHome`).
    let current = (await getSquad(db, guildId, squadId)) ?? squad;
    const channel = await this.ctx.textChannel(guild, current);
    if (channel) await this.grantText(channel, userId, current.name);
    await this.ctx.parts.profiles.markInSquad(guildId, userId, squad.gameId);

    const memberCount = Math.min(after.length, game.squadSize);
    if (memberCount >= game.squadSize && current.status === 'open') {
      current = (await setSquadStatus(db, guildId, squadId, 'full')) ?? current;
    }

    if (channel) {
      await channel
        .send(
          memberJoinedMessage({
            userId,
            memberCount,
            squadSize: game.squadSize,
            embedColor: await this.ctx.embedColor(guildId),
            ping: options.ping,
          }),
        )
        .catch(logFailure('não foi possível avisar a entrada no squad', { guildId, squadId }));
    }
    await this.ctx.parts.guide.refresh(guild, squadId);

    this.ctx.record({
      guildId,
      action: 'squad.member.join',
      source: options.source,
      actor: options.actorId ?? userId,
      target: { type: 'member', id: userId },
      after: { squadId, memberCount },
    });
    return { squad: current, joined: true };
  }

  /**
   * Tira alguém do squad: overwrite, aviso no canal, vaga reaberta (`full`
   * → `open`) e, sem ninguém, arquivamento. O perfil de quem saiu fica
   * pausado; `notice` diz como voltar a procurar.
   */
  async removeMember(
    guild: Guild,
    squadId: string,
    userId: string,
    reason: string | null,
    options: RemoveMemberOptions = {},
  ): Promise<RemoveMemberResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    if (!options.force) await this.ctx.requireConfig(guildId);

    const squad = await getSquad(db, guildId, squadId);
    if (!squad) throw new UserFacingError('Squad não encontrado.', { code: 'SQUAD_NOT_FOUND' });
    if (!(await removeSquadMember(db, guildId, squadId, userId))) {
      throw new UserFacingError('Você não está neste squad.', { code: 'NOT_A_MEMBER' });
    }

    const source = options.source ?? 'event';
    const actorId = options.actorId ?? userId;
    const remaining = await listSquadMembers(db, guildId, squadId);
    const channel = await this.ctx.textChannel(guild, squad);
    if (channel) {
      await channel.permissionOverwrites
        .delete(userId, reason ?? 'Saiu do squad')
        .catch(
          logFailure('não foi possível tirar o acesso ao canal do squad', { guildId, squadId }),
        );
      if (remaining.length > 0 && squad.status !== 'archived') {
        const game = await getSquadGame(db, guildId, squad.gameId);
        await channel
          .send(
            memberLeftMessage({
              userId,
              memberCount: remaining.length,
              squadSize: game?.squadSize ?? remaining.length,
              embedColor: await this.ctx.embedColor(guildId),
              byStaff: options.removedBy !== undefined,
            }),
          )
          .catch(logFailure('não foi possível avisar a saída do squad', { guildId, squadId }));
      }
    }

    this.ctx.record({
      guildId,
      action: 'squad.member.leave',
      source,
      actor: actorId,
      target: { type: 'member', id: userId },
      reason,
      after: { squadId, memberCount: remaining.length },
    });

    let current = squad;
    let archived = squad.status === 'archived';
    if (!archived && remaining.length === 0) {
      current =
        (await this.archive(guild, squadId, {
          actorId,
          reason: 'O último membro saiu.',
          source,
        })) ?? squad;
      archived = true;
    } else if (squad.status === 'full') {
      current = (await setSquadStatus(db, guildId, squadId, 'open')) ?? squad;
    }
    if (!archived) await this.ctx.parts.guide.refresh(guild, squadId);

    const profile = await this.ctx.parts.profiles.refreshStatus(guildId, userId, squad.gameId);
    return {
      squad: current,
      archived,
      profileStatus: profile?.status ?? null,
      notice: profile?.status === 'paused' ? LEAVE_NOTICE : 'Você saiu do squad.',
    };
  }

  /**
   * Arquiva: canal só leitura com aviso, voice reservado liberado, pedidos
   * pendentes encerrados, propostas do squad fechadas e perfis sem squad
   * pausados. `null` quando já estava arquivado.
   */
  async archive(guild: Guild, squadId: string, options: ArchiveOptions): Promise<Squad | null> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const archived = await archiveSquad(db, guildId, squadId, this.ctx.date());
    if (!archived) return null;

    const memberIds = (await listSquadMembers(db, guildId, squadId)).map((member) => member.userId);
    const channel = await this.ctx.textChannel(guild, archived);
    if (channel) {
      await channel
        .send(
          archivedNoticeMessage({
            squad: archived,
            reason: options.reason,
            embedColor: await this.ctx.embedColor(guildId),
          }),
        )
        .catch(logFailure('não foi possível avisar o arquivamento', { guildId, squadId }));
      await channel.permissionOverwrites
        .set(
          archivedTextOverwrites(currentOverwrites(channel), memberIds),
          options.reason ?? 'Squad arquivado',
        )
        .catch(logFailure('não foi possível trancar o canal do squad', { guildId, squadId }));
    }

    await this.ctx.parts.sessions.releaseForSquad(guild, squadId);
    await this.ctx.parts.guide.refresh(guild, squadId);
    await this.ctx.parts.requests.expireForSquad(guild, archived);
    await this.ctx.parts.proposals.closeForSquad(guild, squadId);
    for (const id of memberIds) {
      await this.ctx.parts.profiles.refreshStatus(guildId, id, archived.gameId);
    }

    this.ctx.record({
      guildId,
      action: 'squad.archive',
      source: options.source ?? 'event',
      ...(options.actorId ? { actor: options.actorId } : {}),
      target: { type: 'squad', id: squadId },
      reason: options.reason,
      after: { name: archived.name, memberIds },
    });
    return archived;
  }

  /**
   * Renomeia no banco na hora; o canal vai junto quando o Discord deixa. O
   * limite de rename de canal é de dois a cada dez minutos, e o discord.js
   * espera a janela abrir: a resposta não segura esse tempo todo.
   */
  async rename(
    guild: Guild,
    squadId: string,
    name: string,
    actorId: string,
    options: RenameOptions = {},
  ): Promise<RenameResult> {
    const { db } = this.ctx;
    const guildId = guild.id;
    const config = options.force
      ? await this.ctx.config.get(guildId, 'squads')
      : await this.ctx.requireConfig(guildId);

    const parsed = SquadNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new UserFacingError(firstIssue(parsed.error.issues, 'Nome inválido.'), {
        code: 'INVALID_NAME',
      });
    }
    const squad = await getSquad(db, guildId, squadId);
    if (!squad) throw new UserFacingError('Squad não encontrado.', { code: 'SQUAD_NOT_FOUND' });
    if (squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    if (!options.force) await this.assertMember(guildId, squadId, actorId, 'mudar o nome');

    const renamed = (await renameSquad(db, guildId, squadId, parsed.data)) ?? squad;
    this.ctx.record({
      guildId,
      action: 'squad.rename',
      source: options.source ?? 'event',
      actor: actorId,
      target: { type: 'squad', id: squadId },
      before: { name: squad.name },
      after: { name: renamed.name },
    });
    await this.ctx.parts.guide.refresh(guild, squadId);

    const channel = await this.ctx.textChannel(guild, renamed);
    if (!channel) return { squad: renamed, channelRenamed: false, note: null };
    const target = renderSquadChannelName(config.channelNaming, renamed.name);
    if (channel.name === target) return { squad: renamed, channelRenamed: true, note: null };

    const applied = await settleWithin(
      channel.setName(target, 'Squad renomeado'),
      RENAME_WAIT_MS,
      logFailure('não foi possível renomear o canal do squad', { guildId, squadId }),
    );
    return { squad: renamed, channelRenamed: applied, note: applied ? null : RENAME_LATER_NOTE };
  }

  /** "Ainda jogamos": zera o relógio da inatividade e o aviso. */
  async keepAlive(guild: Guild, squadId: string, userId: string): Promise<Squad> {
    const { db } = this.ctx;
    await this.ctx.requireConfig(guild.id);
    const squad = await getSquad(db, guild.id, squadId);
    if (!squad || squad.status === 'archived') {
      throw new UserFacingError('Este squad foi encerrado.', { code: 'SQUAD_ARCHIVED' });
    }
    await this.assertMember(guild.id, squadId, userId, 'confirmar');
    await touchSquadConfirmed(db, guild.id, squadId, this.ctx.date());
    return (await clearSquadWarned(db, guild.id, squadId)) ?? squad;
  }

  async assertMember(
    guildId: string,
    squadId: string,
    userId: string,
    action: string,
  ): Promise<void> {
    const members = await listSquadMembers(this.ctx.db, guildId, squadId);
    if (!members.some((member) => member.userId === userId)) {
      throw new UserFacingError(`Só quem é do squad pode ${action}.`, { code: 'NOT_A_MEMBER' });
    }
  }

  /**
   * O primeiro voice do pool que nenhum outro squad vivo prefere. `null` =
   * pool cheio: o squad fica sem sala preferida e a jogatina reserva qualquer
   * voice livre.
   */
  private async pickPreferredVoice(
    guild: Guild,
    config: SquadsConfig,
    squad: Squad,
  ): Promise<string | null> {
    if (config.voicePoolIds.length === 0) return null;
    const alive = await listSquads(this.ctx.db, guild.id, { statuses: ['open', 'full'] });
    const taken = new Set(
      alive
        .filter((other) => other.id !== squad.id)
        .flatMap((other) => (other.voiceChannelId ? [other.voiceChannelId] : [])),
    );
    return (
      config.voicePoolIds.find(
        (id) => !taken.has(id) && guild.channels.cache.get(id)?.type === ChannelType.GuildVoice,
      ) ?? null
    );
  }

  private async grantText(channel: TextChannel, userId: string, squadName: string): Promise<void> {
    await channel.permissionOverwrites
      .edit(userId, SQUAD_MEMBER_TEXT_EDIT, {
        type: OverwriteType.Member,
        reason: `Entrou no squad ${squadName}`,
      })
      .catch(
        logFailure('não foi possível dar acesso ao canal do squad', {
          channelId: channel.id,
          userId,
        }),
      );
  }
}
