import { closePoll, createPoll, getPoll, scheduleAction, setPollMessage } from '@goodbot/db';
import {
  MAX_EMBED_TITLE_LENGTH,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  UserFacingError,
  formatDuration,
} from '@goodbot/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { requireUtilities, resolveTextChannel } from './shared';
import { defineCommand } from '../../lib/command';
import { botFooter, successEmbed } from '../../lib/embeds';
import { parsePollOptions } from '../../lib/poll';
import { pollMessage } from '../../lib/poll-message';
import { levelAtLeast } from '../../services/permissions';
import { readDuration } from '../moderation/shared';

import type { CommandContext } from '../../lib/command';
import type { UtilitiesConfig } from '@goodbot/shared';

const MAX_QUESTION_LENGTH = 256;

/** Enquete é barulhenta: quem pode criar sai da config, não do nível do comando. */
function assertCanCreate(ctx: CommandContext, config: UtilitiesConfig): void {
  const allowed = config.polls.creatorRoleIds;
  if (allowed.length === 0 || levelAtLeast(ctx.level, 'mod')) return;
  if (ctx.member.roles.cache.hasAny(...allowed)) return;
  throw new UserFacingError('Você não tem cargo para criar enquetes neste servidor.', {
    code: 'POLL_FORBIDDEN',
  });
}

async function create(ctx: CommandContext, config: UtilitiesConfig): Promise<void> {
  assertCanCreate(ctx, config);

  const question = ctx.interaction.options
    .getString('pergunta', true)
    .slice(0, MAX_QUESTION_LENGTH);
  const options = parsePollOptions(ctx.interaction.options.getString('opcoes', true));
  if (options.length === 0) {
    throw new UserFacingError(
      `Informe de ${POLL_MIN_OPTIONS} a ${POLL_MAX_OPTIONS} opções distintas, separadas por ` +
        '`|` (ex.: `Sim | Não | Tanto faz`).',
      { code: 'POLL_BAD_OPTIONS' },
    );
  }

  const durationMs = readDuration(ctx.interaction);
  if (!durationMs) {
    throw new UserFacingError('Informe a duração (ex.: `1h`, `2d`).', { code: 'BAD_DURATION' });
  }
  if (durationMs > config.polls.maxDurationMs) {
    throw new UserFacingError(
      `A duração máxima aqui é ${formatDuration(config.polls.maxDurationMs, { style: 'long' })}.`,
      { code: 'POLL_TOO_LONG' },
    );
  }

  const channel = resolveTextChannel(ctx.interaction);
  const endsAt = new Date(Date.now() + durationMs);
  const poll = await createPoll(ctx.db, {
    guildId: ctx.guildId,
    channelId: channel.id,
    authorId: ctx.member.id,
    question,
    options,
    multiple: ctx.interaction.options.getBoolean('multipla') ?? false,
    endsAt,
  });

  // A mensagem só pode ser criada depois do insert: o `custom_id` dos botões
  // carrega o id da enquete.
  const message = await channel.send(pollMessage(poll, { embedColor: ctx.settings.embedColor }));
  await setPollMessage(ctx.db, poll.id, message.id);
  await scheduleAction(ctx.db, {
    guildId: ctx.guildId,
    kind: 'poll_close',
    runAt: endsAt,
    payload: { pollId: poll.id },
  });

  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: 'Enquete criada',
        description: `[Ver enquete](${message.url})`,
        fields: [
          { name: 'Opções', value: `${options.length}`, inline: true },
          {
            name: 'Encerra em',
            value: formatDuration(durationMs, { style: 'long' }),
            inline: true,
          },
        ],
        footer: botFooter(`ID: ${poll.id}`),
      }),
    ],
  });
}

async function end(ctx: CommandContext): Promise<void> {
  const id = ctx.interaction.options.getString('id', true).trim();
  const existing = await getPoll(ctx.db, id);
  if (!existing || existing.guildId !== ctx.guildId) {
    throw new UserFacingError('Não encontrei essa enquete.', { code: 'POLL_NOT_FOUND' });
  }
  if (existing.authorId !== ctx.member.id && !levelAtLeast(ctx.level, 'mod')) {
    throw new UserFacingError('Só quem criou a enquete (ou a moderação) pode encerrá-la.', {
      code: 'POLL_FORBIDDEN',
    });
  }

  const closed = await closePoll(ctx.db, id);
  if (!closed) {
    throw new UserFacingError('Essa enquete já estava encerrada.', { code: 'POLL_CLOSED' });
  }

  await ctx.polls.publishResult(closed);
  await ctx.interaction.editReply({
    embeds: [
      successEmbed({
        title: 'Enquete encerrada',
        description: closed.question.slice(0, MAX_EMBED_TITLE_LENGTH),
        footer: botFooter(`ID: ${closed.id}`),
      }),
    ],
  });
}

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Enquetes com botões')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Cria uma enquete neste canal')
        .addStringOption((option) =>
          option
            .setName('pergunta')
            .setDescription('O que perguntar')
            .setMaxLength(MAX_QUESTION_LENGTH)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('opcoes')
            .setDescription(`De ${POLL_MIN_OPTIONS} a ${POLL_MAX_OPTIONS}, separadas por |`)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('duracao')
            .setDescription('Quanto tempo fica aberta (ex.: 1h, 2d)')
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option.setName('multipla').setDescription('Permitir votar em mais de uma opção'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Encerra uma enquete antes da hora')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('O ID mostrado quando a enquete foi criada')
            .setRequired(true),
        ),
    ),
  module: 'utilities',
  level: 'member',
  cooldown: 10,
  defer: true,
  ephemeral: true,
  help: 'Cria e encerra enquetes com botões.',
  async execute(ctx) {
    const config = await requireUtilities(ctx);
    if (ctx.interaction.options.getSubcommand() === 'end') {
      await end(ctx);
      return;
    }
    await create(ctx, config);
  },
});
