import {
  DEFAULT_SQUAD_BLOCKS,
  MANUAL_MATCH_ISSUE_CODES,
  SquadFieldKeySchema,
  toBits,
  type SquadManualIssue,
} from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import {
  describeManualIssue,
  fieldKeyFromLabel,
  formatDate,
  formatDateTime,
  formatMatchResult,
  formatSquadWindow,
  parseOptionLines,
  SQUAD_PROFILE_STATUS_LABEL,
  summarizeAvailability,
  withFieldKeys,
} from './squad-labels';

const BLOCKS = DEFAULT_SQUAD_BLOCKS;

describe('SQUAD_PROFILE_STATUS_LABEL', () => {
  it('dá nome a cada status de perfil', () => {
    expect(SQUAD_PROFILE_STATUS_LABEL).toEqual({
      searching: 'PROCURANDO',
      in_squad: 'EM SQUAD',
      paused: 'PAUSADO',
    });
  });
});

describe('describeManualIssue', () => {
  const ANA = '300000000000000001';
  const BIA = '300000000000000002';
  const CAIO = '300000000000000003';
  const NAMES: Record<string, string> = { [ANA]: 'Ana', [BIA]: 'Bia', [CAIO]: 'Caio' };
  const LABELS: Record<string, string> = { plataforma: 'Plataforma', microfone: 'Microfone' };
  const ctx = {
    nameOf: (userId: string) => NAMES[userId] ?? userId,
    squadSize: 2,
    maxSquadsPerUser: 3,
    cooldownDays: 7,
    fieldLabel: (key: string) => LABELS[key] ?? key,
    squadOf: (userId: string) => (userId === ANA ? 'Alfa' : null),
  };

  it.each<[SquadManualIssue['code'], string[], string]>([
    ['PROFILE_NOT_FOUND', [ANA], 'Ana não tem perfil neste jogo.'],
    ['NOT_IN_GUILD', [BIA], 'Bia não está mais no servidor.'],
    [
      'IN_SQUAD_IN_GAME',
      [ANA],
      'Ana já está num squad deste jogo (Alfa). Tire do squad antes de propor.',
    ],
    ['IN_OPEN_PROPOSAL', [BIA], 'Bia já está numa proposta aberta deste jogo.'],
    [
      'NO_COMMON_CELL',
      [ANA, BIA],
      'Ninguém do grupo divide o mesmo horário. Sem isso a proposta fica sem janela.',
    ],
    [
      'GROUP_OVER_SIZE',
      [ANA, BIA, CAIO],
      'A turma é maior que o squad (3 de 2): quem aceitar primeiro fica com as vagas.',
    ],
    ['NOT_SEARCHING', [CAIO], 'O perfil de Caio está pausado, não procurando.'],
    [
      'AT_SQUAD_LIMIT',
      [BIA],
      'Bia já está no máximo de squads do servidor (3). Se aceitar, o bot só deixa entrar depois que sair de outro.',
    ],
    ['PAIR_COOLDOWN', [ANA, BIA], 'Ana e Bia receberam proposta juntos há menos de 7 dias.'],
    ['PENDING_JOIN_REQUEST', [CAIO], 'Caio tem um pedido de entrada esperando resposta.'],
  ])('%s', (code, userIds, text) => {
    expect(describeManualIssue({ code, userIds }, ctx)).toBe(text);
  });

  it('não inventa o nome do squad quando o painel não conhece', () => {
    expect(describeManualIssue({ code: 'IN_SQUAD_IN_GAME', userIds: [BIA] }, ctx)).toBe(
      'Bia já está num squad deste jogo. Tire do squad antes de propor.',
    );
  });

  it('lista os campos que precisam bater e concorda o verbo', () => {
    const issue = { code: 'HARD_MISMATCH' as const, userIds: [ANA, BIA] };

    expect(describeManualIssue({ ...issue, fieldKeys: ['plataforma'] }, ctx)).toBe(
      'Ana e Bia responderam diferente em Plataforma, que precisa bater.',
    );
    expect(describeManualIssue({ ...issue, fieldKeys: ['plataforma', 'microfone'] }, ctx)).toBe(
      'Ana e Bia responderam diferente em Plataforma e Microfone, que precisam bater.',
    );
  });

  it('fala em dia no singular', () => {
    expect(
      describeManualIssue({ code: 'PAIR_COOLDOWN', userIds: [ANA, BIA] }, { ...ctx, cooldownDays: 1 }),
    ).toBe('Ana e Bia receberam proposta juntos há menos de 1 dia.');
  });

  it('tem texto para todo código, sem travessão', () => {
    for (const code of MANUAL_MATCH_ISSUE_CODES) {
      const text = describeManualIssue({ code, userIds: [ANA, BIA], fieldKeys: ['plataforma'] }, ctx);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('—');
    }
  });
});

