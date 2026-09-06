import { ActionRowBuilder, ButtonBuilder, ButtonStyle, time, TimestampStyles } from 'discord.js';

import { botFooter, infoEmbed, successEmbed } from './embeds';
import { formatTally, tallyPoll } from './poll';

import type { Poll } from '@cobot/db';
import type { BaseMessageOptions } from 'discord.js';

/** Prefixo do `custom_id` dos botões de voto: `poll:<id>:<opção>`. */
export const POLL_BUTTON_PREFIX = 'poll';
/** O Discord aceita 5 botões por linha. */
const BUTTONS_PER_ROW = 5;

export function pollButtonId(pollId: string, optionId: string): string {
  return `${POLL_BUTTON_PREFIX}:${pollId}:${optionId}`;
}

/** Devolve `null` quando o `custom_id` não é de enquete. */
export function parsePollButtonId(
  customId: string,
): { pollId: string; optionId: string } | null {
  const [prefix, pollId, optionId] = customId.split(':');
  if (prefix !== POLL_BUTTON_PREFIX || !pollId || !optionId) return null;
  return { pollId, optionId };
}

function rows(poll: Poll): ActionRowBuilder<ButtonBuilder>[] {
  const built: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < poll.options.length; index += BUTTONS_PER_ROW) {
    const slice = poll.options.slice(index, index + BUTTONS_PER_ROW);
    built.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        slice.map((option) => {
          const button = new ButtonBuilder()
            .setCustomId(pollButtonId(poll.id, option.id))
            .setLabel(option.label.slice(0, 80).toUpperCase())
            .setStyle(ButtonStyle.Secondary);
          if (option.emoji) button.setEmoji(option.emoji);
          return button;
        }),
      ),
    );
  }
  return built;
}

/**
 * A mensagem da enquete, aberta ou fechada. A mesma função serve ao `/poll`,
 * ao clique no botão e ao `poll_close` do scheduler — o resultado precisa ser
 * idêntico nos três.
 */
export function pollMessage(
  poll: Poll,
  options: { closed?: boolean; embedColor?: number } = {},
): BaseMessageOptions {
  const closed = options.closed ?? poll.closedAt !== null;
  const result = tallyPoll(poll.options, poll.votes);

  const lines = result.tallies.map(formatTally).join('\n\n');
  const status = closed
    ? 'Encerrada.'
    : `Encerra ${time(poll.endsAt, TimestampStyles.RelativeTime)}.`;
  const mode = poll.multiple ? 'Múltipla escolha.' : 'Uma opção por pessoa.';

  const body = {
    title: closed ? 'Enquete encerrada' : 'Enquete',
    description: `**${poll.question}**\n\n${lines}\n\n${status} ${mode}`,
    footer: botFooter(`${result.totalVoters} VOTANTE(S)`),
  };

  return {
    embeds: [closed ? successEmbed(body) : infoEmbed(body, options.embedColor)],
    components: closed ? [] : rows(poll),
  };
}
