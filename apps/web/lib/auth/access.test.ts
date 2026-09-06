import { describe, expect, it } from 'vitest';

import { checkGuildAccess, hasAccess, resolveAccessLevel } from './access';

const GUILD = '111111111111111111';
const EVERYONE = GUILD; // o cargo `@everyone` tem o id da guild
const MOD_ROLE = '222222222222222222';
const ADMIN_ROLE = '333333333333333333';
const DASH_ROLE = '444444444444444444';

const base = {
  userId: '999999999999999999',
  ownerId: '555555555555555555',
  memberRoleIds: [EVERYONE],
  rolePermissions: { [EVERYONE]: '0' },
};

describe('hasAccess', () => {
  it('respeita a ordem none < mod < admin < owner', () => {
    expect(hasAccess('owner', 'admin')).toBe(true);
    expect(hasAccess('admin', 'admin')).toBe(true);
    expect(hasAccess('mod', 'admin')).toBe(false);
    expect(hasAccess('none', 'mod')).toBe(false);
  });
});

describe('resolveAccessLevel', () => {
  it('quem não é membro fica em none', () => {
    expect(resolveAccessLevel({ ...base, memberRoleIds: null })).toBe('none');
  });

  it('o owner do servidor vence qualquer outra regra', () => {
    expect(resolveAccessLevel({ ...base, userId: base.ownerId })).toBe('owner');
  });

  it('Administrator nativo vira admin', () => {
    expect(
      resolveAccessLevel({
        ...base,
        memberRoleIds: [EVERYONE, ADMIN_ROLE],
        rolePermissions: { [EVERYONE]: '0', [ADMIN_ROLE]: String(1n << 3n) },
      }),
    ).toBe('admin');
  });

  it('ManageGuild nativo também vira admin', () => {
    expect(
      resolveAccessLevel({
        ...base,
        memberRoleIds: [EVERYONE, ADMIN_ROLE],
        rolePermissions: { [EVERYONE]: '0', [ADMIN_ROLE]: String(1n << 5n) },
      }),
    ).toBe('admin');
  });

  it('cargo listado em admin_role_ids vira admin sem permissão nativa', () => {
    expect(
      resolveAccessLevel({
        ...base,
        memberRoleIds: [EVERYONE, ADMIN_ROLE],
        rolePermissions: { [EVERYONE]: '0', [ADMIN_ROLE]: '0' },
        adminRoleIds: [ADMIN_ROLE],
      }),
    ).toBe('admin');
  });

  it('mod_role_ids e dashboard_access_role_ids param em mod', () => {
    expect(
      resolveAccessLevel({ ...base, memberRoleIds: [EVERYONE, MOD_ROLE], modRoleIds: [MOD_ROLE] }),
    ).toBe('mod');
    expect(
      resolveAccessLevel({
        ...base,
        memberRoleIds: [EVERYONE, DASH_ROLE],
        dashboardAccessRoleIds: [DASH_ROLE],
      }),
    ).toBe('mod');
  });

  it('membro comum não entra', () => {
    expect(resolveAccessLevel(base)).toBe('none');
  });

  it('bitfield inválido não derruba a checagem', () => {
    expect(resolveAccessLevel({ ...base, rolePermissions: { [EVERYONE]: 'nada disso' } })).toBe(
      'none',
    );
  });
});

describe('checkGuildAccess', () => {
  const session = { user: { id: base.userId }, level: 'mod' as const, guildId: GUILD };

  it('sem sessão pede login', () => {
    expect(checkGuildAccess(null, GUILD, 'mod')).toBe('unauthenticated');
  });

  it('nega outra guild mesmo com nível alto', () => {
    expect(checkGuildAccess({ ...session, level: 'owner' }, '000000000000000000', 'mod')).toBe(
      'denied',
    );
  });

  it('libera quando o nível alcança o mínimo', () => {
    expect(checkGuildAccess(session, GUILD, 'mod')).toBe('ok');
    expect(checkGuildAccess({ ...session, level: 'admin' }, GUILD, 'mod')).toBe('ok');
  });

  it('nega quando o nível não alcança', () => {
    expect(checkGuildAccess(session, GUILD, 'admin')).toBe('denied');
    expect(checkGuildAccess({ ...session, level: 'none' }, GUILD, 'mod')).toBe('denied');
  });
});
