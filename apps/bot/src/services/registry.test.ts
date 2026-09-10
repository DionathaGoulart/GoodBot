import { describe, expect, it } from 'vitest';

import { RegistryService } from './registry';

import type { Db, GuildRegistryEntry } from '@goodbot/db';

const AGORA = new Date('2026-01-01T12:00:00Z');
const APROVADA = '111111111111111111';
const PENDENTE = '222222222222222222';
const DEMO = '333333333333333333';
const VENCIDA = '444444444444444444';

function entry(overrides: Partial<GuildRegistryEntry> & { guildId: string }): GuildRegistryEntry {
  return {
    status: 'pending',
    invitedBy: null,
    invitedAt: AGORA,
    approvedAt: null,
    expiresAt: null,
    demoWarnedAt: null,
    demoEndedAt: null,
    leftAt: null,
    note: null,
    createdAt: AGORA,
    updatedAt: AGORA,
    ...overrides,
  };
}

/** `listGuildRegistry` sem filtro é `db.select().from(...)` e nada mais. */
function fakeDb(rows: GuildRegistryEntry[]): Db {
  return { select: () => ({ from: () => Promise.resolve(rows) }) } as unknown as Db;
}

const rows = [
  entry({ guildId: APROVADA, status: 'approved', approvedAt: AGORA }),
  entry({ guildId: PENDENTE, status: 'pending' }),
  entry({ guildId: DEMO, status: 'demo', expiresAt: new Date(AGORA.getTime() + 60_000) }),
  entry({ guildId: VENCIDA, status: 'demo', expiresAt: new Date(AGORA.getTime() - 1) }),
];

async function service(): Promise<RegistryService> {
  const registry = new RegistryService({ db: fakeDb(rows), now: () => AGORA.getTime() });
  await registry.refresh();
  return registry;
}

describe('RegistryService', () => {
  it('atende aprovada e demo no prazo, e mais ninguém', async () => {
    const registry = await service();
    expect(registry.serves(APROVADA)).toBe(true);
    expect(registry.serves(DEMO)).toBe(true);
    expect(registry.serves(PENDENTE)).toBe(false);
    expect(registry.serves(VENCIDA)).toBe(false);
  });

  it('guild sem linha nenhuma não é atendida', async () => {
    const registry = await service();
    expect(registry.serves('555555555555555555')).toBe(false);
  });

  it('a lista atendida é a que o ready prepara', async () => {
    const registry = await service();
    expect(registry.servedGuildIds().sort()).toEqual([APROVADA, DEMO].sort());
    expect(registry.servedCount()).toBe(2);
  });

  it('a demo deixa de ser atendida quando o relógio passa do prazo', async () => {
    let agora = AGORA.getTime();
    const registry = new RegistryService({ db: fakeDb(rows), now: () => agora });
    await registry.refresh();
    expect(registry.serves(DEMO)).toBe(true);

    // Sem recarregar nada: o vencimento é conta, não estado.
    agora = AGORA.getTime() + 61_000;
    expect(registry.serves(DEMO)).toBe(false);
    expect(registry.servedGuildIds()).toEqual([APROVADA]);
  });

  it('recarregar troca o espelho inteiro, sem deixar linha órfã', async () => {
    const registry = new RegistryService({
      db: fakeDb([entry({ guildId: APROVADA, status: 'approved' })]),
      now: () => AGORA.getTime(),
    });
    await registry.refresh();
    await registry.refresh();
    expect(registry.servedGuildIds()).toEqual([APROVADA]);
    expect(registry.status(PENDENTE)).toBeUndefined();
  });
});
