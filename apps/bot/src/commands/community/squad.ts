import { MAX_NAME_LENGTH, UserFacingError } from '@goodbot/shared';
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { openProfileForm } from '../../interactions/squads';
import { defineCommand } from '../../lib/command';
import { botFooter, successEmbed } from '../../lib/embeds';
import { levelAtLeast } from '../../services/permissions';
import {
  inviteSentText,
  joinableSquadsMessage,
  playerStatsMessage,
  renamedText,
  searchMessagePublishedText,
  statusChangedText,
} from '../../services/squads/embeds';

import type { AutocompleteContext, CommandContext } from '../../lib/command';
import type { Squad, SquadGame } from '@goodbot/db';
import type { Guild } from 'discord.js';

/** Teto do Discord para as sugestões de um autocomplete. */
const MAX_CHOICES = 25;
/** Teto do Discord para o nome de uma sugestão. */
const MAX_CHOICE_NAME = 100;

const STATUS_VALUES = ['searching', 'paused'] as const;
type StatusValue = (typeof STATUS_VALUES)[number];

/**
 * O jogo da opção `jogo` (id vindo do autocomplete ou o nome digitado) ou,
 * sem a opção, o único jogo do servidor.
 */
export function pickGame(games: readonly SquadGame[], option: string | null): SquadGame {
  const typed = option?.trim();
  if (typed) {
    const needle = typed.toLowerCase();
    const found = games.find((game) => game.id === typed || game.name.toLowerCase() === needle);
    if (!found) {
      throw new UserFacingError('Jogo não encontrado. Escolha um da lista.', {
        code: 'GAME_NOT_FOUND',
      });
    }
    return found;
  }
  const [only, ...rest] = games;
  if (!only) {
    throw new UserFacingError(
      'Nenhum jogo cadastrado para squads ainda. Peça a um admin para cadastrar no painel.',
      { code: 'SQUADS_NO_GAMES' },
    );
  }
  if (rest.length > 0) {
    throw new UserFacingError('Este servidor tem mais de um jogo. Escolha qual na opção jogo.', {
      code: 'CHOOSE_GAME',
    });
  }
  return only;
}

/**
 * O squad da opção `squad`; sem ela, o do canal onde o comando rodou e, por
 * fim, o único squad da pessoa.
 */
export function pickSquad(
  squads: readonly Squad[],
  option: string | null,
  channelId: string | null,
): Squad {
  const typed = option?.trim();
  if (typed) {
    const needle = typed.toLowerCase();
    const found = squads.find(
      (squad) => squad.id === typed || squad.name.toLowerCase() === needle,
    );
    if (!found) {
      throw new UserFacingError('Você não está nesse squad.', { code: 'NOT_A_MEMBER' });
    }
    return found;
  }
  const here = channelId ? squads.find((squad) => squad.textChannelId === channelId) : undefined;
  if (here) return here;
  const [only, ...rest] = squads;
  if (!only) {
    throw new UserFacingError('Você não está em nenhum squad.', { code: 'NO_SQUAD' });
  }
  if (rest.length > 0) {
    throw new UserFacingError('Você está em mais de um squad. Escolha qual na opção squad.', {
      code: 'CHOOSE_SQUAD',
    });
  }
  return only;
}

/**
 * O jogo dos números: o da opção, o do squad de cujo canal o comando saiu (é
 * de longe o caso mais comum, e evita escolher jogo num servidor com vários)
 * e, por fim, o único jogo do servidor.
 */
export function pickStatsGame(
  games: readonly SquadGame[],
  squads: readonly Squad[],
  option: string | null,
  channelId: string | null,
): SquadGame {
  if (!option?.trim() && channelId) {
    const here = squads.find((squad) => squad.textChannelId === channelId);
    const game = here ? games.find((candidate) => candidate.id === here.gameId) : undefined;
    if (game) return game;
  }
  return pickGame(games, option);
}

function requireGuild(ctx: CommandContext): Guild {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserFacingError('Comando só disponível no servidor.', { code: 'NO_GUILD' });
  return guild;
}

