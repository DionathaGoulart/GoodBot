import { describe, expect, it } from 'vitest';

import {
  keepButtonId,
  leaveButtonId,
  MAX_CUSTOM_ID_LENGTH,
  parseSquadCustomId,
  profileStartButtonId,
  proposalButtonId,
  requestButtonId,
  sessionButtonId,
} from './ids';

const UUID = '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';

describe('custom_id de squads', () => {
  it.each([
    [proposalButtonId('accept', UUID), { kind: 'proposal', action: 'accept', proposalId: UUID }],
    [proposalButtonId('decline', UUID), { kind: 'proposal', action: 'decline', proposalId: UUID }],
    [requestButtonId('accept', UUID), { kind: 'request', action: 'accept', requestId: UUID }],
    [requestButtonId('decline', UUID), { kind: 'request', action: 'decline', requestId: UUID }],
    [sessionButtonId('going', 42), { kind: 'session', action: 'going', sessionId: 42 }],
    [sessionButtonId('notgoing', 7), { kind: 'session', action: 'notgoing', sessionId: 7 }],
    [keepButtonId(UUID), { kind: 'keep', squadId: UUID }],
    [leaveButtonId(UUID), { kind: 'leave', squadId: UUID }],
    [profileStartButtonId(UUID), { kind: 'profile-start', gameId: UUID }],
  ])('%s vai e volta', (id, parsed) => {
    expect(id.length).toBeLessThanOrEqual(MAX_CUSTOM_ID_LENGTH);
    expect(parseSquadCustomId(id)).toEqual(parsed);
  });

  it.each([
    '',
    'squad',
    'squad:proposal:accept',
    `squad:proposal:maybe:${UUID}`,
    'squad:proposal:accept:nao-e-uuid',
    `ticket:proposal:accept:${UUID}`,
    `squad:proposal:accept:${UUID}:extra`,
    'squad:session:going:0',
    'squad:session:going:-1',
    'squad:session:going:abc',
    'squad:session:going:12345678901234567',
    `squad:keep:${UUID}:extra`,
    'squad:leave:',
    `squad:profile:stop:${UUID}`,
    `squad:unknown:${UUID}`,
    `squad:proposal:accept:${'a'.repeat(120)}`,
  ])('recusa %j', (id) => {
    expect(parseSquadCustomId(id)).toBeNull();
  });

  it('os builders recusam id que não é uuid nem sessão válida', () => {
    expect(() => proposalButtonId('accept', 'x')).toThrow(RangeError);
    expect(() => keepButtonId('')).toThrow(RangeError);
    expect(() => sessionButtonId('going', 0)).toThrow(RangeError);
    expect(() => sessionButtonId('going', 1.5)).toThrow(RangeError);
  });
});
