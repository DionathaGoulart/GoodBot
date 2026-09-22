import { MAX_NAME_LENGTH, MAX_SQUAD_TEXT_ANSWER_LENGTH, SQUAD_DAYS } from '@goodbot/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { SQUADS_FOOTER } from './embeds';
import {
  boraModalId,
  gridSaveButtonId,
  gridSelectId,
  profileModalId,
  renameModalId,
  rescheduleModalId,
} from './ids';
import { SQUAD_DAY_NAMES } from './slots';
import { infoEmbed } from '../../lib/embeds';

import type { Squad, SquadGame, SquadSession } from '@goodbot/db';
import type { SquadAnswers, SquadBlockConfig, SquadGameField } from '@goodbot/shared';
import type { BaseMessageOptions, ModalSubmitFields } from 'discord.js';

/**
 * Os formulários do módulo. Os dois do perfil (o modal com os campos do jogo e
 * a grade de horários) são separados porque o modal do Discord aceita só cinco
 * componentes, e a grade sozinha já precisa de quatro selects. Os dos botões do
 * guia e da jogatina (BORA, RENOMEAR e REMARCAR) têm um campo só: quem aperta
 * um botão não quer preencher formulário.
 */

/** Teto do Discord para o título de um modal. */
const MAX_MODAL_TITLE = 45;

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// ── modal dos campos ────────────────────────────────────────────────────────

function answerOf(answers: SquadAnswers, key: string): string | string[] | undefined {
  return Object.hasOwn(answers, key) ? answers[key] : undefined;
}

function fieldComponent(field: SquadGameField, answers: SquadAnswers): LabelBuilder {
  const label = new LabelBuilder().setLabel(field.label);
  const current = answerOf(answers, field.key);

  if (field.type === 'text') {
    const input = new TextInputBuilder()
      .setCustomId(field.key)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(MAX_SQUAD_TEXT_ANSWER_LENGTH)
      .setRequired(field.required);
    if (typeof current === 'string' && current) input.setValue(current);
    return label.setTextInputComponent(input);
  }

  const chosen = new Set(Array.isArray(current) ? current : current ? [current] : []);
  const multiple = field.type === 'tags';
  if (multiple) label.setDescription('Pode escolher mais de uma.');
  return label.setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId(field.key)
      .setRequired(field.required)
      .setMinValues(field.required ? 1 : 0)
      .setMaxValues(multiple ? field.options.length : 1)
      .addOptions(
        field.options.map((option) => ({
          label: option,
          value: option,
          default: chosen.has(option),
        })),
      ),
  );
}

/** Modal com os campos do jogo, já preenchido com as respostas atuais. Exige ao menos um campo. */
export function profileModal(
  game: Pick<SquadGame, 'id' | 'name' | 'fields'>,
  answers: SquadAnswers,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(profileModalId(game.id))
    .setTitle(`Perfil: ${game.name}`.slice(0, MAX_MODAL_TITLE))
    .setLabelComponents(game.fields.map((field) => fieldComponent(field, answers)));
}

/** O que o handler do modal consegue ler; `null` = o componente não veio. */
export interface ModalAnswerReader {
  text(key: string): string | null;
  select(key: string): readonly string[] | null;
}

/** Leitor sobre os campos do discord.js, que lançam quando o componente não existe. */
export function modalAnswerReader(
  fields: Pick<ModalSubmitFields, 'getTextInputValue' | 'getStringSelectValues'>,
): ModalAnswerReader {
  const attempt = <T>(read: () => T): T | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  return {
    text: (key) => attempt(() => fields.getTextInputValue(key)),
    select: (key) => attempt(() => fields.getStringSelectValues(key)),
  };
}

/**
 * Respostas cruas do modal, na forma que o perfil grava. Não valida: quem
 * salva confere contra os campos do jogo (`validateAnswers`), que pode ter
 * mudado entre abrir e enviar o modal. Componente que não veio fica de fora.
 */
export function readProfileAnswers(
  fields: readonly Pick<SquadGameField, 'key' | 'type'>[],
  reader: ModalAnswerReader,
): SquadAnswers {
  const answers: SquadAnswers = {};
  for (const field of fields) {
    if (field.type === 'text') {
      const value = reader.text(field.key);
      if (value !== null) answers[field.key] = value;
      continue;
    }
    const values = reader.select(field.key);
    if (values === null) continue;
    answers[field.key] = field.type === 'tags' ? [...values] : (values[0] ?? '');
  }
  return answers;
}

// ── modais do guia e da jogatina ────────────────────────────────────────────

/** `custom_id` do campo do modal BORA. */
export const BORA_WHEN_FIELD = 'when';
/** `custom_id` do campo do modal RENOMEAR. */
export const RENAME_NAME_FIELD = 'name';
/** Teto do "quando": `depois de amanhã às 21:30` cabe com folga. */
const MAX_WHEN_LENGTH = 40;

/** O modal do BORA: um campo, "quando", com os exemplos no placeholder. */
export function boraModal(squad: Pick<Squad, 'id' | 'name'>): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(boraModalId(squad.id))
    .setTitle(`Bora jogar: ${squad.name}`.slice(0, MAX_MODAL_TITLE))
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Quando?')
        .setDescription('Hora do servidor. Eu chamo o squad e reservo uma sala.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(BORA_WHEN_FIELD)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('agora, hoje 21h, amanhã 20:30, sex 22h')
            .setMaxLength(MAX_WHEN_LENGTH)
            .setRequired(true),
        ),
    );
}

