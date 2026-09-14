import { DEFAULT_SQUAD_BLOCKS, SquadFieldKeySchema, toBits } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import {
  fieldKeyFromLabel,
  formatDate,
  formatDateTime,
  formatMatchResult,
  formatSquadWindow,
  parseOptionLines,
  summarizeAvailability,
  withFieldKeys,
} from './squad-labels';

const BLOCKS = DEFAULT_SQUAD_BLOCKS;

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
