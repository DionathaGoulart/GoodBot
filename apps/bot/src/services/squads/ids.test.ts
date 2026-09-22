import { SQUAD_AVAILABILITY_MAX } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import {
  boraButtonId,
  boraModalId,
  callButtonId,
  callNextButtonId,
  confirmLeaveButtonId,
  enterButtonId,
  gridSaveButtonId,
  gridSelectId,
  guestPickButtonId,
  guestUserSelectId,
  inviteButtonId,
  invitePickButtonId,
  inviteUserSelectId,
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
  rescheduleModalId,
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
    [requestButtonId('for', UUID), { kind: 'request', action: 'for', requestId: UUID }],
    [requestButtonId('against', UUID), { kind: 'request', action: 'against', requestId: UUID }],
    [inviteButtonId('accept', UUID), { kind: 'invite', action: 'accept', requestId: UUID }],
    [inviteButtonId('pass', UUID), { kind: 'invite', action: 'pass', requestId: UUID }],
    [invitePickButtonId(UUID), { kind: 'invite-pick', squadId: UUID }],
    [inviteUserSelectId(UUID), { kind: 'invite-user', squadId: UUID }],
    [sessionButtonId('going', 42), { kind: 'session', action: 'going', sessionId: 42 }],
    [sessionButtonId('notgoing', 7), { kind: 'session', action: 'notgoing', sessionId: 7 }],
    [sessionButtonId('cancel', 7), { kind: 'session', action: 'cancel', sessionId: 7 }],
    [sessionButtonId('repeat', 9), { kind: 'session', action: 'repeat', sessionId: 9 }],
    [sessionButtonId('reschedule', 9), { kind: 'session', action: 'reschedule', sessionId: 9 }],
    [rescheduleModalId(9), { kind: 'reschedule-modal', sessionId: 9 }],
    [callButtonId(11), { kind: 'call', sessionId: 11 }],
    [callNextButtonId(UUID), { kind: 'call-next', squadId: UUID }],
    [enterButtonId(12), { kind: 'enter', sessionId: 12 }],
    [guestPickButtonId(13), { kind: 'guest-pick', sessionId: 13 }],
    [guestUserSelectId(13), { kind: 'guest-user', sessionId: 13 }],
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

  it('os botões do pedido antigo (aceitar e recusar) viram voto', () => {
    expect(parseSquadCustomId(`squad:request:accept:${UUID}`)).toEqual({
      kind: 'request',
      action: 'for',
      requestId: UUID,
    });
    expect(parseSquadCustomId(`squad:request:decline:${UUID}`)).toEqual({
      kind: 'request',
      action: 'against',
      requestId: UUID,
    });
  });

  it.each([
    '',
    'squad',
    `squad:request:maybe:${UUID}`,
    `squad:request:constructor:${UUID}`,
    `squad:request:for:${UUID}:extra`,
    `squad:invite:decline:${UUID}`,
    'squad:invite:accept:nao-e-uuid',
    `squad:invite:pick:${UUID}:extra`,
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
    'squad:reschedule:open:3',
    'squad:reschedule:modal:0',
    'squad:reschedule:modal:3:extra',
    'squad:call:session:0',
    'squad:call:session:abc',
    'squad:call:session:3:extra',
    `squad:call:next:${UUID}:extra`,
    'squad:call:next:nao-e-uuid',
    'squad:call:squad:3',
    'squad:call:3',
    'squad:enter:0',
    'squad:enter:abc',
    'squad:enter:3:extra',
    'squad:guest:pick:0',
    'squad:guest:pick:abc',
    'squad:guest:user:3:extra',
    'squad:guest:kick:3',
    `squad:guest:pick:${UUID}`,
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
    expect(() => rescheduleModalId(0)).toThrow(RangeError);
    expect(() => callButtonId(0)).toThrow(RangeError);
    expect(() => callNextButtonId('x')).toThrow(RangeError);
    expect(() => enterButtonId(-3)).toThrow(RangeError);
    expect(() => guestPickButtonId(0)).toThrow(RangeError);
    expect(() => guestUserSelectId(2.5)).toThrow(RangeError);
    expect(() => gridSelectId(UUID, 4, 0)).toThrow(RangeError);
    expect(() => gridSaveButtonId(UUID, -1)).toThrow(RangeError);
    expect(() => gridSaveButtonId(UUID, FULL + 1)).toThrow(RangeError);
    expect(() => statusButtonId('paused', 'x')).toThrow(RangeError);
  });
});
