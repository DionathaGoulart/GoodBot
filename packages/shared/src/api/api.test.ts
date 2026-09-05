import { describe, expect, it } from 'vitest';

import { MAX_TIMEOUT_MS } from '../constants';
import { InvalidateInputSchema } from './config';
import { MemberSearchQuerySchema } from './members';
import { ModerationActionInputSchema } from './moderation';

const ids = { targetId: '123456789012345678', actorId: '223456789012345678' };

describe('ModerationActionInputSchema', () => {
  it('ban exige motivo; kick não', () => {
    expect(ModerationActionInputSchema.safeParse({ type: 'ban', ...ids }).success).toBe(false);
    expect(
      ModerationActionInputSchema.safeParse({ type: 'ban', reason: 'spam', ...ids }).success,
    ).toBe(true);
    const kick = ModerationActionInputSchema.parse({ type: 'kick', ...ids });
    expect(kick.source).toBe('dashboard');
    expect(kick.reason).toBeUndefined();
  });

  it('timeout exige duração até 28 dias', () => {
    expect(ModerationActionInputSchema.safeParse({ type: 'timeout', ...ids }).success).toBe(false);
    expect(
      ModerationActionInputSchema.safeParse({
        type: 'timeout',
        durationMs: MAX_TIMEOUT_MS + 1,
        ...ids,
      }).success,
    ).toBe(false);
    expect(
      ModerationActionInputSchema.safeParse({ type: 'timeout', durationMs: 60_000, ...ids })
        .success,
    ).toBe(true);
  });

  it('duração só em ban/timeout; deleteMessageDays só em ban/softban', () => {
    expect(
      ModerationActionInputSchema.safeParse({ type: 'kick', durationMs: 1000, ...ids }).success,
    ).toBe(false);
    expect(
      ModerationActionInputSchema.safeParse({ type: 'warn', deleteMessageDays: 1, ...ids }).success,
    ).toBe(false);
    expect(
      ModerationActionInputSchema.safeParse({
        type: 'softban',
        deleteMessageDays: 7,
        ...ids,
      }).success,
    ).toBe(true);
    expect(
      ModerationActionInputSchema.safeParse({
        type: 'ban',
        reason: 'x',
        deleteMessageDays: 8,
        ...ids,
      }).success,
    ).toBe(false);
  });

  it('rejeita IDs que não são snowflake', () => {
    expect(
      ModerationActionInputSchema.safeParse({ type: 'kick', targetId: '1', actorId: ids.actorId })
        .success,
    ).toBe(false);
  });
});

describe('InvalidateInputSchema', () => {
  it('aceita módulo conhecido ou ausente', () => {
    expect(InvalidateInputSchema.parse({})).toEqual({});
    expect(InvalidateInputSchema.parse({ module: 'tags' })).toEqual({ module: 'tags' });
    expect(InvalidateInputSchema.safeParse({ module: 'x' }).success).toBe(false);
  });
});

describe('MemberSearchQuerySchema', () => {
  it('coage limit da query string e aplica defaults', () => {
    expect(MemberSearchQuerySchema.parse({})).toEqual({ q: '', limit: 25 });
    expect(MemberSearchQuerySchema.parse({ q: ' ana ', limit: '50' })).toEqual({
      q: 'ana',
      limit: 50,
    });
    expect(MemberSearchQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
