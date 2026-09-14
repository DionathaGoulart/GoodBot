import { OverwriteType, PermissionFlagsBits } from 'discord.js';

import {
  allowOverwriteBits,
  denyOverwriteBits,
  restoreOverwrites,
  type ExactOverwrite,
} from '../../lib/overwrites';

import type { LockOverwrite } from '@goodbot/db';

/** O que um membro faz no canal de texto do squad (mesmo conjunto dos tickets). */
export const SQUAD_MEMBER_TEXT_BITS =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.SendMessages |
  PermissionFlagsBits.ReadMessageHistory |
  PermissionFlagsBits.AttachFiles |
  PermissionFlagsBits.EmbedLinks;

/** O bot ainda precisa renomear o canal e limpar mensagens. */
export const SQUAD_BOT_TEXT_BITS =
  SQUAD_MEMBER_TEXT_BITS | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages;

/** Arquivado: quem era do squad ainda lê o histórico. */
export const SQUAD_ARCHIVE_READ_BITS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;

/** Arquivado: ninguém mais escreve, nem numa thread aberta no canal. */
export const SQUAD_ARCHIVE_DENY_BITS =
  PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads;

/** O que a reserva nega a `@everyone` no voice do pool. */
export const SQUAD_VOICE_LOCK_BITS = PermissionFlagsBits.Connect;

/** O que a reserva garante a cada membro no voice. */
export const SQUAD_VOICE_MEMBER_BITS =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;

/**
 * O bot entra na reserva como membro: com `Connect` negado a `@everyone`, ele
 * perderia a própria permissão de conectar, e o Discord exige `Connect` no
 * destino para mover alguém para lá.
 */
export const SQUAD_VOICE_BOT_BITS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect;

/**
 * O que o bot precisa ter no voice antes de reservar. Ele não consegue dar
 * nem negar num overwrite uma permissão que não tem, e o PRD §10 ainda não
 * pede `Connect` nem `Speak` no convite: sem a checagem, o `set` falharia com
 * 50013 no meio da sessão.
 */
export const SQUAD_VOICE_REQUIRED_BITS =
  SQUAD_VOICE_MEMBER_BITS |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.MoveMembers;

/** Para `permissionOverwrites.edit` quando alguém entra num squad que já tem canal. */
export const SQUAD_MEMBER_TEXT_EDIT = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
  EmbedLinks: true,
} as const;

export interface SquadOverwriteTargets {
  /** O id do cargo `@everyone`, que é o id da guild. */
  everyoneId: string;
  /** `guild.members.me?.id`; `null` antes do `ready`. */
  botId: string | null;
  memberIds: readonly string[];
}

/** Canal de texto novo: ninguém vê além dos membros e do bot. */
export function squadTextOverwrites(targets: SquadOverwriteTargets): ExactOverwrite[] {
  const overwrites: ExactOverwrite[] = [
    {
      id: targets.everyoneId,
      type: OverwriteType.Role,
      allow: 0n,
      deny: PermissionFlagsBits.ViewChannel,
    },
  ];
  for (const id of new Set(targets.memberIds)) {
    if (id === targets.botId) continue;
    overwrites.push({ id, type: OverwriteType.Member, allow: SQUAD_MEMBER_TEXT_BITS, deny: 0n });
  }
  if (targets.botId) {
    overwrites.push({
      id: targets.botId,
      type: OverwriteType.Member,
      allow: SQUAD_BOT_TEXT_BITS,
      deny: 0n,
    });
  }
  return overwrites;
}

/**
 * Canal de squad arquivado, a partir dos overwrites atuais: cada membro segue
 * lendo e deixa de escrever; o resto (inclusive o que um admin pôs à mão)
 * fica como está.
 */
export function archivedTextOverwrites(
  current: readonly ExactOverwrite[],
  memberIds: readonly string[],
): ExactOverwrite[] {
  let next = [...current];
  for (const id of new Set(memberIds)) {
    next = allowOverwriteBits(next, {
      id,
      type: OverwriteType.Member,
      bits: SQUAD_ARCHIVE_READ_BITS,
    });
    next = denyOverwriteBits(next, {
      id,
      type: OverwriteType.Member,
      bits: SQUAD_ARCHIVE_DENY_BITS,
    });
  }
  return next;
}

/** Ids cujos overwrites a reserva mexe: é deles o snapshot. */
export function voiceReservationAffectedIds(targets: SquadOverwriteTargets): string[] {
  const ids = [targets.everyoneId, ...targets.memberIds];
  if (targets.botId) ids.push(targets.botId);
  return [...new Set(ids)];
}

/**
 * Overwrites do voice durante a reserva, sobre os atuais: `@everyone` perde
 * `Connect` (os outros bits dele ficam), cada membro ganha ver, conectar e
 * falar, e o bot ganha ver e conectar.
 */
export function voiceReservationOverwrites(
  current: readonly ExactOverwrite[],
  targets: SquadOverwriteTargets,
): ExactOverwrite[] {
  let next = denyOverwriteBits(current, {
    id: targets.everyoneId,
    type: OverwriteType.Role,
    bits: SQUAD_VOICE_LOCK_BITS,
  });
  for (const id of new Set(targets.memberIds)) {
    if (id === targets.botId) continue;
    next = allowOverwriteBits(next, {
      id,
      type: OverwriteType.Member,
      bits: SQUAD_VOICE_MEMBER_BITS,
    });
  }
  if (targets.botId) {
    next = allowOverwriteBits(next, {
      id: targets.botId,
      type: OverwriteType.Member,
      bits: SQUAD_VOICE_BOT_BITS,
    });
  }
  return next;
}

/**
 * `type` de uma entrada do snapshot que diz "este id não tinha overwrite antes
 * da reserva". O `OverwriteType` do Discord só tem 0 e 1.
 */
export const ABSENT_OVERWRITE_TYPE = -1;

/**
 * Snapshot gravado em `squad_sessions.voice_overwrites`. Guarda todo id
 * afetado, e não só os que tinham overwrite: quem sai do squad no meio da
 * sessão some da lista de membros, e sem o id gravado a liberação deixaria o
 * overwrite dele no voice para sempre.
 */
export function encodeVoiceSnapshot(
  affectedIds: readonly string[],
  snapshot: readonly LockOverwrite[],
): LockOverwrite[] {
  const saved = new Map(snapshot.map((overwrite) => [overwrite.id, overwrite]));
  return [...new Set(affectedIds)].map(
    (id) => saved.get(id) ?? { id, type: ABSENT_OVERWRITE_TYPE, allow: '0', deny: '0' },
  );
}

export function decodeVoiceSnapshot(stored: readonly LockOverwrite[]): {
  affectedIds: string[];
  snapshot: LockOverwrite[];
} {
  return {
    affectedIds: [...new Set(stored.map((overwrite) => overwrite.id))],
    snapshot: stored.filter((overwrite) => overwrite.type !== ABSENT_OVERWRITE_TYPE),
  };
}

/** Overwrites do voice depois da liberação: tudo que a reserva tocou volta ao snapshot. */
export function restoreVoiceOverwrites(
  current: readonly ExactOverwrite[],
  stored: readonly LockOverwrite[],
  everyoneId: string,
): ExactOverwrite[] {
  const { affectedIds, snapshot } = decodeVoiceSnapshot(stored);
  return restoreOverwrites(current, [everyoneId, ...affectedIds], snapshot);
}
