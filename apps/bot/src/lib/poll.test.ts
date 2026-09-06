import { describe, expect, it } from 'vitest';

import { BAR_WIDTH, formatBar, formatTally, parsePollOptions, tallyPoll } from './poll';

import type { PollOption } from '@cobot/db';

const options: PollOption[] = [
  { id: '0', label: 'Sim' },
  { id: '1', label: 'Não' },
  { id: '2', label: 'Tanto faz' },
];

describe('tallyPoll', () => {
  it('conta um voto por opção marcada e um votante por pessoa', () => {
    const result = tallyPoll(options, { a: ['0'], b: ['0'], c: ['1'] });
    expect(result.totalVotes).toBe(3);
    expect(result.totalVoters).toBe(3);
    expect(result.tallies.map((tally) => tally.votes)).toEqual([2, 1, 0]);
    expect(result.tallies.map((tally) => tally.percent)).toEqual([67, 33, 0]);
  });

  it('em múltipla escolha, um votante soma em cada opção marcada', () => {
    const result = tallyPoll(options, { a: ['0', '1'], b: ['1'] });
    expect(result.totalVotes).toBe(3);
    expect(result.totalVoters).toBe(2);
    expect(result.tallies.map((tally) => tally.votes)).toEqual([1, 2, 0]);
  });

  it('ignora votos duplicados e votos em opções que não existem mais', () => {
    const result = tallyPoll(options, { a: ['0', '0'], b: ['99'] });
    expect(result.totalVotes).toBe(1);
    // O votante `b` só marcou uma opção inexistente: não conta como votante.
    expect(result.totalVoters).toBe(1);
  });

  it('sem votos, tudo é zero e ninguém lidera', () => {
    const result = tallyPoll(options, {});
    expect(result.totalVotes).toBe(0);
    expect(result.tallies.every((tally) => tally.percent === 0)).toBe(true);
    expect(result.tallies.some((tally) => tally.leading)).toBe(false);
  });

  it('marca empate como liderança das duas opções', () => {
    const result = tallyPoll(options, { a: ['0'], b: ['1'] });
    expect(result.tallies.map((tally) => tally.leading)).toEqual([true, true, false]);
  });
});

describe('formatBar', () => {
  it('preenche proporcionalmente e mantém a largura fixa', () => {
    expect(formatBar(0)).toBe('░'.repeat(BAR_WIDTH));
    expect(formatBar(100)).toBe('█'.repeat(BAR_WIDTH));
    expect(formatBar(50)).toBe(`${'█'.repeat(6)}${'░'.repeat(6)}`);
    expect(formatBar(67)).toHaveLength(BAR_WIDTH);
  });

  it('trata porcentagens fora da faixa sem quebrar a barra', () => {
    expect(formatBar(-10)).toHaveLength(BAR_WIDTH);
    expect(formatBar(140)).toBe('█'.repeat(BAR_WIDTH));
  });
});

describe('formatTally', () => {
  it('destaca a opção líder e mostra barra, porcentagem e votos', () => {
    const [first, , third] = tallyPoll(options, { a: ['0'] }).tallies;
    expect(formatTally(first!)).toContain('**Sim**');
    expect(formatTally(first!)).toContain('100% · 1 voto(s)');
    expect(formatTally(third!)).toContain('Tanto faz');
    expect(formatTally(third!)).not.toContain('**Tanto faz**');
  });
});

describe('parsePollOptions', () => {
  it('separa por barra, apara espaços e mantém a ordem', () => {
    expect(parsePollOptions(' Sim | Não |Tanto faz ')).toEqual([
      { id: '0', label: 'Sim' },
      { id: '1', label: 'Não' },
      { id: '2', label: 'Tanto faz' },
    ]);
  });

  it('remove duplicadas ignorando maiúsculas', () => {
    expect(parsePollOptions('Sim | sim | Não')).toHaveLength(2);
  });

  it('rejeita menos de 2 e mais de 10 opções', () => {
    expect(parsePollOptions('Só uma')).toEqual([]);
    expect(parsePollOptions('a|||b')).toHaveLength(2);
    expect(parsePollOptions(Array.from({ length: 11 }, (_, i) => `o${i}`).join('|'))).toEqual([]);
  });
});
