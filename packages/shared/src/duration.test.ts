import { describe, expect, it } from 'vitest';

import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from './constants';
import { formatDuration, parseDuration } from './duration';

describe('parseDuration', () => {
  it('converte unidades simples', () => {
    expect(parseDuration('30s')).toBe(30 * SECOND_MS);
    expect(parseDuration('5m')).toBe(5 * MINUTE_MS);
    expect(parseDuration('2h')).toBe(2 * HOUR_MS);
    expect(parseDuration('3d')).toBe(3 * DAY_MS);
    expect(parseDuration('1w')).toBe(7 * DAY_MS);
  });

  it('aceita combinações, espaços, maiúsculas e decimais', () => {
    expect(parseDuration('1h30m')).toBe(HOUR_MS + 30 * MINUTE_MS);
    expect(parseDuration('1d 2h 3m 4s')).toBe(DAY_MS + 2 * HOUR_MS + 3 * MINUTE_MS + 4 * SECOND_MS);
    expect(parseDuration(' 10M ')).toBe(10 * MINUTE_MS);
    expect(parseDuration('1.5h')).toBe(90 * MINUTE_MS);
    expect(parseDuration('1h1h')).toBe(2 * HOUR_MS);
  });

  it('rejeita entradas inválidas', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('10')).toBeNull();
    expect(parseDuration('10x')).toBeNull();
    expect(parseDuration('1h abc')).toBeNull();
    expect(parseDuration('-1h')).toBeNull();
    expect(parseDuration('0s')).toBeNull();
    expect(parseDuration(undefined as unknown as string)).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formata em estilo curto com até 2 unidades', () => {
    expect(formatDuration(HOUR_MS + 30 * MINUTE_MS)).toBe('1h 30m');
    expect(formatDuration(DAY_MS + 2 * HOUR_MS + 3 * MINUTE_MS)).toBe('1d 2h');
    expect(formatDuration(14 * DAY_MS)).toBe('14d');
    expect(formatDuration(45 * SECOND_MS)).toBe('45s');
  });

  it('respeita maxUnits', () => {
    expect(formatDuration(DAY_MS + 2 * HOUR_MS + 3 * MINUTE_MS, { maxUnits: 3 })).toBe('1d 2h 3m');
    expect(formatDuration(DAY_MS + 2 * HOUR_MS, { maxUnits: 1 })).toBe('1d');
  });

  it('formata em estilo longo em pt-BR', () => {
    expect(formatDuration(HOUR_MS, { style: 'long' })).toBe('1 hora');
    expect(formatDuration(HOUR_MS + 30 * MINUTE_MS, { style: 'long' })).toBe('1 hora e 30 minutos');
    expect(formatDuration(2 * DAY_MS + HOUR_MS + MINUTE_MS, { style: 'long', maxUnits: 3 })).toBe(
      '2 dias, 1 hora e 1 minuto',
    );
  });

  it('trata valores menores que 1s e inválidos como zero', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(500)).toBe('0s');
    expect(formatDuration(Number.NaN, { style: 'long' })).toBe('0 segundos');
  });

  it('faz roundtrip com parseDuration', () => {
    const ms = parseDuration('2d 5h')!;
    expect(formatDuration(ms)).toBe('2d 5h');
  });
});