/** `custom_id` do campo do modal REMARCAR. */
export const RESCHEDULE_WHEN_FIELD = 'when';

/**
 * O modal do REMARCAR: o mesmo "quando" do BORA, com o horário atual na
 * descrição. `current` já vem escrito no fuso da guild ("hoje às 22:00"),
 * porque texto de modal não renderiza o timestamp do Discord.
 */
export function rescheduleModal(session: Pick<SquadSession, 'id'>, current: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(rescheduleModalId(session.id))
    .setTitle('Remarcar a jogatina')
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Novo horário')
        .setDescription(`Marcada para ${current}. Hora do servidor; eu aviso o squad.`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(RESCHEDULE_WHEN_FIELD)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('agora, hoje 21h, 21:30, amanhã 20h')
            .setMaxLength(MAX_WHEN_LENGTH)
            .setRequired(true),
        ),
    );
}

/** O modal do RENOMEAR, já com o nome atual. */
export function renameModal(squad: Pick<Squad, 'id' | 'name'>): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(renameModalId(squad.id))
    .setTitle('Renomear o squad')
    .setLabelComponents(
      new LabelBuilder()
        .setLabel('Nome novo')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(RENAME_NAME_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(MAX_NAME_LENGTH)
            .setValue(squad.name.slice(0, MAX_NAME_LENGTH))
            .setRequired(true),
        ),
    );
}

// ── grade de horários ───────────────────────────────────────────────────────

const BLOCK_SIZE = 4;

/** Dias marcados numa faixa da máscara, de domingo a sábado. */
export function blockDays(mask: number, block: number): number[] {
  const days: number[] = [];
  for (let day = 0; day < SQUAD_DAYS; day++) {
    if (mask & (1 << (day * BLOCK_SIZE + block))) days.push(day);
  }
  return days;
}

/** A máscara com a faixa `block` trocada pelos `days`; as outras faixas ficam. */
export function setBlockDays(mask: number, block: number, days: Iterable<number>): number {
  let next = mask;
  for (let day = 0; day < SQUAD_DAYS; day++) next &= ~(1 << (day * BLOCK_SIZE + block));
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day < SQUAD_DAYS) {
      next |= 1 << (day * BLOCK_SIZE + block);
    }
  }
  return next >>> 0;
}

/** Os valores de um select da grade: dias válidos, sem repetição. */
export function parseGridDays(values: readonly string[]): number[] {
  const days = new Set<number>();
  for (const value of values) {
    if (/^[0-6]$/.test(value)) days.add(Number(value));
  }
  return [...days];
}

export interface GridView {
  game: Pick<SquadGame, 'id' | 'name'>;
  mask: number;
  blocks: readonly SquadBlockConfig[];
  embedColor: number;
}

function hours(block: SquadBlockConfig): string {
  return `${String(block.startHour)}h às ${String(block.endHour)}h`;
}

function daysText(days: readonly number[]): string {
  return days.length > 0
    ? days.map((day) => SQUAD_DAY_NAMES[day] ?? String(day)).join(', ')
    : 'nenhum dia';
}

/**
 * A grade: um select de dias por faixa e o botão de salvar. São cinco linhas
 * de componentes, o máximo que uma mensagem aceita.
 */
export function availabilityGridMessage(view: GridView): BaseMessageOptions {
  const { game, mask, blocks } = view;

  const selects = blocks.map((block, index) => {
    const marked = new Set(blockDays(mask, index));
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(gridSelectId(game.id, index, mask))
        .setPlaceholder(`${block.label} (${hours(block)})`)
        .setMinValues(0)
        .setMaxValues(SQUAD_DAYS)
        .addOptions(
          SQUAD_DAY_NAMES.map((name, day) => {
            const previous = SQUAD_DAY_NAMES[(day + SQUAD_DAYS - 1) % SQUAD_DAYS] ?? '';
            return {
              label: `${capitalize(name)}, ${block.label.toLowerCase()}`,
              value: String(day),
              default: marked.has(day),
              ...(block.key === 'night'
                ? { description: `Noite de ${previous} para ${name}` }
                : {}),
            };
          }),
        ),
    );
  });

  const save = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(gridSaveButtonId(game.id, mask))
      .setLabel('SALVAR HORÁRIOS')
      .setStyle(ButtonStyle.Success)
      .setDisabled(mask === 0),
  );

  const summary = blocks
    .map((block, index) => `**${block.label}**: ${daysText(blockDays(mask, index))}`)
    .join('\n');

  const embed = infoEmbed(
    {
      title: 'Seus horários',
      description: [
        `Marque, em cada faixa, os dias em que você costuma jogar **${game.name}**. Depois clique em **Salvar horários** e eu procuro quem joga nos mesmos horários.`,
        'A madrugada é o começo do dia: madrugada de sábado é a noite de sexta para sábado.',
      ].join('\n\n'),
      fields: [{ name: 'Marcado até agora', value: summary }],
      footer: SQUADS_FOOTER,
    },
    view.embedColor,
  );

  return { embeds: [embed], components: [...selects, save] };
}
