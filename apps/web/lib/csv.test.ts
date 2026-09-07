import { describe, expect, it } from 'vitest';

import { csvCell, toCsv, UTF8_BOM } from './csv';

describe('csvCell', () => {
  it('deixa passar o que não precisa de aspas', () => {
    expect(csvCell('spam no geral')).toBe('spam no geral');
    expect(csvCell(42)).toBe('42');
  });

  it('vazio para null e undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('escapa vírgula, aspas e quebra de linha', () => {
    expect(csvCell('spam, flood')).toBe('"spam, flood"');
    expect(csvCell('disse "oi"')).toBe('"disse ""oi"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('data vira ISO', () => {
    expect(csvCell(new Date('2026-09-06T12:00:00.000Z'))).toBe('2026-09-06T12:00:00.000Z');
  });
});

describe('toCsv', () => {
  it('começa com BOM para o Excel abrir os acentos certos', () => {
    const csv = toCsv(['motivo'], [['ofensa à moderação']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain('ofensa à moderação');
  });

  it('separa as linhas com CRLF e termina com quebra', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(csv).toBe(`${UTF8_BOM}a,b\r\n1,2\r\n3,4\r\n`);
  });
});
