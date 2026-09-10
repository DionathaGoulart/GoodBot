import { describe, expect, it, vi } from 'vitest';

import { AuditService, type AuditDeps } from './audit';

import type { Db } from '@goodbot/db';

/** `db.insert(...).values(...).returning()` — o mínimo que o `appendAudit` usa. */
function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (input: Record<string, unknown>) => ({
        returning: () => {
          rows.push(input);
          return Promise.resolve([{ id: rows.length, ...input }]);
        },
      }),
    }),
  } as unknown as Db;
  return { db, rows };
}

const client = {
  user: { id: '999', tag: 'Goodbot#0001' },
  users: { cache: new Map([['111', { tag: 'membro#1234' }]]) },
} as unknown as AuditDeps['client'];

describe('AuditService', () => {
  it('grava com origem, motivo e alvo', async () => {
    const { db, rows } = fakeDb();
    await new AuditService({ db, client }).write({
      guildId: '1',
      action: 'automod.words',
      source: 'automod',
      actor: { id: '111', tag: 'membro#1234' },
      target: { type: 'member', id: '111' },
      reason: 'Palavras: palavrão',
      after: { actions: ['delete'] },
    });

    expect(rows[0]).toMatchObject({
      guildId: '1',
      action: 'automod.words',
      source: 'automod',
      actorId: '111',
      actorTag: 'membro#1234',
      targetType: 'member',
      targetId: '111',
      reason: 'Palavras: palavrão',
      // Só o painel tem requisição HTTP; o bot não.
      ip: null,
      userAgent: null,
    });
  });

  it('sem ator, quem assina é o próprio bot', async () => {
    const { db, rows } = fakeDb();
    await new AuditService({ db, client }).write({
      guildId: '1',
      action: 'autorole.apply',
      source: 'event',
      target: { type: 'member', id: '222' },
    });

    expect(rows[0]).toMatchObject({ actorId: '999', actorTag: 'Goodbot#0001', reason: null });
  });

  it('um id solto vira tag pelo cache, e um id fora dele vira ele mesmo', async () => {
    const { db, rows } = fakeDb();
    const audit = new AuditService({ db, client });

    await audit.write({ guildId: '1', action: 'ticket.open', source: 'event', actor: '111' });
    await audit.write({ guildId: '1', action: 'ticket.close', source: 'event', actor: '333' });

    expect(rows[0]).toMatchObject({ actorId: '111', actorTag: 'membro#1234' });
    expect(rows[1]).toMatchObject({ actorId: '333', actorTag: '333' });
  });

  it('nunca propaga o erro: auditar não pode derrubar o que está sendo auditado', async () => {
    const db = {
      insert: () => ({
        values: () => ({ returning: () => Promise.reject(new Error('postgres fora')) }),
      }),
    } as unknown as Db;

    const audit = new AuditService({ db, client });
    await expect(
      audit.write({ guildId: '1', action: 'x', source: 'job' }),
    ).resolves.toBeUndefined();
    expect(() => audit.record({ guildId: '1', action: 'x', source: 'job' })).not.toThrow();
  });

  it('sem client, o ator padrão ainda é um snowflake gravável', async () => {
    const { db, rows } = fakeDb();
    await new AuditService({ db }).write({ guildId: '1', action: 'x', source: 'job' });
    expect(rows[0]).toMatchObject({ actorId: '0', actorTag: 'Goodbot' });
  });
});

describe('record', () => {
  it('devolve na hora e grava em segundo plano', async () => {
    const { db, rows } = fakeDb();
    const audit = new AuditService({ db, client });

    // `void`, não `Promise`: o caminho quente não espera a auditoria.
    expect(audit.record({ guildId: '1', action: 'social.announce.youtube', source: 'job' })).toBe(
      undefined,
    );
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({ action: 'social.announce.youtube', source: 'job' });
  });
});
