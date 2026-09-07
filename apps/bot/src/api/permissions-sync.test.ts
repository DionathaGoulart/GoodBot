import { PERMISSION_BITS, type PermissionName } from '@cobot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

/**
 * `@cobot/shared` não depende do discord.js (o painel o importa e ele não roda
 * no browser), então os bits de permissão estão escritos à mão lá. Este teste é
 * o que garante que não há erro de digitação: um bit errado aqui abriria um
 * cargo com a permissão errada no servidor de alguém.
 */
describe('PERMISSION_BITS', () => {
  it('bate com o PermissionFlagsBits do discord.js', () => {
    for (const [name, bit] of Object.entries(PERMISSION_BITS)) {
      expect(PermissionFlagsBits[name as keyof typeof PermissionFlagsBits]).toBe(bit);
    }
  });

  it('nomeia só permissões que o discord.js conhece', () => {
    const known = new Set(Object.keys(PermissionFlagsBits));
    for (const name of Object.keys(PERMISSION_BITS) as PermissionName[]) {
      expect(known).toContain(name);
    }
  });
});
