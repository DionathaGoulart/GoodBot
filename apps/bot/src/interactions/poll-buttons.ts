import { votePoll } from '@goodbot/db';
import { MessageFlags } from 'discord.js';

import { parsePollButtonId, pollMessage } from '../lib/poll-message';
import { childLogger } from '../logger';

import type { BotContext } from '../lib/command';
import type { ButtonInteraction } from 'discord.js';

const log = childLogger('poll-buttons');

/**
 * Clique num botão de voto. Responde sempre efêmero (o resultado público vai
 * na própria mensagem da enquete) e nunca deixa a interação sem resposta.
 */
export async function handlePollButton(
  ctx: BotContext,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parsePollButtonId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await votePoll(ctx.db, {
    pollId: parsed.pollId,
    userId: interaction.user.id,
    optionId: parsed.optionId,
  });

  if (result.status === 'unknown') {
    await interaction.editReply({ content: 'Essa enquete não existe mais.' });
    return true;
  }

  if (result.status === 'closed') {
    // O scheduler pode ainda não ter passado: fecha a mensagem agora mesmo
    // para ninguém continuar clicando num botão que não conta.
    await ctx.polls.closeIfExpired(parsed.pollId);
    await interaction.editReply({ content: 'Essa enquete já foi encerrada.' });
    return true;
  }

  const chosen = result.chosen
    .map((id) => result.poll.options.find((option) => option.id === id)?.label)
    .filter((label): label is string => Boolean(label));

  await interaction.editReply({
    content:
      chosen.length === 0 ? 'Voto retirado.' : `Voto registrado: **${chosen.join('**, **')}**.`,
  });

  // A contagem pública vive na mensagem original; um erro aqui não pode
  // desfazer o voto que já está no banco.
  try {
    await interaction.message.edit(pollMessage(result.poll));
  } catch (error) {
    log.warn({ err: error, pollId: parsed.pollId }, 'falha ao atualizar a enquete');
  }
  return true;
}
