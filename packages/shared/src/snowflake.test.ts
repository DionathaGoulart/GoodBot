import { describe, expect, it } from 'vitest';

import { dateToSnowflake, isSnowflake, snowflakeToDate } from './snowflake';

describe('isSnowflake', () => {
  it('aceita ids de 17 a 20 dígitos', () => {
    expect(isSnowflake('80351110224678912')).toBe(true);
    expect(isSnowflake('1234567890123456789')).toBe(true);
    expect(isSnowflake('12345678901234567890')).toBe(true);
  });

  it('rejeita números, strings curtas e não numéricas', () => {
    expect(isSnowflake(80351110224678912)).toBe(false);
    expect(isSnowflake('1234')).toBe(false);
    expect(isSnowflake('123456789012345678901')).toBe(false);
    expect(isSnowflake('80351110224678a12')).toBe(false);
    expect(isSnowflake('')).toBe(false);
    expect(isSnowflake(null)).toBe(false);
  });
});

describe('snowflakeToDate', () => {
  it('decodifica o timestamp do exemplo da documentação do Discord', () => {
    // https://discord.com/developers/docs/reference#snowflakes
    expect(snowflakeToDate('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
  });

  it('lança para entrada inválida', () => {
    expect(() => snowflakeToDate('abc')).toThrow(TypeError);
  });
});

describe('dateToSnowflake', () => {
  it('faz roundtrip com snowflakeToDate', () => {
    const date = new Date('2024-06-01T12:00:00.000Z');
    expect(snowflakeToDate(dateToSnowflake(date)).getTime()).toBe(date.getTime());
  });

  it('rejeita datas antes do epoch', () => {
    expect(() => dateToSnowflake(new Date('2010-01-01T00:00:00Z'))).toThrow(RangeError);
  });
});
