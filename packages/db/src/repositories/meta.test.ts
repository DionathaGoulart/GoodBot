import { describe, expect, it } from 'vitest';

import { getMaintenance } from './meta';

import type { DbExecutor } from '../client';

/** O mínimo do encadeamento que o `getMeta` percorre. */
function fakeDb(value: unknown): DbExecutor {
  const rows = value === undefined ? [] : [{ key: 'maintenance', value }];
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as DbExecutor;
}

/**
 * A manutenção é lida em toda interação. O que estes testes fixam é o padrão
 * de falha: **qualquer** coisa estranha na chave devolve "desligada". O
 * contrário — um `jsonb` corrompido travando o bot para todo mundo — faria a
 * falha custar mais do que o dado que a causou.
 */
describe('getMaintenance', () => {
  it('chave ausente é manutenção desligada', async () => {
    await expect(getMaintenance(fakeDb(undefined))).resolves.toEqual({
      enabled: false,
      message: null,
      since: null,
      by: null,
    });
  });

  it('devolve o que foi gravado', async () => {
    const gravado = {
      enabled: true,
      message: 'volto já',
      since: '2026-01-01T00:00:00.000Z',
      by: '100000000000000001',
    };
    await expect(getMaintenance(fakeDb(gravado))).resolves.toEqual(gravado);
  });

  it('valor sem `enabled` booleano cai em desligada', async () => {
    await expect(getMaintenance(fakeDb({ enabled: 'sim' }))).resolves.toMatchObject({
      enabled: false,
    });
    await expect(getMaintenance(fakeDb('ligado'))).resolves.toMatchObject({ enabled: false });
    await expect(getMaintenance(fakeDb(null))).resolves.toMatchObject({ enabled: false });
  });

  it('campos de tipo errado viram nulo sem derrubar a leitura', async () => {
    await expect(getMaintenance(fakeDb({ enabled: true, message: 42, by: [] }))).resolves.toEqual({
      enabled: true,
      message: null,
      since: null,
      by: null,
    });
  });
});
