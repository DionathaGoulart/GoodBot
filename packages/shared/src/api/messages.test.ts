import { describe, expect, it } from 'vitest';

import { NO_MENTIONS, SendMessageInputSchema } from './messages';

const CHANNEL = '100000000000000001';
const ACTOR = '200000000000000002';

const base = {
  kind: 'dashboard' as const,
  channelId: CHANNEL,
  template: { content: 'oi' },
};

describe('SendMessageInputSchema', () => {
  it('nasce sem mencionar ninguém', () => {
    const parsed = SendMessageInputSchema.parse(base);
    expect(parsed.allowedMentions).toEqual(NO_MENTIONS);
  });

  it('completa com `false` o que o painel não marcou', () => {
    const parsed = SendMessageInputSchema.parse({ ...base, allowedMentions: { users: true } });
    expect(parsed.allowedMentions).toEqual({ users: true, roles: false, everyone: false });
  });

  it('recusa @everyone sem saber quem está enviando', () => {
    const parsed = SendMessageInputSchema.safeParse({
      ...base,
      allowedMentions: { everyone: true },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['actorId']);
  });

  it('aceita @everyone com o autor identificado', () => {
    const parsed = SendMessageInputSchema.parse({
      ...base,
      allowedMentions: { everyone: true },
      actorId: ACTOR,
    });
    expect(parsed.allowedMentions.everyone).toBe(true);
  });
});
