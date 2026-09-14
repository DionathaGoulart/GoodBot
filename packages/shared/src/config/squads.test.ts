import { describe, expect, it } from 'vitest';

import { MAX_SQUAD_GAME_FIELDS, SQUAD_AVAILABILITY_MAX, SQUAD_BLOCKS } from '../constants';
import {
  DEFAULT_SQUAD_BLOCKS,
  DEFAULT_SQUADS_CONFIG,
  SquadGameInputSchema,
  SquadProfileInputSchema,
  SquadsConfigSchema,
  validateAnswers,
} from './squads';

const PLATFORM = {
  key: 'platform',
  label: 'Plataforma',
  type: 'select',
  options: ['PC', 'PS5'],
  required: true,
  match: 'hard',
} as const;
const MODES = {
  key: 'modes',
  label: 'Modos',
  type: 'tags',
  options: ['PvE', 'Farm', 'Speedrun'],
  match: 'soft',
} as const;
const NOTE = { key: 'note', label: 'Observação', type: 'text' } as const;

const blocksWith = (index: number, patch: Record<string, unknown>) =>
  DEFAULT_SQUAD_BLOCKS.map((block, i) => (i === index ? { ...block, ...patch } : block));

describe('SquadsConfigSchema', () => {
  it('nasce desligado, com as quatro faixas e os prazos padrão', () => {
    expect(SquadsConfigSchema.parse({})).toEqual(DEFAULT_SQUADS_CONFIG);
    expect(DEFAULT_SQUADS_CONFIG).toMatchObject({
      enabled: false,
      searchChannelId: null,
      voicePoolIds: [],
      proposalTtlHours: 72,
      reproposeCooldownDays: 14,
      reminderMinutesBefore: 30,
      inactiveWeeks: 4,
      maxSquadsPerUser: 1,
      channelNaming: 'squad-{name}',
    });
    expect(DEFAULT_SQUADS_CONFIG.blocks.map((block) => block.key)).toEqual([...SQUAD_BLOCKS]);
    expect(DEFAULT_SQUADS_CONFIG.blocks[3]).toEqual({
      key: 'night',
      label: 'Madrugada',
      startHour: 0,
      endHour: 6,
    });
  });

  it('cada parse ganha a sua cópia das faixas padrão', () => {
    const first = SquadsConfigSchema.parse({});
    first.blocks[0]!.label = 'Alterada';
    expect(SquadsConfigSchema.parse({}).blocks[0]!.label).toBe('Manhã');
  });

  it('aceita faixas editadas e apara o rótulo', () => {
    const parsed = SquadsConfigSchema.parse({
      blocks: blocksWith(2, { label: '  Noitão ', endHour: 23 }),
    });
    expect(parsed.blocks[2]).toEqual({
      key: 'evening',
      label: 'Noitão',
      startHour: 18,
      endHour: 23,
    });
  });

  it('recusa faixa que termina antes de começar ou atravessa a meia-noite', () => {
    const crossing = SquadsConfigSchema.safeParse({
      blocks: blocksWith(3, { startHour: 22, endHour: 2 }),
    });
    expect(crossing.success).toBe(false);
    expect(crossing.error?.issues[0]?.path).toEqual(['blocks', 3, 'endHour']);
    expect(
      SquadsConfigSchema.safeParse({ blocks: blocksWith(0, { startHour: 12, endHour: 12 }) })
        .success,
    ).toBe(false);
  });

  it('recusa hora fora do relógio', () => {
    for (const patch of [
      { startHour: 24 },
      { startHour: -1 },
      { endHour: 0 },
      { endHour: 25 },
      { startHour: 6.5 },
    ]) {
      expect(SquadsConfigSchema.safeParse({ blocks: blocksWith(0, patch) }).success).toBe(false);
    }
  });

  it('recusa grade sem as quatro faixas ou fora de ordem', () => {
    expect(SquadsConfigSchema.safeParse({ blocks: DEFAULT_SQUAD_BLOCKS.slice(0, 3) }).success).toBe(
      false,
    );
    const swapped = [
      DEFAULT_SQUAD_BLOCKS[1],
      DEFAULT_SQUAD_BLOCKS[0],
      ...DEFAULT_SQUAD_BLOCKS.slice(2),
    ];
    const result = SquadsConfigSchema.safeParse({ blocks: swapped });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['blocks', 0, 'key']);
  });

  it('recusa rótulo de faixa vazio', () => {
    expect(SquadsConfigSchema.safeParse({ blocks: blocksWith(1, { label: '   ' }) }).success).toBe(
      false,
    );
  });

  it('exige {name} no padrão do canal', () => {
    expect(SquadsConfigSchema.safeParse({ channelNaming: 'squad' }).success).toBe(false);
    expect(SquadsConfigSchema.parse({ channelNaming: ' time-{name} ' }).channelNaming).toBe(
      'time-{name}',
    );
  });

  it('respeita os limites dos prazos', () => {
    expect(SquadsConfigSchema.safeParse({ proposalTtlHours: 0 }).success).toBe(false);
    expect(SquadsConfigSchema.safeParse({ proposalTtlHours: 721 }).success).toBe(false);
    expect(SquadsConfigSchema.safeParse({ reproposeCooldownDays: 0 }).success).toBe(true);
    expect(SquadsConfigSchema.safeParse({ reminderMinutesBefore: 241 }).success).toBe(false);
    expect(SquadsConfigSchema.safeParse({ inactiveWeeks: 0 }).success).toBe(false);
    expect(SquadsConfigSchema.safeParse({ maxSquadsPerUser: 6 }).success).toBe(false);
  });

  it('valida e deduplica o pool de voice', () => {
    const voice = '123456789012345678';
    expect(SquadsConfigSchema.parse({ voicePoolIds: [voice, voice] }).voicePoolIds).toEqual([
      voice,
    ]);
    expect(SquadsConfigSchema.safeParse({ voicePoolIds: ['Hellpod Alfa'] }).success).toBe(false);
  });
});