function isStatus(value: string): value is StatusValue {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('squad')
    .setDescription('Squads fixos: seu perfil, a busca e o seu squad')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand((sub) =>
      sub
        .setName('perfil')
        .setDescription('Monta ou edita seu perfil de jogador')
        .addStringOption((option) =>
          option.setName('jogo').setDescription('Jogo do perfil').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Procura squad ou pausa a busca')
        .addStringOption((option) =>
          option
            .setName('status')
            .setDescription('Procurar ou pausar')
            .setRequired(true)
            .addChoices(
              { name: 'procurando', value: 'searching' },
              { name: 'pausado', value: 'paused' },
            ),
        )
        .addStringOption((option) =>
          option.setName('jogo').setDescription('Jogo do perfil').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('sair')
        .setDescription('Sai do seu squad')
        .addStringOption((option) =>
          option.setName('squad').setDescription('De qual squad sair').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('renomear')
        .setDescription('Muda o nome do seu squad')
        .addStringOption((option) =>
          option
            .setName('nome')
            .setDescription('Nome novo')
            .setMaxLength(MAX_NAME_LENGTH)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('squad').setDescription('Qual squad renomear').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('convidar')
        .setDescription('Chama alguém para o seu squad, sem votação')
        .addUserOption((option) =>
          option.setName('pessoa').setDescription('Quem convidar').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('squad').setDescription('Para qual squad').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('procurar')
        .setDescription('Lista squads com vaga que combinam com você')
        .addStringOption((option) =>
          option.setName('jogo').setDescription('Jogo dos squads').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Quanto você joga, em que formações e com quem')
        .addUserOption((option) =>
          option.setName('pessoa').setDescription('De quem são os números (padrão: você)'),
        )
        .addStringOption((option) =>
          option.setName('jogo').setDescription('Jogo dos números').setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('painel')
        .setDescription('Publica a mensagem fixa de busca (administração)')
        .addChannelOption((option) =>
          option
            .setName('canal')
            .setDescription('Publicar em outro canal de busca')
            .addChannelTypes(ChannelType.GuildText),
        ),
    ),
  module: 'squads',
  level: 'member',
  cooldown: 3,
  ephemeral: true,
  // `/squad perfil` responde com modal; as outras adiam por conta própria.
  opensModal: true,
  help: 'Perfil de jogador, busca por squad fixo e gestão do seu squad.',
  async autocomplete(ctx: AutocompleteContext) {
    const focused = ctx.interaction.options.getFocused(true);
    const needle = focused.value.toLowerCase();
    const items =
      focused.name === 'squad'
        ? await ctx.squads.listSquadsForUser(ctx.guildId, ctx.interaction.user.id)
        : await ctx.squads.listGames(ctx.guildId);
    await ctx.interaction.respond(
      items
        .filter((item) => item.name.toLowerCase().includes(needle))
        .slice(0, MAX_CHOICES)
        .map((item) => ({ name: item.name.slice(0, MAX_CHOICE_NAME), value: item.id })),
    );
  },
  async execute(ctx) {
    const sub = ctx.interaction.options.getSubcommand();
    const guild = requireGuild(ctx);

    if (sub === 'perfil') {
      await ctx.squads.requireConfig(ctx.guildId);
      const game = pickGame(
        await ctx.squads.listGames(ctx.guildId),
        ctx.interaction.options.getString('jogo'),
      );
      await openProfileForm(ctx, ctx.interaction, game.id);
      return;
    }

    await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await ctx.squads.requireConfig(ctx.guildId);

    switch (sub) {
      case 'status': {
        const status = ctx.interaction.options.getString('status', true);
        if (!isStatus(status)) {
          throw new UserFacingError('Status inválido.', { code: 'INVALID_STATUS' });
        }
        const game = pickGame(
          await ctx.squads.listGames(ctx.guildId),
          ctx.interaction.options.getString('jogo'),
        );
        const { profile } = await ctx.squads.setProfileStatus(
          ctx.guildId,
          ctx.member.id,
          game.id,
          status,
        );
        await ctx.interaction.editReply({ content: statusChangedText(profile.status) });
        return;
      }

      case 'sair': {
        const squad = pickSquad(
          await ctx.squads.listSquadsForUser(ctx.guildId, ctx.member.id),
          ctx.interaction.options.getString('squad'),
          ctx.interaction.channelId,
        );
        const result = await ctx.squads.removeMember(guild, squad.id, ctx.member.id, null, {
          source: 'command',
        });
        await ctx.interaction.editReply({ content: result.notice });
        return;
      }

      case 'renomear': {
        const squad = pickSquad(
          await ctx.squads.listSquadsForUser(ctx.guildId, ctx.member.id),
          ctx.interaction.options.getString('squad'),
          ctx.interaction.channelId,
        );
        const result = await ctx.squads.rename(
          guild,
          squad.id,
          ctx.interaction.options.getString('nome', true),
          ctx.member.id,
          { source: 'command' },
        );
        await ctx.interaction.editReply({ content: renamedText(result) });
        return;
      }

      case 'convidar': {
        const squad = pickSquad(
          await ctx.squads.listSquadsForUser(ctx.guildId, ctx.member.id),
          ctx.interaction.options.getString('squad'),
          ctx.interaction.channelId,
        );
        const target = ctx.interaction.options.getUser('pessoa', true);
        const sent = await ctx.squads.inviteToSquad(
          guild,
          squad.id,
          ctx.member.id,
          { id: target.id, bot: target.bot },
          'command',
        );
        await ctx.interaction.editReply({
          content: inviteSentText(target.id, sent.squad),
          allowedMentions: { parse: [] },
        });
        return;
      }

      case 'procurar': {
        const game = pickGame(
          await ctx.squads.listGames(ctx.guildId),
          ctx.interaction.options.getString('jogo'),
        );
        const entries = await ctx.squads.listJoinableSquads(ctx.guildId, ctx.member.id, game.id);
        await ctx.interaction.editReply(
          joinableSquadsMessage({ game, entries, embedColor: ctx.settings.embedColor }),
        );
        return;
      }

      case 'stats': {
        const game = pickStatsGame(
          await ctx.squads.listGames(ctx.guildId),
          await ctx.squads.listSquadsForUser(ctx.guildId, ctx.member.id),
          ctx.interaction.options.getString('jogo'),
          ctx.interaction.channelId,
        );
        const target = ctx.interaction.options.getUser('pessoa') ?? ctx.interaction.user;
        await ctx.interaction.editReply(
          playerStatsMessage(await ctx.squads.playerStats(ctx.guildId, game.id, target.id)),
        );
        return;
      }

      case 'painel': {
        if (!levelAtLeast(ctx.level, 'admin')) {
          throw new UserFacingError('Só a administração publica a mensagem de busca.', {
            code: 'FORBIDDEN',
          });
        }
        const channel = ctx.interaction.options.getChannel('canal');
        const published = await ctx.squads.publishSearchMessage(guild, ctx.member.id, {
          ...(channel ? { channelId: channel.id } : {}),
          source: 'command',
        });
        await ctx.interaction.editReply({
          embeds: [
            successEmbed({
              title: 'Mensagem publicada',
              description: searchMessagePublishedText(published.channelId),
              footer: botFooter('SQUADS'),
            }),
          ],
        });
        return;
      }

      default:
        throw new UserFacingError('Subcomando desconhecido.', { code: 'UNKNOWN_SUBCOMMAND' });
    }
  },
});
