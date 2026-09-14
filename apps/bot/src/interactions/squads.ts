import { UserFacingError } from '@goodbot/shared';
import { MessageFlags } from 'discord.js';

import { CooldownStore } from '../lib/cooldown';
import {
  joinRequestDecisionText,
  joinRequestSentText,
  KEEP_ALIVE_TEXT,
  leaveConfirmMessage,
  profileSavedMessage,
  proposalAcceptedText,
  proposalDeclinedText,
  voteText,
} from '../services/squads/embeds';
import {
  modalAnswerReader,
  parseGridDays,
  readProfileAnswers,
  setBlockDays,
} from '../services/squads/forms';
import { parseSquadCustomId } from '../services/squads/ids';

import type { BotContext } from '../lib/command';
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

/** Segundos entre dois "Salvar horários" da mesma pessoa: cada um roda o match. */
export const PROFILE_SAVE_COOLDOWN_SECONDS = 5;

const saveCooldowns = new CooldownStore();

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

function requireGuild(interaction: { guild: Guild | null }): Guild {
  if (!interaction.guild) {
    throw new UserFacingError('Não consegui identificar o servidor. Tente de novo.', {
      code: 'NO_GUILD',
    });
  }
  return interaction.guild;
}

/**
 * Abre o perfil de um jogo: o modal com os campos ou, quando o jogo não tem
 * campos, direto a grade. Nada de `deferReply` antes: o modal exige a
 * interação intacta.
 */
export async function openProfileForm(
  ctx: BotContext,
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  gameId: string,
): Promise<void> {
  const guild = requireGuild(interaction);
  const form = await ctx.squads.profileForm(guild.id, interaction.user.id, gameId);
  if (form.kind === 'modal') {
    await interaction.showModal(form.modal);
    return;
  }
  await interaction.reply({ ...form.message, ...EPHEMERAL });
}

/**
 * Todo componente com prefixo `squad`. As mensagens são persistentes (a
 * fixa, as propostas, os lembretes) e a grade não guarda estado: tudo o que
 * o handler precisa vem do `custom_id` e do banco.
 */
export async function handleSquadComponent(
  ctx: BotContext,
  interaction: MessageComponentInteraction,
): Promise<boolean> {
  const parsed = parseSquadCustomId(interaction.customId);
  if (!parsed) return false;
  const guild = requireGuild(interaction);
  const userId = interaction.user.id;

  if (parsed.kind === 'grid-set') {
    if (!interaction.isStringSelectMenu()) return false;
    const mask = setBlockDays(parsed.mask, parsed.block, parseGridDays(interaction.values));
    await interaction.update(
      await ctx.squads.availabilityGrid(guild.id, userId, parsed.gameId, mask),
    );
    return true;
  }
  if (!interaction.isButton()) return false;

  switch (parsed.kind) {
    case 'profile-start':
      await openProfileForm(ctx, interaction, parsed.gameId);
      return true;

    case 'grid-save': {
      saveCooldowns.sweep();
      const remaining = saveCooldowns.hit(userId, 'squad:profile', PROFILE_SAVE_COOLDOWN_SECONDS);
      if (remaining > 0) {
        throw new UserFacingError(`Aguarde ${String(remaining)}s antes de salvar de novo.`, {
          code: 'COOLDOWN',
        });
      }
      // Salvar roda o match, que pode abrir threads: mais que os 3 s da interação.
      await interaction.deferUpdate();
      const result = await ctx.squads.saveAvailability(guild, userId, parsed.gameId, parsed.mask);
      await interaction.editReply(
        profileSavedMessage({
          game: result.game,
          profile: result.profile,
          embedColor: (await ctx.config.getSettings(guild.id)).embedColor,
        }),
      );
      return true;
    }

    case 'status': {
      await interaction.deferUpdate();
      const { profile } = await ctx.squads.setProfileStatus(
        guild.id,
        userId,
        parsed.gameId,
        parsed.status,
      );
      const { game } = await ctx.squads.getProfileDraft(guild.id, userId, parsed.gameId);
      await interaction.editReply(
        profileSavedMessage({
          game,
          profile,
          embedColor: (await ctx.config.getSettings(guild.id)).embedColor,
        }),
      );
      return true;
    }

    case 'proposal': {
      await interaction.deferReply(EPHEMERAL);
      const content =
        parsed.action === 'accept'
          ? proposalAcceptedText(await ctx.squads.acceptProposal(guild, parsed.proposalId, userId))
          : proposalDeclinedText(
              (await ctx.squads.declineProposal(guild, parsed.proposalId, userId)).outcome,
            );
      await interaction.editReply({ content });
      return true;
    }

    case 'request': {
      await interaction.deferReply(EPHEMERAL);
      const decision =
        parsed.action === 'accept'
          ? await ctx.squads.acceptJoinRequest(guild, parsed.requestId, userId)
          : await ctx.squads.declineJoinRequest(guild, parsed.requestId, userId);
      await interaction.editReply({ content: joinRequestDecisionText(decision) });
      return true;
    }

    case 'session': {
      await interaction.deferReply(EPHEMERAL);
      const going = parsed.action === 'going';
      await ctx.squads.vote(guild, parsed.sessionId, userId, going);
      await interaction.editReply({ content: voteText(going) });
      return true;
    }

    case 'keep':
      await interaction.deferReply(EPHEMERAL);
      await ctx.squads.keepAlive(guild, parsed.squadId, userId);
      await interaction.editReply({ content: KEEP_ALIVE_TEXT });
      return true;

    case 'leave':
      await interaction.reply({ ...leaveConfirmMessage(parsed.squadId), ...EPHEMERAL });
      return true;

    case 'leave-confirm': {
      await interaction.deferUpdate();
      const result = await ctx.squads.removeMember(guild, parsed.squadId, userId, null);
      await interaction.editReply({ content: result.notice, components: [] });
      return true;
    }

    case 'join': {
      await interaction.deferReply(EPHEMERAL);
      const { squad } = await ctx.squads.requestToJoin(guild, userId, parsed.squadId);
      await interaction.editReply({ content: joinRequestSentText(squad) });
      return true;
    }

    default:
      return false;
  }
}

/** O modal do perfil: grava as respostas e troca para a grade de horários. */
export async function handleSquadModal(
  ctx: BotContext,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const parsed = parseSquadCustomId(interaction.customId);
  if (parsed?.kind !== 'profile-modal') return false;
  const guild = requireGuild(interaction);
  const userId = interaction.user.id;

  await interaction.deferReply(EPHEMERAL);
  const { game } = await ctx.squads.getProfileDraft(guild.id, userId, parsed.gameId);
  const answers = readProfileAnswers(game.fields, modalAnswerReader(interaction.fields));
  const profile = await ctx.squads.saveAnswers(guild, userId, parsed.gameId, answers);
  await interaction.editReply(
    await ctx.squads.availabilityGrid(guild.id, userId, parsed.gameId, profile.availability),
  );
  return true;
}
