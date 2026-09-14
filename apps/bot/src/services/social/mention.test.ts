import { describe, expect, it } from 'vitest';

import { mentionRoleFor } from './mention';

const VIDEO_ROLE_ID = '700000000000000000';
const LIVE_ROLE_ID = '700000000000000001';

const BOTH = { mentionRoleId: VIDEO_ROLE_ID, liveMentionRoleId: LIVE_ROLE_ID };

describe('mentionRoleFor', () => {
  it('vídeo e short pingam o cargo de vídeos', () => {
    expect(mentionRoleFor(BOTH, 'video')).toBe(VIDEO_ROLE_ID);
    expect(mentionRoleFor(BOTH, 'short')).toBe(VIDEO_ROLE_ID);
  });

  it('live pinga o cargo de lives', () => {
    expect(mentionRoleFor(BOTH, 'live')).toBe(LIVE_ROLE_ID);
  });

  it('não cai no outro cargo quando o do tipo está vazio', () => {
    expect(mentionRoleFor({ ...BOTH, liveMentionRoleId: null }, 'live')).toBeNull();
    expect(mentionRoleFor({ ...BOTH, mentionRoleId: null }, 'video')).toBeNull();
    expect(mentionRoleFor({ ...BOTH, mentionRoleId: null }, 'short')).toBeNull();
  });
});
