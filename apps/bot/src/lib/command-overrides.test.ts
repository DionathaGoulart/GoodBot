import { CommandOverrideSchema, isUserFacingError } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { assertCommandAllowed } from './command-overrides';

const CHANNEL = '100000000000000000';
const OTHER_CHANNEL = '100000000000000001';
const ROLE = '200000000000000000';

const override = (patch: Record<string, unknown> = {}) => CommandOverrideSchema.parse(patch);

/** O caminho feliz é "nenhuma restrição": o mapa guarda exceções, não regras. */
describe('assertCommandAllowed', () => {
  it('deixa passar quando não há restrição', () => {
    expect(() => assertCommandAllowed(override(), { channelId: CHANNEL, roleIds: [] })).not.toThrow();
  });

  it('barra comando desativado', () => {
    expect(() =>
      assertCommandAllowed(override({ enabled: false }), { channelId: CHANNEL, roleIds: [ROLE] }),
    ).toThrow(/desativado/);
  });

  it('barra canal negado mesmo se ele estiver na lista de permitidos', () => {
    const config = override({ allowedChannelIds: [CHANNEL], deniedChannelIds: [CHANNEL] });
    expect(() => assertCommandAllowed(config, { channelId: CHANNEL, roleIds: [] })).toThrow(
      /neste canal/,
    );
  });

  it('barra canal fora da lista de permitidos', () => {
    const config = override({ allowedChannelIds: [CHANNEL] });
    expect(() => assertCommandAllowed(config, { channelId: OTHER_CHANNEL, roleIds: [] })).toThrow(
      /canais específicos/,
    );
  });

  it('exige pelo menos um dos cargos permitidos', () => {
    const config = override({ allowedRoleIds: [ROLE] });
    expect(() => assertCommandAllowed(config, { channelId: CHANNEL, roleIds: [] })).toThrow(/cargo/);
    expect(() =>
      assertCommandAllowed(config, { channelId: CHANNEL, roleIds: [ROLE] }),
    ).not.toThrow();
  });

  it('sempre lança erro que vira embed para o usuário', () => {
    try {
      assertCommandAllowed(override({ enabled: false }), { channelId: CHANNEL, roleIds: [] });
      expect.unreachable();
    } catch (error) {
      expect(isUserFacingError(error)).toBe(true);
    }
  });
});
