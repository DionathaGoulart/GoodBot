import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import {
  ABSENT_OVERWRITE_TYPE,
  archivedTextOverwrites,
  decodeVoiceSnapshot,
  encodeVoiceSnapshot,
  restoreVoiceOverwrites,
  SQUAD_BOT_TEXT_BITS,
  SQUAD_MEMBER_TEXT_BITS,
  SQUAD_VOICE_MEMBER_BITS,
  squadTextOverwrites,
  voiceReservationAffectedIds,
  voiceReservationOverwrites,
} from './overwrites';

import type { ExactOverwrite } from '../../lib/overwrites';
import type { LockOverwrite } from '@goodbot/db';

const EVERYONE = '900000000000000000';
const BOT = '100000000000000000';
const A = '300000000000000001';
const B = '300000000000000002';
const OUTSIDER = '300000000000000009';
const STAFF_ROLE = '700000000000000001';

/** O snapshot como a reserva grava: só quem tinha overwrite, a partir de uma lista. */
function snapshotOf(list: readonly ExactOverwrite[], ids: readonly string[]): LockOverwrite[] {
  return list
    .filter((overwrite) => ids.includes(overwrite.id))
    .map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.toString(),
      deny: overwrite.deny.toString(),
    }));
}

describe('squadTextOverwrites', () => {
  it('esconde de @everyone e libera membros e bot', () => {
    expect(squadTextOverwrites({ everyoneId: EVERYONE, botId: BOT, memberIds: [A, A] })).toEqual([
      { id: EVERYONE, type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
      { id: A, type: OverwriteType.Member, allow: SQUAD_MEMBER_TEXT_BITS, deny: 0n },
      { id: BOT, type: OverwriteType.Member, allow: SQUAD_BOT_TEXT_BITS, deny: 0n },
    ]);
  });

  it('sem bot resolvido, não inventa overwrite para ele', () => {
    const list = squadTextOverwrites({ everyoneId: EVERYONE, botId: null, memberIds: [A] });
    expect(list.map((overwrite) => overwrite.id)).toEqual([EVERYONE, A]);
  });
});

describe('archivedTextOverwrites', () => {
  it('membros leem mas não escrevem; o resto fica igual', () => {
    const current: ExactOverwrite[] = [
      { id: EVERYONE, type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
      {
        id: A,
        type: OverwriteType.Member,
        allow: SQUAD_MEMBER_TEXT_BITS | PermissionFlagsBits.AddReactions,
        deny: 0n,
      },
      { id: STAFF_ROLE, type: OverwriteType.Role, allow: SQUAD_MEMBER_TEXT_BITS, deny: 0n },
    ];

    const next = archivedTextOverwrites(current, [A]);
    const member = next.find((overwrite) => overwrite.id === A)!;

    expect(member.allow & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);
    expect(member.allow & PermissionFlagsBits.ReadMessageHistory).toBe(
      PermissionFlagsBits.ReadMessageHistory,
    );
    expect(member.allow & PermissionFlagsBits.SendMessages).toBe(0n);
    expect(member.deny & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(member.allow & PermissionFlagsBits.AddReactions).toBe(PermissionFlagsBits.AddReactions);
    expect(next[0]).toEqual(current[0]);
    expect(next[2]).toEqual(current[2]);
    expect(current[1]!.allow & PermissionFlagsBits.SendMessages).toBe(
      PermissionFlagsBits.SendMessages,
    );
  });
});

describe('reserva do voice', () => {
  const before: ExactOverwrite[] = [
    {
      id: EVERYONE,
      type: OverwriteType.Role,
      allow: PermissionFlagsBits.Connect | PermissionFlagsBits.Speak,
      deny: PermissionFlagsBits.Stream,
    },
    { id: A, type: OverwriteType.Member, allow: 0n, deny: PermissionFlagsBits.Speak },
    { id: STAFF_ROLE, type: OverwriteType.Role, allow: PermissionFlagsBits.MoveMembers, deny: 0n },
  ];
  const targets = { everyoneId: EVERYONE, botId: BOT, memberIds: [A, B] };

  it('nega Connect a @everyone sem perder os outros bits', () => {
    const next = voiceReservationOverwrites(before, targets);
    expect(next.find((overwrite) => overwrite.id === EVERYONE)).toEqual({
      id: EVERYONE,
      type: OverwriteType.Role,
      allow: PermissionFlagsBits.Speak,
      deny: PermissionFlagsBits.Stream | PermissionFlagsBits.Connect,
    });
  });

  it('libera ver, conectar e falar para os membros e mantém quem não é afetado', () => {
    const next = voiceReservationOverwrites(before, targets);
    expect(next.find((overwrite) => overwrite.id === A)).toEqual({
      id: A,
      type: OverwriteType.Member,
      allow: SQUAD_VOICE_MEMBER_BITS,
      deny: 0n,
    });
    expect(next.find((overwrite) => overwrite.id === B)?.allow).toBe(SQUAD_VOICE_MEMBER_BITS);
    expect(next.find((overwrite) => overwrite.id === BOT)?.allow).toBe(
      PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect,
    );
    expect(next.find((overwrite) => overwrite.id === STAFF_ROLE)).toEqual(before[2]);
    expect(next.some((overwrite) => overwrite.id === OUTSIDER)).toBe(false);
  });

  it('a liberação devolve o estado anterior exato e apaga o que a reserva criou', () => {
    const affected = voiceReservationAffectedIds(targets);
    const stored = encodeVoiceSnapshot(affected, snapshotOf(before, affected));
    const reserved = voiceReservationOverwrites(before, targets);
    expect(restoreVoiceOverwrites(reserved, stored, EVERYONE)).toEqual(before);
  });

  it('quem saiu do squad no meio da sessão também perde o overwrite na liberação', () => {
    const affected = voiceReservationAffectedIds(targets);
    const stored = encodeVoiceSnapshot(affected, snapshotOf(before, affected));
    const reserved = voiceReservationOverwrites(before, targets);
    // A liberação não recebe membros: B só volta ao normal porque o id está gravado.
    const restored = restoreVoiceOverwrites(reserved, stored, EVERYONE);
    expect(restored.some((overwrite) => overwrite.id === B)).toBe(false);
  });

  it('o snapshot grava marcador para quem não tinha overwrite', () => {
    const stored = encodeVoiceSnapshot([EVERYONE, B], snapshotOf(before, [EVERYONE, B]));
    expect(stored[1]).toEqual({ id: B, type: ABSENT_OVERWRITE_TYPE, allow: '0', deny: '0' });
    expect(decodeVoiceSnapshot(stored)).toEqual({
      affectedIds: [EVERYONE, B],
      snapshot: [stored[0]],
    });
  });
});
