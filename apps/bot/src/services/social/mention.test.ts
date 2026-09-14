import { describe, expect, it } from 'vitest';

import { mentionRolesFor } from './mention';

const VIDEO_ROLE_ID = '700000000000000000';
const LIVE_ROLE_ID = '700000000000000001';
const CHANNEL_ROLE_ID = '700000000000000002';

const BOTH = {
  mentionRoleIds: [VIDEO_ROLE_ID, CHANNEL_ROLE_ID],
  liveMentionRoleIds: [LIVE_ROLE_ID, CHANNEL_ROLE_ID],
};

describe('mentionRolesFor', () => {
  it('vídeo e short pingam os cargos de vídeos', () => {
    expect(mentionRolesFor(BOTH, 'video')).toEqual([VIDEO_ROLE_ID, CHANNEL_ROLE_ID]);
    expect(mentionRolesFor(BOTH, 'short')).toEqual([VIDEO_ROLE_ID, CHANNEL_ROLE_ID]);
  });

  it('live pinga os cargos de lives', () => {
    expect(mentionRolesFor(BOTH, 'live')).toEqual([LIVE_ROLE_ID, CHANNEL_ROLE_ID]);
  });

  it('não cai na outra lista quando a do tipo está vazia', () => {
    expect(mentionRolesFor({ ...BOTH, liveMentionRoleIds: [] }, 'live')).toEqual([]);
    expect(mentionRolesFor({ ...BOTH, mentionRoleIds: [] }, 'video')).toEqual([]);
    expect(mentionRolesFor({ ...BOTH, mentionRoleIds: [] }, 'short')).toEqual([]);
  });

  it('devolve uma cópia: quem monta a mensagem não altera a conta', () => {
    const roles = mentionRolesFor(BOTH, 'video');
    roles.push('999999999999999999');
    expect(BOTH.mentionRoleIds).toHaveLength(2);
  });
});