describe('formatSquadWindow', () => {
  it('escreve dia, faixa e horário', () => {
    expect(formatSquadWindow(6, 2, BLOCKS)).toBe('SÁB · NOITE 18H ÀS 24H');
  });

  it('diz de que noite é a madrugada, inclusive virando a semana', () => {
    expect(formatSquadWindow(0, 3, BLOCKS)).toBe('DOM · MADRUGADA 0H ÀS 6H (NOITE DE SÁB)');
  });
});

describe('summarizeAvailability', () => {
  it('avisa grade vazia', () => {
    expect(summarizeAvailability(0, BLOCKS)).toBe('SEM HORÁRIO');
  });

  it('mostra as primeiras faixas e conta o resto', () => {
    const mask = toBits([
      { day: 1, block: 2 },
      { day: 3, block: 2 },
      { day: 5, block: 2 },
      { day: 6, block: 2 },
    ]);
    expect(summarizeAvailability(mask, BLOCKS)).toBe('SEG NOITE · QUA NOITE · +2');
  });
});

describe('formatDate e formatDateTime', () => {
  // 00:30 UTC de segunda é 21:30 de domingo em São Paulo.
  const iso = '2026-09-14T00:30:00.000Z';

  it('usam o fuso da guild, não o do processo', () => {
    expect(formatDate(iso, 'America/Sao_Paulo')).toBe('13/09/2026');
    expect(formatDateTime(iso, 'America/Sao_Paulo')).toBe('13/09 21:30');
    expect(formatDateTime(iso, 'UTC')).toBe('14/09 00:30');
  });
});

describe('fieldKeyFromLabel', () => {
  it.each([
    ['Plataforma de jogo', 'plataforma_de_jogo'],
    ['Dificuldade (1-10)', 'dificuldade_1_10'],
    ['Ação!', 'acao'],
    ['!!!', 'campo'],
    ['Constructor', 'constructor_1'],
  ])('%s vira %s', (label, key) => {
    expect(fieldKeyFromLabel(label)).toBe(key);
  });

  it('sempre sai uma chave que o schema aceita', () => {
    for (const label of ['Constructor', 'x'.repeat(80), '  Qual é o seu mic?  ', '___']) {
      expect(SquadFieldKeySchema.safeParse(fieldKeyFromLabel(label)).success).toBe(true);
    }
  });
});

describe('withFieldKeys', () => {
  it('não mexe em chave escrita e não repete a gerada', () => {
    const fields = withFieldKeys([
      { key: 'plataforma', label: 'Onde joga' },
      { key: '', label: 'Plataforma' },
      { key: '', label: 'Plataforma' },
    ]);
    expect(fields.map((field) => field.key)).toEqual(['plataforma', 'plataforma_2', 'plataforma_3']);
  });
});

describe('parseOptionLines', () => {
  it('tira espaço e linha em branco, mas mantém repetida para o schema apontar', () => {
    expect(parseOptionLines(' PC \n\nPS5\nPC\n')).toEqual(['PC', 'PS5', 'PC']);
  });
});

describe('formatMatchResult', () => {
  it('explica a passada vazia', () => {
    expect(formatMatchResult({ proposals: 0, joinRequests: 0 })).toMatch(/^Nenhum par novo/);
  });

  it('conta propostas e pedidos no singular e no plural', () => {
    expect(formatMatchResult({ proposals: 1, joinRequests: 0 })).toBe('1 proposta aberta.');
    expect(formatMatchResult({ proposals: 2, joinRequests: 3 })).toBe(
      '2 propostas abertas e 3 pedidos de entrada.',
    );
  });
});
