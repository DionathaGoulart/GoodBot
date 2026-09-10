import { describe, expect, it } from 'vitest';

import {
  ACCESS_CHECK_TTL_MS,
  ACCESS_RETRY_DELAY_MS,
  checkGuildAccess,
  hasAccess,
  isStale,
  resolveAccessLevel,
  retryAt,
} from './access';

import type { AccessLevel } from './access';

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
  const OUTRA = '000000000000000000';
  const em = (guildId: string, level: AccessLevel) => ({
    user: { id: base.userId },
    guilds: { [guildId]: { level, checkedAt: Date.now() } },
  });
  const session = em(GUILD, 'mod');

  it('sem sessão pede login', () => {
    expect(checkGuildAccess(null, GUILD, 'mod')).toBe('unauthenticated');
  });

  it('nega guild fora do mapa mesmo com nível alto em outra', () => {
    expect(checkGuildAccess(em(GUILD, 'owner'), OUTRA, 'mod')).toBe('denied');
  });

  it('o nível de uma guild não vaza para a outra', () => {
    const duas = {
      user: { id: base.userId },
      guilds: {
        [GUILD]: { level: 'owner' as const, checkedAt: Date.now() },
        [OUTRA]: { level: 'none' as const, checkedAt: Date.now() },
      },
    };
    expect(checkGuildAccess(duas, GUILD, 'admin')).toBe('ok');
    expect(checkGuildAccess(duas, OUTRA, 'mod')).toBe('denied');
  });

  it('libera quando o nível alcança o mínimo', () => {
    expect(checkGuildAccess(session, GUILD, 'mod')).toBe('ok');
    expect(checkGuildAccess(em(GUILD, 'admin'), GUILD, 'mod')).toBe('ok');
  });

  it('nega quando o nível não alcança', () => {
    expect(checkGuildAccess(session, GUILD, 'admin')).toBe('denied');
    expect(checkGuildAccess(em(GUILD, 'none'), GUILD, 'mod')).toBe('denied');
  });
});

describe('isStale', () => {
  const now = 1_700_000_000_000;

  it('sem checagem anterior está velho', () => {
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale(0, now)).toBe(true);
  });

  it('dentro da janela está fresco', () => {
    expect(isStale(now, now)).toBe(false);
    expect(isStale(now - ACCESS_CHECK_TTL_MS, now)).toBe(false);
  });

  it('passou da janela está velho', () => {
    expect(isStale(now - ACCESS_CHECK_TTL_MS - 1, now)).toBe(true);
  });
});

describe('retryAt', () => {
  const now = 1_700_000_000_000;

  it('segura a permissão por mais um minuto e não além', () => {
    const checkedAt = retryAt(now);
    expect(isStale(checkedAt, now + ACCESS_RETRY_DELAY_MS)).toBe(false);
    expect(isStale(checkedAt, now + ACCESS_RETRY_DELAY_MS + 1)).toBe(true);
  });

  it('não revive uma permissão que já estava velha', () => {
    expect(isStale(retryAt(now), now)).toBe(false);
  });
});
