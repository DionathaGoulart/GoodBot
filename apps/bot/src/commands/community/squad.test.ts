import { describe, expect, it } from 'vitest';

import squad from './squad';

import type { APIApplicationCommandOption } from 'discord.js';

const json = squad.data.toJSON();
const options = (json.options ?? []) as APIApplicationCommandOption[];

describe('/squad', () => {
  it('é de member e do módulo squads: o painel confere admin no handler', () => {
    expect(squad.level).toBe('member');
    expect(squad.module).toBe('squads');
  });

  it('não adia a interação: o agendar abre modal', () => {
    expect(squad.opensModal).toBe(true);
    expect(squad.defer).toBeFalsy();
  });

  it('não tem mais os toggles de cargo da v1.8', () => {
    expect(options.map((option) => option.name).sort()).toEqual(['agenda', 'agendar', 'painel']);
  });

  it('o help cita todos os subcomandos', () => {
    for (const option of options) expect(squad.help).toContain(`\`${option.name}\``);
  });
});
