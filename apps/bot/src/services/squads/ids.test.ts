import { SQUAD_AVAILABILITY_MAX } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import {
  boraButtonId,
  boraModalId,
  confirmLeaveButtonId,
  gridSaveButtonId,
  gridSelectId,
  joinButtonId,
  keepButtonId,
  leaveButtonId,
  MAX_CUSTOM_ID_LENGTH,
  parseSquadCustomId,
  profileModalId,
  profileStartButtonId,
  proposalButtonId,
  renameButtonId,
  renameModalId,
  requestButtonId,
  searchButtonId,
  sessionButtonId,
  statusButtonId,
} from './ids';

const UUID = '0b6f4c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e';
const FULL = SQUAD_AVAILABILITY_MAX;

describe('custom_id de squads', () => {
  it.each([
    [proposalButtonId('accept', UUID), { kind: 'proposal', action: 'accept', proposalId: UUID }],
    [proposalButtonId('decline', UUID), { kind: 'proposal', action: 'decline', proposalId: UUID }],
    [requestButtonId('accept', UUID), { kind: 'request', action: 'accept', requestId: UUID }],
    [requestButtonId('decline', UUID), { kind: 'request', action: 'decline', requestId: UUID }],
    [sessionButtonId('going', 42), { kind: 'session', action: 'going', sessionId: 42 }],
    [sessionButtonId('notgoing', 7), { kind: 'session', action: 'notgoing', sessionId: 7 }],
    [sessionButtonId('cancel', 7), { kind: 'session', action: 'cancel', sessionId: 7 }],
    [sessionButtonId('repeat', 9), { kind: 'session', action: 'repeat', sessionId: 9 }],
    [boraButtonId(UUID), { kind: 'bora-open', squadId: UUID }],
    [boraModalId(UUID), { kind: 'bora-modal', squadId: UUID }],
    [renameButtonId(UUID), { kind: 'rename-open', squadId: UUID }],
    [renameModalId(UUID), { kind: 'rename-modal', squadId: UUID }],
    [searchButtonId(UUID), { kind: 'search', gameId: UUID }],
    [keepButtonId(UUID), { kind: 'keep', squadId: UUID }],
    [leaveButtonId(UUID), { kind: 'leave', squadId: UUID }],
    [confirmLeaveButtonId(UUID), { kind: 'leave-confirm', squadId: UUID }],
    [joinButtonId(UUID), { kind: 'join', squadId: UUID }],
    [profileStartButtonId(UUID), { kind: 'profile-start', gameId: UUID }],
    [profileModalId(UUID), { kind: 'profile-modal', gameId: UUID }],
    [gridSelectId(UUID, 0, 0), { kind: 'grid-set', gameId: UUID, block: 0, mask: 0 }],
    [gridSelectId(UUID, 3, FULL), { kind: 'grid-set', gameId: UUID, block: 3, mask: FULL }],
    [gridSaveButtonId(UUID, 1234), { kind: 'grid-save', gameId: UUID, mask: 1234 }],
    [statusButtonId('searching', UUID), { kind: 'status', status: 'searching', gameId: UUID }],
    [statusButtonId('paused', UUID), { kind: 'status', status: 'paused', gameId: UUID }],
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
    'squad:session:maybe:3',
    `squad:bora:start:${UUID}`,
    `squad:bora:open:${UUID}:extra`,
    'squad:rename:modal:nao-e-uuid',
    `squad:search:${UUID}:extra`,
    'squad:search:nao-e-uuid',
    `squad:keep:${UUID}:extra`,
    'squad:leave:',
    `squad:quit:${UUID}:extra`,
    'squad:join:nao-e-uuid',
    `squad:profile:stop:${UUID}`,
    `squad:profile:modal:${UUID}:extra`,
    `squad:grid:set:4:${UUID}:1`,
    `squad:grid:set:1:${UUID}:${String(FULL + 1)}`,
    `squad:grid:set:1:${UUID}:01`,
    `squad:grid:set:1:${UUID}`,
    `squad:grid:set:x:${UUID}:1`,
    `squad:grid:save:${UUID}`,
    `squad:grid:save:${UUID}:-1`,
    `squad:grid:save:${UUID}:1:extra`,
    `squad:grid:clear:${UUID}:1`,
    `squad:status:done:${UUID}`,
    `squad:status:in_squad:${UUID}`,
    `squad:unknown:${UUID}`,
    `squad:proposal:accept:${'a'.repeat(120)}`,
  ])('recusa %j', (id) => {
    expect(parseSquadCustomId(id)).toBeNull();
  });

  it('os builders recusam id, faixa ou máscara fora do formato', () => {
    expect(() => proposalButtonId('accept', 'x')).toThrow(RangeError);
    expect(() => keepButtonId('')).toThrow(RangeError);
    expect(() => sessionButtonId('going', 0)).toThrow(RangeError);
    expect(() => sessionButtonId('going', 1.5)).toThrow(RangeError);
    expect(() => gridSelectId(UUID, 4, 0)).toThrow(RangeError);
    expect(() => gridSaveButtonId(UUID, -1)).toThrow(RangeError);
    expect(() => gridSaveButtonId(UUID, FULL + 1)).toThrow(RangeError);
    expect(() => statusButtonId('paused', 'x')).toThrow(RangeError);
  });
});
