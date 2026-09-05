/** Epoch do Discord: 2015-01-01T00:00:00.000Z. */
export const DISCORD_EPOCH_MS = 1_420_070_400_000n;

const SNOWFLAKE_RE = /^\d{17,20}$/;

/**
 * Verifica se a string é um snowflake plausível do Discord (17–20 dígitos).
 * IDs sempre trafegam como `string`; nunca `Number(snowflake)`.
 */
export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE_RE.test(value);
}

/** Extrai a data de criação embutida em um snowflake. */
export function snowflakeToDate(snowflake: string): Date {
  if (!isSnowflake(snowflake)) {
    throw new TypeError(`Snowflake inválido: ${String(snowflake)}`);
  }
  const ms = (BigInt(snowflake) >> 22n) + DISCORD_EPOCH_MS;
  return new Date(Number(ms));
}

/** Gera o menor snowflake possível para um instante (útil em filtros `after`). */
export function dateToSnowflake(date: Date): string {
  const ms = BigInt(date.getTime()) - DISCORD_EPOCH_MS;
  if (ms < 0n) throw new RangeError('Data anterior ao epoch do Discord');
  return (ms << 22n).toString();
}
