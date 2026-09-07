/**
 * Geração de CSV para o export de casos (PRD §6.4). Puro e sem `server-only`
 * porque é o que os testes exercitam; quem monta as linhas é o route handler.
 */

/** O Excel só entende UTF-8 num arquivo `.csv` se ele começar com o BOM. */
export const UTF8_BOM = '﻿';

const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Uma célula. Aspas dobram; qualquer separador ou quebra força o campo entre
 * aspas. O `\t` na frente de nada — snowflake vai como texto entre aspas, que
 * já basta para o Excel não transformar em notação científica.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!NEEDS_QUOTES.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}

/** Primeiro pedaço do arquivo: BOM (o Excel só lê UTF-8 com ele) + cabeçalho. */
export function csvHeader(headers: readonly string[]): string {
  return `${UTF8_BOM}${csvRow(headers)}\r\n`;
}

/** Um bloco de linhas, cada uma terminada em CRLF — colável no anterior. */
export function csvBody(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => `${csvRow(row)}\r\n`).join('');
}

/** Arquivo completo de uma vez; o export grande usa `csvHeader`/`csvBody`. */
export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `${csvHeader(headers)}${csvBody(rows)}`;
}
