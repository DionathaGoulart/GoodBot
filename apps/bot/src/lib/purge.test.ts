import { BULK_DELETE_MAX_AGE_MS } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import {
  chunk,
  describeFilters,
  isBulkDeletable,
  matchesPurgeFilters,
  splitByAge,
} from './purge';

import type { PurgeCandidate } from './purge';

const NOW = Date.UTC(2026, 8, 6);

function message(overrides: Partial<PurgeCandidate> = {}): PurgeCandidate {
  return {
    id: '900000000000000000',
    content: 'olá mundo',
    createdTimestamp: NOW,
    pinned: false,
    author: { id: '111', bot: false },
    attachments: { size: 0 },
    embeds: [],
    ...overrides,
  };
}

describe('matchesPurgeFilters', () => {
  it('sem filtros, pega qualquer mensagem não fixada', () => {
    expect(matchesPurgeFilters(message(), {})).toBe(true);
    expect(matchesPurgeFilters(message({ pinned: true }), {})).toBe(false);
  });

  it('inclui as fixadas quando `keepPinned` é falso', () => {
    expect(matchesPurgeFilters(message({ pinned: true }), { keepPinned: false })).toBe(true);
  });

  it('filtra por autor', () => {
    expect(matchesPurgeFilters(message(), { userId: '111' })).toBe(true);
    expect(matchesPurgeFilters(message(), { userId: '222' })).toBe(false);
  });

  it('filtra só bots', () => {
    expect(matchesPurgeFilters(message(), { botsOnly: true })).toBe(false);
    expect(matchesPurgeFilters(message({ author: { id: '1', bot: true } }), { botsOnly: true })).toBe(
      true,
    );
  });

  it('procura o texto sem diferenciar maiúsculas', () => {
    expect(matchesPurgeFilters(message(), { contains: 'MUNDO' })).toBe(true);
    expect(matchesPurgeFilters(message(), { contains: 'adeus' })).toBe(false);
  });

  it('filtra por link e por anexo/embed', () => {
    expect(matchesPurgeFilters(message(), { linksOnly: true })).toBe(false);
    expect(
      matchesPurgeFilters(message({ content: 'veja https://exemplo.com' }), { linksOnly: true }),
    ).toBe(true);
    expect(matchesPurgeFilters(message(), { attachmentsOnly: true })).toBe(false);
    expect(matchesPurgeFilters(message({ attachments: { size: 1 } }), { attachmentsOnly: true })).toBe(
      true,
    );
    expect(matchesPurgeFilters(message({ embeds: [{}] }), { attachmentsOnly: true })).toBe(true);
  });

  it('compara snowflakes como números, não como texto', () => {
    // '99…' é mais curto e seria "maior" numa comparação de strings.
    const older = message({ id: '99999999999999999' });
    expect(matchesPurgeFilters(older, { beforeId: '900000000000000000' })).toBe(true);
    expect(matchesPurgeFilters(older, { afterId: '900000000000000000' })).toBe(false);
  });

  it('combina filtros com E', () => {
    const filters = { userId: '111', contains: 'mundo' };
    expect(matchesPurgeFilters(message(), filters)).toBe(true);
    expect(matchesPurgeFilters(message({ author: { id: '222', bot: false } }), filters)).toBe(false);
  });
});

describe('splitByAge', () => {
  it('separa o que passa dos 14 dias do bulk delete', () => {
    const recent = message({ id: '1', createdTimestamp: NOW - 1_000 });
    const old = message({ id: '2', createdTimestamp: NOW - BULK_DELETE_MAX_AGE_MS - 1_000 });
    const { bulk, individual } = splitByAge([recent, old], NOW);
    expect(bulk).toEqual([recent]);
    expect(individual).toEqual([old]);
    expect(isBulkDeletable(old, NOW)).toBe(false);
  });
});

describe('chunk', () => {
  it('fatia em blocos do tamanho pedido, com o resto no fim', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});

describe('describeFilters', () => {
  it('descreve os filtros usados e diz quando não houve nenhum', () => {
    expect(describeFilters({})).toBe('nenhum');
    expect(describeFilters({ userId: '111', botsOnly: true })).toBe('autor <@111>, apenas bots');
  });
});
