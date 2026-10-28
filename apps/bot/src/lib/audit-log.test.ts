import { AuditLogEvent, Collection } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findAuditEntry } from './audit-log';

import type { Guild } from 'discord.js';

function guild(entries: unknown[]) {
  return {
    id: 'audit-tests',
    members: { me: { permissions: { has: () => true } } },
    fetchAuditLogs: vi
      .fn()
      .mockResolvedValue({ entries: new Collection(entries.map((e, i) => [String(i), e])) }),
  } as unknown as Guild;
}
const entry = (id: string) => ({
  id,
  targetId: 'member',
  target: null,
  createdTimestamp: Date.now(),
  executor: { id: 'mod' },
  reason: null,
  changes: [],
});

afterEach(() => vi.useRealTimers());
describe('correlação do audit log', () => {
  it('não escolhe um executor quando há duas entradas compatíveis', async () => {
    const result = await findAuditEntry({
      guild: guild([entry('a'), entry('b')]),
      type: AuditLogEvent.MemberUpdate,
      targetId: 'member',
    });
    expect(result.executor).toBeNull();
  });
  it('usa o delta esperado e não reutiliza a mesma entrada', async () => {
    const g = guild([entry('delta-a'), entry('delta-b')]);
    const lookup = {
      guild: g,
      type: AuditLogEvent.MemberUpdate,
      targetId: 'member',
      matches: (candidate: { id: string }) => candidate.id === 'delta-b',
    };
    expect((await findAuditEntry(lookup)).executor?.id).toBe('mod');
    expect((await findAuditEntry(lookup)).executor).toBeNull();
  });
  it('aguarda propagação dentro do teto de tempo', async () => {
    vi.useFakeTimers();
    const g = guild([entry('delayed')]);
    vi.mocked(g.fetchAuditLogs).mockResolvedValueOnce({ entries: new Collection() } as never);
    const pending = findAuditEntry({ guild: g, type: AuditLogEvent.MemberUpdate });
    await vi.advanceTimersByTimeAsync(250);
    expect((await pending).executor?.id).toBe('mod');
  });
});
