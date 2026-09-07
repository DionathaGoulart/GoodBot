import { describe, expect, it } from 'vitest';

import {
  ChannelCreateInputSchema,
  ChannelOverridesInputSchema,
  bitsToOverride,
  isEmptyOverride,
  overrideToBits,
} from './channels';
import {
  PERMISSION_BITS,
  PERMISSION_GROUPS,
  PERMISSION_NAMES,
  bitfieldToPermissions,
  dangerousPermissions,
  hasDangerousPermissions,
  mergePermissions,
  permissionsToBitfield,
} from './permissions';
import { MemberRolesInputSchema, RoleWriteInputSchema } from './roles';

const ROLE_A = '300000000000000000';
const ROLE_B = '400000000000000000';
const ACTOR = '200000000000000000';

describe('permissões', () => {
  it('vai e volta entre nomes e bitfield', () => {
    const bitfield = permissionsToBitfield(['SendMessages', 'ViewChannel']);
    expect(bitfield).toBe(((1n << 10n) | (1n << 11n)).toString());
    expect(bitfieldToPermissions(bitfield)).toEqual(['ViewChannel', 'SendMessages']);
  });

  it('bitfield inválido não explode: vira cargo sem permissão', () => {
    expect(bitfieldToPermissions('não é número')).toEqual([]);
    expect(hasDangerousPermissions('')).toBe(false);
  });

  it('marca como perigoso só o que escala privilégio', () => {
    expect(hasDangerousPermissions(permissionsToBitfield(['Administrator']))).toBe(true);
    expect(dangerousPermissions(permissionsToBitfield(['ManageRoles', 'AddReactions']))).toEqual([
      'ManageRoles',
    ]);
    expect(hasDangerousPermissions(permissionsToBitfield(['AddReactions', 'Speak']))).toBe(false);
  });

  it('salvar preserva bits que o painel não mostra', () => {
    // 1n << 41n (analytics de monetização) não está na lista curada.
    const current = (PERMISSION_BITS.SendMessages | (1n << 41n)).toString();
    const merged = mergePermissions(current, ['ViewChannel']);

    expect(BigInt(merged) & (1n << 41n)).toBe(1n << 41n);
    expect(bitfieldToPermissions(merged)).toEqual(['ViewChannel']);
  });

  it('todo grupo da checklist só cita permissões existentes, sem repetir', () => {
    const listed = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect(new Set(listed).size).toBe(listed.length);
    for (const name of listed) expect(PERMISSION_NAMES).toContain(name);
  });
});

describe('overrides de canal', () => {
  it('constrói o par allow/deny a partir de ver/falar', () => {
    expect(overrideToBits({ roleId: ROLE_A, view: 'allow', send: 'deny' })).toEqual({
      allow: PERMISSION_BITS.ViewChannel.toString(),
      deny: PERMISSION_BITS.SendMessages.toString(),
    });
    expect(overrideToBits({ roleId: ROLE_A, view: 'inherit', send: 'inherit' })).toEqual({
      allow: '0',
      deny: '0',
    });
  });

  it('volta do allow/deny para o formulário sem perder estado', () => {
    const original = { roleId: ROLE_A, view: 'deny', send: 'allow' } as const;
    expect(bitsToOverride(ROLE_A, overrideToBits(original))).toEqual(original);
  });

  it('override que só herda é descartável', () => {
    expect(isEmptyOverride({ roleId: ROLE_A, view: 'inherit', send: 'inherit' })).toBe(true);
    expect(isEmptyOverride({ roleId: ROLE_A, view: 'deny', send: 'inherit' })).toBe(false);
  });

  it('o payload de overrides valida cargo e estado', () => {
    expect(
      ChannelOverridesInputSchema.safeParse({
        actorId: ACTOR,
        overrides: [{ roleId: ROLE_A, view: 'deny', send: 'inherit' }],
      }).success,
    ).toBe(true);
    expect(
      ChannelOverridesInputSchema.safeParse({
        actorId: ACTOR,
        overrides: [{ roleId: 'nope', view: 'deny', send: 'inherit' }],
      }).success,
    ).toBe(false);
    expect(
      ChannelOverridesInputSchema.safeParse({
        actorId: ACTOR,
        overrides: [{ roleId: ROLE_A, view: 'talvez', send: 'inherit' }],
      }).success,
    ).toBe(false);
  });
});

describe('schemas de escrita', () => {
  it('cargo recusa permissão desconhecida e limita o nome', () => {
    expect(
      RoleWriteInputSchema.safeParse({ actorId: ACTOR, name: 'Mod', permissions: ['VoarSemAsas'] })
        .success,
    ).toBe(false);
    expect(RoleWriteInputSchema.safeParse({ actorId: ACTOR, name: '' }).success).toBe(false);

    const parsed = RoleWriteInputSchema.parse({ actorId: ACTOR, name: 'Mod' });
    expect(parsed).toMatchObject({ color: 0, hoist: false, mentionable: false, permissions: [] });
  });

  it('canal recusa slowmode acima do teto do Discord', () => {
    expect(
      ChannelCreateInputSchema.safeParse({
        actorId: ACTOR,
        name: 'geral',
        type: 0,
        slowmodeSeconds: 21_601,
      }).success,
    ).toBe(false);
  });

  it('cargos de membro exigem alguma mudança e não se contradizem', () => {
    expect(MemberRolesInputSchema.safeParse({ actorId: ACTOR }).success).toBe(false);
    expect(
      MemberRolesInputSchema.safeParse({ actorId: ACTOR, add: [ROLE_A], remove: [ROLE_A] }).success,
    ).toBe(false);
    expect(
      MemberRolesInputSchema.safeParse({ actorId: ACTOR, add: [ROLE_A], remove: [ROLE_B] }).success,
    ).toBe(true);
  });
});
