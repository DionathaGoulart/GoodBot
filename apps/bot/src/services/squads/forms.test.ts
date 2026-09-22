import { DEFAULT_SQUAD_BLOCKS, toBits } from '@goodbot/shared';
import { ComponentType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  availabilityGridMessage,
  blockDays,
  modalAnswerReader,
  parseGridDays,
  profileModal,
  readProfileAnswers,
  RESCHEDULE_WHEN_FIELD,
  rescheduleModal,
  setBlockDays,
} from './forms';
import { parseSquadCustomId } from './ids';

import type { SquadGameField } from '@goodbot/shared';

const UUID = '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

const FIELDS: SquadGameField[] = [
  {
    key: 'platform',
    label: 'Plataforma',
    type: 'select',
    options: ['PC', 'PS5'],
    required: true,
    match: 'hard',
  },
  {
    key: 'fronts',
    label: 'Frentes',
    type: 'tags',
    options: ['Terminids', 'Automatons', 'Illuminate'],
    required: false,
    match: 'none',
  },
  { key: 'nick', label: 'Nick no jogo', type: 'text', options: [], required: false, match: 'none' },
];

interface LabelJson {
  label: string;
  description?: string;
  component: Record<string, unknown> & { options?: { value: string; default?: boolean }[] };
}

interface RowJson {
  components: (Record<string, unknown> & {
    custom_id: string;
    options?: { value: string; default?: boolean; description?: string }[];
  })[];
}

function rowsOf(message: ReturnType<typeof availabilityGridMessage>): RowJson[] {
  return (message.components ?? []).map((row) => (row as unknown as { toJSON(): RowJson }).toJSON());
}

describe('modal do perfil', () => {
  it('um componente por campo, do tipo certo e preenchido com as respostas', () => {
    const json = profileModal(
      { id: UUID, name: 'Helldivers 2', fields: FIELDS },
      { platform: 'PS5', fronts: ['Automatons'], nick: 'Rafa' },
    ).toJSON();

    expect(parseSquadCustomId(json.custom_id)).toEqual({ kind: 'profile-modal', gameId: UUID });
    expect(json.title).toBe('Perfil: Helldivers 2');
    const [platform, fronts, nick] = json.components as unknown as LabelJson[];

    expect(platform?.label).toBe('Plataforma');
    expect(platform?.component).toMatchObject({
      type: ComponentType.StringSelect,
      custom_id: 'platform',
      required: true,
      min_values: 1,
      max_values: 1,
    });
    expect(platform?.component.options?.map((option) => option.default)).toEqual([false, true]);

    expect(fronts?.description).toBe('Pode escolher mais de uma.');
    expect(fronts?.component).toMatchObject({ required: false, min_values: 0, max_values: 3 });
    expect(
      fronts?.component.options?.filter((option) => option.default).map((option) => option.value),
    ).toEqual(['Automatons']);

    expect(nick?.component).toMatchObject({
      type: ComponentType.TextInput,
      custom_id: 'nick',
      value: 'Rafa',
      required: false,
      max_length: 100,
    });
  });

  it('título longo é cortado no teto do Discord', () => {
    const json = profileModal({ id: UUID, name: 'x'.repeat(80), fields: FIELDS }, {}).toJSON();
    expect(json.title.length).toBe(45);
  });

  it('lê as respostas no formato do perfil e deixa de fora o que não veio', () => {
    const selects: Record<string, string[]> = { platform: ['PC'], fronts: [] };
    const answers = readProfileAnswers(FIELDS, {
      text: (key) => (key === 'nick' ? ' Rafa ' : null),
      select: (key) => selects[key] ?? null,
    });
    expect(answers).toEqual({ platform: 'PC', fronts: [], nick: ' Rafa ' });

    const partial = readProfileAnswers(FIELDS, { text: () => null, select: () => null });
    expect(partial).toEqual({});
  });

  it('o modal do REMARCAR leva a jogatina no custom_id e o horário atual na descrição', () => {
    const json = rescheduleModal({ id: 42 }, 'hoje às 22:00').toJSON();
    expect(parseSquadCustomId(json.custom_id)).toEqual({ kind: 'reschedule-modal', sessionId: 42 });
    const [when] = json.components as unknown as LabelJson[];
    expect(when?.description).toContain('Marcada para hoje às 22:00.');
    expect(when?.description?.length).toBeLessThanOrEqual(100);
    expect(when?.component).toMatchObject({
      type: ComponentType.TextInput,
      custom_id: RESCHEDULE_WHEN_FIELD,
      required: true,
    });
  });

  it('o leitor do discord.js vira null quando o componente não existe', () => {
    const reader = modalAnswerReader({
      getTextInputValue: () => {
        throw new Error('ModalSubmitInteractionFieldNotFound');
      },
      getStringSelectValues: () => ['PC'],
    });
    expect(reader.text('nick')).toBeNull();
    expect(reader.select('platform')).toEqual(['PC']);
  });
});

describe('grade de horários', () => {
  it('trocar os dias de uma faixa não mexe nas outras', () => {
    const mask = toBits([
      { day: 5, block: 2 },
      { day: 6, block: 2 },
      { day: 6, block: 0 },
    ]);
    const next = setBlockDays(mask, 2, [0, 6]);
    expect(blockDays(next, 2)).toEqual([0, 6]);
    expect(blockDays(next, 0)).toEqual([6]);
    expect(setBlockDays(next, 2, [])).toBe(toBits([{ day: 6, block: 0 }]));
  });

  it('marcar tudo cabe na máscara máxima', () => {
    let mask = 0;
    for (let block = 0; block < 4; block++) mask = setBlockDays(mask, block, [0, 1, 2, 3, 4, 5, 6]);
    expect(mask).toBe(2 ** 28 - 1);
  });

  it('valores do select: só dias válidos, sem repetição', () => {
    expect(parseGridDays(['6', '6', '7', 'x', '0', '-1'])).toEqual([6, 0]);
  });

  it('quatro selects e o salvar, todos com a máscara no custom_id', () => {
    const mask = toBits([
      { day: 6, block: 2 },
      { day: 5, block: 3 },
    ]);
    const rows = rowsOf(
      availabilityGridMessage({
        game: { id: UUID, name: 'Helldivers 2' },
        mask,
        blocks: DEFAULT_SQUAD_BLOCKS,
        embedColor: 0,
      }),
    );

    expect(rows).toHaveLength(5);
    const selects = rows.slice(0, 4).map((row) => row.components[0]!);
    selects.forEach((select, block) => {
      expect(parseSquadCustomId(select.custom_id)).toEqual({
        kind: 'grid-set',
        gameId: UUID,
        block,
        mask,
      });
    });
    const marked = (index: number) =>
      selects[index]?.options?.filter((option) => option.default).map((option) => option.value);
    expect(marked(0)).toEqual([]);
    expect(marked(2)).toEqual(['6']);
    expect(marked(3)).toEqual(['5']);
    expect(selects[3]?.options?.[5]?.description).toBe('Noite de quinta para sexta');

    const save = rows[4]?.components[0];
    expect(parseSquadCustomId(save?.custom_id ?? '')).toEqual({
      kind: 'grid-save',
      gameId: UUID,
      mask,
    });
    expect(save?.disabled).toBe(false);
  });

  it('grade vazia não deixa salvar', () => {
    const rows = rowsOf(
      availabilityGridMessage({
        game: { id: UUID, name: 'Helldivers 2' },
        mask: 0,
        blocks: DEFAULT_SQUAD_BLOCKS,
        embedColor: 0,
      }),
    );
    expect(rows[4]?.components[0]?.disabled).toBe(true);
  });
});
