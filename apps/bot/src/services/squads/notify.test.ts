import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { notifyText, toggleNotify } from './notify';

import type { Guild, GuildMember } from 'discord.js';

const BORA = '700000000000000001';

function setup(options: { position?: number; manageRoles?: boolean; configured?: boolean } = {}) {
  const role = {
    id: BORA,
    position: options.position ?? 1,
    managed: false,
    toString: () => `<@&${BORA}>`,
  };
  const guild = {
    roles: { cache: new Map(options.configured === false ? [] : [[BORA, role]]) },
    members: {
      me: {
        permissions: {
          has: (flag: bigint) =>
            flag === PermissionFlagsBits.ManageRoles && (options.manageRoles ?? true),
        },
        roles: { highest: { position: 5 } },
      },
    },
  } as unknown as Guild;
  const held = new Set<string>();
  const member = {
    guild,
    roles: {
      cache: held,
      add: vi.fn((r: { id: string }) => {
        held.add(r.id);
        return Promise.resolve();
      }),
      remove: vi.fn((r: { id: string }) => {
        held.delete(r.id);
        return Promise.resolve();
      }),
    },
  } as unknown as GuildMember;
  return { member };
}

describe('ME AVISA', () => {
  it('liga e desliga o cargo', async () => {
    const { member } = setup();
    await expect(toggleNotify(member, { notifyRoleId: BORA })).resolves.toEqual({
      state: 'on',
      roleId: BORA,
    });
    await expect(toggleNotify(member, { notifyRoleId: BORA })).resolves.toEqual({
      state: 'off',
      roleId: BORA,
    });
  });

  it('a falta diz à pessoa o que pedir à staff', async () => {
    await expect(toggleNotify(setup().member, { notifyRoleId: null })).rejects.toMatchObject({
      code: 'SQUADS_ROLE_MISSING',
    });
    await expect(
      toggleNotify(setup({ configured: false }).member, { notifyRoleId: BORA }),
    ).rejects.toMatchObject({ code: 'SQUADS_ROLE_MISSING' });
    await expect(
      toggleNotify(setup({ manageRoles: false }).member, { notifyRoleId: BORA }),
    ).rejects.toMatchObject({ code: 'MISSING_PERMISSION' });
    await expect(
      toggleNotify(setup({ position: 5 }).member, { notifyRoleId: BORA }),
    ).rejects.toMatchObject({ code: 'BOT_ROLE_HIERARCHY' });
  });

  it('a resposta diz o estado novo e como voltar', () => {
    expect(notifyText({ state: 'on', roleId: BORA })).toContain(`você tem o <@&${BORA}>`);
    expect(notifyText({ state: 'off', roleId: BORA })).toContain(`você saiu do <@&${BORA}>`);
  });
});