describe('SquadGameInputSchema', () => {
  const game = { name: 'Helldivers 2', squadSize: 4, fields: [PLATFORM, MODES, NOTE] };

  it('aceita um jogo com campos e aplica os defaults', () => {
    const parsed = SquadGameInputSchema.parse(game);
    expect(parsed.enabled).toBe(true);
    expect(parsed.fields[1]).toMatchObject({ key: 'modes', required: false, match: 'soft' });
    expect(parsed.fields[2]).toEqual({
      key: 'note',
      label: 'Observação',
      type: 'text',
      options: [],
      required: false,
      match: 'none',
    });
  });

  it('recusa chave repetida, apontando o campo repetido', () => {
    const result = SquadGameInputSchema.safeParse({
      ...game,
      fields: [PLATFORM, { ...MODES, key: 'platform' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['fields', 1, 'key']);
  });

  it('select e tags exigem pelo menos uma opção', () => {
    for (const field of [
      { ...PLATFORM, options: [] },
      { ...MODES, options: undefined },
    ]) {
      const result = SquadGameInputSchema.safeParse({ ...game, fields: [field] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['fields', 0, 'options']);
    }
  });

  it('texto livre não tem opções nem entra no match', () => {
    const hard = SquadGameInputSchema.safeParse({ ...game, fields: [{ ...NOTE, match: 'hard' }] });
    expect(hard.success).toBe(false);
    expect(hard.error?.issues[0]?.path).toEqual(['fields', 0, 'match']);
    const withOptions = SquadGameInputSchema.safeParse({
      ...game,
      fields: [{ ...NOTE, options: ['a'] }],
    });
    expect(withOptions.success).toBe(false);
  });

  it('aceita no máximo cinco campos', () => {
    const fields = (length: number) =>
      Array.from({ length }, (_, index) => ({ ...NOTE, key: `note_${String(index)}` }));
    expect(
      SquadGameInputSchema.safeParse({ ...game, fields: fields(MAX_SQUAD_GAME_FIELDS) }).success,
    ).toBe(true);
    const result = SquadGameInputSchema.safeParse({
      ...game,
      fields: fields(MAX_SQUAD_GAME_FIELDS + 1),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['fields']);
  });

  it('recusa chave fora do padrão ou reservada', () => {
    for (const key of [
      'Plataforma',
      'modo de jogo',
      '',
      'a'.repeat(33),
      'constructor',
      '__proto__',
    ]) {
      expect(SquadGameInputSchema.safeParse({ ...game, fields: [{ ...NOTE, key }] }).success).toBe(
        false,
      );
    }
  });

  it('recusa opção repetida e mais de 25 opções', () => {
    const repeated = SquadGameInputSchema.safeParse({
      ...game,
      fields: [{ ...PLATFORM, options: ['PC', ' PC '] }],
    });
    expect(repeated.success).toBe(false);
    expect(repeated.error?.issues[0]?.path).toEqual(['fields', 0, 'options', 1]);
    const many = Array.from({ length: 26 }, (_, index) => `Opção ${String(index)}`);
    expect(
      SquadGameInputSchema.safeParse({ ...game, fields: [{ ...PLATFORM, options: many }] }).success,
    ).toBe(false);
  });

  it('squad tem de 2 a 10 jogadores', () => {
    expect(SquadGameInputSchema.safeParse({ ...game, squadSize: 1 }).success).toBe(false);
    expect(SquadGameInputSchema.safeParse({ ...game, squadSize: 11 }).success).toBe(false);
    expect(SquadGameInputSchema.safeParse({ ...game, squadSize: 2 }).success).toBe(true);
  });

  it('entrada malformada vira erro de validação, não exceção', () => {
    expect(SquadGameInputSchema.safeParse({ ...game, fields: [null] }).success).toBe(false);
    expect(
      SquadGameInputSchema.safeParse({ ...game, fields: [{ ...PLATFORM, options: 'PC' }] }).success,
    ).toBe(false);
  });
});

describe('validateAnswers', () => {
  const fields = SquadGameInputSchema.parse({
    name: 'Helldivers 2',
    squadSize: 4,
    fields: [PLATFORM, MODES, NOTE],
  }).fields;

  it('aceita respostas válidas, apara texto e remove tags repetidas', () => {
    const result = validateAnswers(fields, {
      platform: 'PC',
      modes: ['Farm', 'PvE', 'Farm'],
      note: ' só à noite ',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ platform: 'PC', modes: ['Farm', 'PvE'], note: 'só à noite' });
  });

  it('recusa campo obrigatório ausente', () => {
    const result = validateAnswers(fields, { modes: ['PvE'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['platform'],
      message: 'Campo obrigatório.',
    });
  });

  it('campo opcional pode faltar, e resposta em branco conta como ausente', () => {
    expect(validateAnswers(fields, { platform: 'PS5' }).data).toEqual({ platform: 'PS5' });
    expect(validateAnswers(fields, { platform: 'PS5', modes: [], note: '   ' }).data).toEqual({
      platform: 'PS5',
    });
    const blankRequired = validateAnswers(fields, { platform: '' });
    expect(blankRequired.error?.issues[0]).toMatchObject({
      path: ['platform'],
      message: 'Campo obrigatório.',
    });
  });

  it('recusa chave que o jogo não tem', () => {
    const result = validateAnswers(fields, { platform: 'PC', mic: 'Sim' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['mic'] });
  });

  it('recusa opção fora da lista', () => {
    expect(validateAnswers(fields, { platform: 'Xbox' }).error?.issues[0]?.path).toEqual([
      'platform',
    ]);
    expect(
      validateAnswers(fields, { platform: 'PC', modes: ['PvE', 'PvP'] }).error?.issues[0]?.path,
    ).toEqual(['modes', 1]);
  });

  it('recusa resposta no formato errado e texto acima do teto', () => {
    expect(validateAnswers(fields, { platform: ['PC'] }).success).toBe(false);
    expect(validateAnswers(fields, { platform: 'PC', modes: 'PvE' }).success).toBe(false);
    expect(validateAnswers(fields, { platform: 'PC', note: 'a'.repeat(101) }).success).toBe(false);
    expect(validateAnswers(fields, null).success).toBe(false);
    expect(validateAnswers(fields, ['PC']).success).toBe(false);
  });

  it('jogo sem campos só aceita respostas vazias', () => {
    expect(validateAnswers([], {}).success).toBe(true);
    expect(validateAnswers([], { platform: 'PC' }).success).toBe(false);
  });
});

describe('SquadProfileInputSchema', () => {
  it('aplica os defaults e aceita a grade inteira marcada', () => {
    expect(SquadProfileInputSchema.parse({ availability: SQUAD_AVAILABILITY_MAX })).toEqual({
      availability: SQUAD_AVAILABILITY_MAX,
      answers: {},
      status: 'searching',
    });
  });

  it('recusa grade fora dos 28 bits', () => {
    for (const availability of [-1, SQUAD_AVAILABILITY_MAX + 1, 1.5]) {
      expect(SquadProfileInputSchema.safeParse({ availability }).success).toBe(false);
    }
  });

  it('o jogador não se põe em squad sozinho', () => {
    expect(SquadProfileInputSchema.safeParse({ availability: 1, status: 'in_squad' }).success).toBe(
      false,
    );
    expect(SquadProfileInputSchema.parse({ availability: 1, status: 'paused' }).status).toBe(
      'paused',
    );
  });

  it('confere só o formato das respostas', () => {
    expect(
      SquadProfileInputSchema.safeParse({ availability: 1, answers: { platform: 'Xbox' } }).success,
    ).toBe(true);
    expect(
      SquadProfileInputSchema.safeParse({ availability: 1, answers: { Plataforma: 'PC' } }).success,
    ).toBe(false);
    expect(
      SquadProfileInputSchema.safeParse({ availability: 1, answers: { platform: 3 } }).success,
    ).toBe(false);
  });
});
