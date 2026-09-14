import { type OverwriteType , type Collection } from 'discord.js';

import type { LockOverwrite } from '@goodbot/db';

/**
 * Overwrite com `id` já estreitado para `string`. O `OverwriteData` do
 * discord.js aceita `Role`/`User` no `id`, o que impediria indexar por id.
 */
export interface ExactOverwrite {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

/** O pedaço de um canal que estes helpers leem: o cache de overwrites. */
export interface OverwriteSource {
  permissionOverwrites: {
    cache: Collection<
      string,
      { id: string; type: OverwriteType; allow: { bitfield: bigint }; deny: { bitfield: bigint } }
    >;
  };
}

/**
 * Snapshot dos overwrites atuais dos ids afetados (só eles). Id sem overwrite
 * fica de fora: é a ausência no snapshot que diz ao restore para apagar o
 * overwrite que a mudança criou.
 */
export function snapshotOverwrites(
  channel: OverwriteSource,
  ids: readonly string[],
): LockOverwrite[] {
  const kept: LockOverwrite[] = [];
  for (const id of ids) {
    const overwrite = channel.permissionOverwrites.cache.get(id);
    if (!overwrite) continue;
    kept.push({
      id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
    });
  }
  return kept;
}

/** Lista completa atual, para poder reescrevê-la com um único `set`. */
export function currentOverwrites(channel: OverwriteSource): ExactOverwrite[] {
  return channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  }));
}

/**
 * Nega `bits` para `id`, preservando o resto: tira de `allow`, põe em `deny`.
 * Sem overwrite para o id, cria um com `type`. Não altera a lista recebida.
 */
export function denyOverwriteBits(
  current: readonly ExactOverwrite[],
  target: { id: string; type: OverwriteType; bits: bigint },
): ExactOverwrite[] {
  return upsertBits(current, target, (overwrite) => ({
    ...overwrite,
    allow: overwrite.allow & ~target.bits,
    deny: overwrite.deny | target.bits,
  }));
}

/** O espelho de `denyOverwriteBits`: põe em `allow`, tira de `deny`. */
export function allowOverwriteBits(
  current: readonly ExactOverwrite[],
  target: { id: string; type: OverwriteType; bits: bigint },
): ExactOverwrite[] {
  return upsertBits(current, target, (overwrite) => ({
    ...overwrite,
    allow: overwrite.allow | target.bits,
    deny: overwrite.deny & ~target.bits,
  }));
}

function upsertBits(
  current: readonly ExactOverwrite[],
  target: { id: string; type: OverwriteType },
  change: (overwrite: ExactOverwrite) => ExactOverwrite,
): ExactOverwrite[] {
  let found = false;
  const next = current.map((overwrite) => {
    if (overwrite.id !== target.id) return overwrite;
    found = true;
    return change(overwrite);
  });
  if (!found) next.push(change({ id: target.id, type: target.type, allow: 0n, deny: 0n }));
  return next;
}

/**
 * Devolve os ids afetados ao que o snapshot guardou, sobre a lista atual:
 *
 * · id que a mudança não tocou fica exatamente como está;
 * · id afetado com snapshot volta ao valor salvo;
 * · id afetado sem snapshot não tinha overwrite antes, e omiti-lo aqui é o que
 *   apaga o overwrite que a própria mudança criou.
 */
export function restoreOverwrites(
  current: readonly ExactOverwrite[],
  affectedIds: Iterable<string>,
  snapshot: readonly LockOverwrite[],
): ExactOverwrite[] {
  const affected = new Set(affectedIds);
  const previous = new Map(snapshot.map((overwrite) => [overwrite.id, overwrite]));
  const next: ExactOverwrite[] = [];
  for (const overwrite of current) {
    if (!affected.has(overwrite.id)) {
      next.push(overwrite);
      continue;
    }
    const saved = previous.get(overwrite.id);
    if (!saved) continue;
    next.push({
      id: saved.id,
      type: saved.type as OverwriteType,
      allow: BigInt(saved.allow),
      deny: BigInt(saved.deny),
    });
  }
  return next;
}
