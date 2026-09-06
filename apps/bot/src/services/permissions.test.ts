import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { canActOn, levelAtLeast, resolveLevel, type MemberLike } from './permissions';

function member(overrides: Partial<MemberLike> = {}): MemberLike {
  const permissions = new Set<bigint>(overrides.hasPermission ? [] : []);
  return {
    id: '1',
    isOwner: false,
    isBot: false,
    roleIds: [],
    highestRolePosition: 1,
    hasPermission: (flag) => permissions.has(flag),
    ...overrides,
  };
}

function withPermissions(...flags: bigint[]): Pick<MemberLike, 'hasPermission'> {
  const set = new Set(flags);
  return { hasPermission: (flag) => set.has(flag) };
}

const noRoles = { adminRoleIds: [], modRoleIds: [] };

describe('resolveLevel', () => {
  it('trata o dono do servidor como admin', () => {
    expect(resolveLevel(member({ isOwner: true }), noRoles)).toBe('admin');
  });

  it('trata Administrator como admin', () => {
    const m = member(withPermissions(PermissionFlagsBits.Administrator));
    expect(resolveLevel(m, noRoles)).toBe('admin');
  });

  it('usa admin_role_ids', () => {
    const m = member({ roleIds: ['10'] });
    expect(resolveLevel(m, { adminRoleIds: ['10'], modRoleIds: [] })).toBe('admin');
  });

  it('usa mod_role_ids', () => {
    const m = member({ roleIds: ['20'] });
    expect(resolveLevel(m, { adminRoleIds: [], modRoleIds: ['20'] })).toBe('mod');
  });

  it('admin vence mod quando o membro tem os dois cargos', () => {
    const m = member({ roleIds: ['10', '20'] });
    expect(resolveLevel(m, { adminRoleIds: ['10'], modRoleIds: ['20'] })).toBe('admin');
  });

  it('aceita permissões nativas de moderação', () => {
    for (const flag of [
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.KickMembers,
    ]) {
      expect(resolveLevel(member(withPermissions(flag)), noRoles)).toBe('mod');
    }
  });

  it('cai para member sem cargo nem permissão', () => {
    expect(resolveLevel(member(withPermissions(PermissionFlagsBits.SendMessages)), noRoles)).toBe(
      'member',
    );
  });
});

describe('levelAtLeast', () => {
  it('respeita member < mod < admin', () => {
    expect(levelAtLeast('admin', 'mod')).toBe(true);
    expect(levelAtLeast('mod', 'mod')).toBe(true);
    expect(levelAtLeast('mod', 'admin')).toBe(false);
    expect(levelAtLeast('member', 'mod')).toBe(false);
  });
});

describe('canActOn', () => {
  const bot = member({ id: 'bot', isBot: true, highestRolePosition: 50 });

  it('nega agir sobre si mesmo', () => {
    const actor = member({ id: 'a', highestRolePosition: 10 });
    expect(canActOn(actor, { ...actor })).toMatchObject({ ok: false, code: 'SELF_TARGET' });
  });

  it('nega agir sobre o dono do servidor', () => {
    const actor = member({ id: 'a', isOwner: true, highestRolePosition: 40 });
    const target = member({ id: 'b', isOwner: true, highestRolePosition: 40 });
    expect(canActOn(actor, target)).toMatchObject({ ok: false, code: 'TARGET_OWNER' });
  });

  it('nega agir sobre o próprio bot', () => {
    const actor = member({ id: 'a', highestRolePosition: 40 });
    expect(canActOn(actor, bot, { bot })).toMatchObject({ ok: false, code: 'TARGET_BOT' });
  });

  it('nega quando o cargo do bot está abaixo do alvo', () => {
    const actor = member({ id: 'a', isOwner: true, highestRolePosition: 99 });
    const target = member({ id: 'b', highestRolePosition: 60 });
    expect(canActOn(actor, target, { bot })).toMatchObject({ ok: false, code: 'BOT_HIERARCHY' });
  });

  it('nega alvo com cargo igual ou superior', () => {
    const actor = member({ id: 'a', highestRolePosition: 10 });
    expect(canActOn(actor, member({ id: 'b', highestRolePosition: 10 }))).toMatchObject({
      ok: false,
      code: 'HIERARCHY',
    });
    expect(canActOn(actor, member({ id: 'b', highestRolePosition: 11 }))).toMatchObject({
      ok: false,
      code: 'HIERARCHY',
    });
  });

  it('permite o owner sobre alguém de cargo mais alto', () => {
    const actor = member({ id: 'a', isOwner: true, highestRolePosition: 1 });
    const target = member({ id: 'b', highestRolePosition: 40 });
    expect(canActOn(actor, target, { bot })).toEqual({ ok: true });
  });

  it('permite quando a hierarquia do ator e do bot estão acima do alvo', () => {
    const actor = member({ id: 'a', highestRolePosition: 40 });
    const target = member({ id: 'b', highestRolePosition: 5 });
    expect(canActOn(actor, target, { bot })).toEqual({ ok: true });
  });
});
