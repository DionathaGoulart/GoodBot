import { MAX_PURGE } from '@cobot/shared';
import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';

import clear from './clear';
import purge from './purge';

import type { APIApplicationCommandOption } from 'discord.js';

const json = clear.data.toJSON();
const options = (json.options ?? []) as APIApplicationCommandOption[];
const byName = new Map(options.map((option) => [option.name, option]));

describe('/clear', () => {
  it('pede no máximo o número de mensagens, e nem isso', () => {
    const amount = byName.get('quantidade');
    expect(amount?.required).toBeFalsy();
    expect(amount).toMatchObject({ min_value: 1, max_value: MAX_PURGE });
  });

  // A versão simples é o ponto: com os oito filtros ela seria o `/purge`.
  it('fica só nos filtros que a limpeza do dia a dia usa', () => {
    expect([...byName.keys()]).toEqual(['quantidade', 'usuario', 'canal']);
  });

  it('exige o mesmo que o /purge para aparecer e para rodar', () => {
    expect(json.default_member_permissions).toBe(String(PermissionFlagsBits.ManageMessages));
    expect(clear.level).toBe(purge.level);
    expect(clear.module).toBe(purge.module);
    // Adia e responde efêmero: apagar 50 mensagens não cabe nos 3s da interação.
    expect(clear.defer).toBe(true);
    expect(clear.ephemeral).toBe(true);
  });
});
