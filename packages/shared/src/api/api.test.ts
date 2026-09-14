import { describe, expect, it } from 'vitest';

import { MAX_TIMEOUT_MS } from '../constants';
import { InvalidateInputSchema } from './config';
import {
  MAX_MEMBER_LOOKUP_IDS,
  MemberLookupQuerySchema,
  MemberSearchQuerySchema,
  RoleListQuerySchema,
} from './members';
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

describe('MemberLookupQuerySchema', () => {
  const [a, b] = ['123456789012345678', '223456789012345678'];

  it('separa por vírgula e tira espaços, vazios e repetidos', () => {
    expect(MemberLookupQuerySchema.parse({ ids: ` ${a}, ${b},${a},, ` })).toEqual({ ids: [a, b] });
  });

  it('recusa lista vazia, id que não é snowflake e mais IDs que o teto', () => {
    expect(MemberLookupQuerySchema.safeParse({}).success).toBe(false);
    expect(MemberLookupQuerySchema.safeParse({ ids: '' }).success).toBe(false);
    expect(MemberLookupQuerySchema.safeParse({ ids: ' , ' }).success).toBe(false);
    expect(MemberLookupQuerySchema.safeParse({ ids: `${a},123` }).success).toBe(false);
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => String(100000000000000000n + BigInt(index)));
    expect(MemberLookupQuerySchema.safeParse({ ids: ids(MAX_MEMBER_LOOKUP_IDS).join() }).success).toBe(
      true,
    );
    expect(
      MemberLookupQuerySchema.safeParse({ ids: ids(MAX_MEMBER_LOOKUP_IDS + 1).join() }).success,
    ).toBe(false);
  });
});

describe('RoleListQuerySchema', () => {
  it('sem o parâmetro a contagem fica de fora', () => {
    expect(RoleListQuerySchema.parse({}).counts).toBe(false);
  });

  it('só `1` e `true` ligam a contagem', () => {
    expect(RoleListQuerySchema.parse({ counts: '1' }).counts).toBe(true);
    expect(RoleListQuerySchema.parse({ counts: 'true' }).counts).toBe(true);
  });

  it('qualquer outro valor não liga a varredura por engano', () => {
    for (const counts of ['0', 'false', '', 'sim', 'null']) {
      expect(RoleListQuerySchema.parse({ counts }).counts).toBe(false);
    }
  });
});
