import { describe, expect, it } from 'vitest';

import avisos from './avisos';
import { communityCommands } from './index';
import jogatinas from './jogatinas';
import marcar from './marcar';
import procurar from './procurar';
import squad, { guidesText } from './squad';

import type { APIApplicationCommandOption } from 'discord.js';

const options = (squad.data.toJSON().options ?? []) as APIApplicationCommandOption[];

describe('comandos do buscar squad', () => {
  it('os quatro de topo são de member e do módulo squads', () => {
    for (const command of [procurar, marcar, jogatinas, avisos]) {
      expect(command.level).toBe('member');
      expect(command.module).toBe('squads');
      expect(command.ephemeral).toBe(true);
    }
  });

  it('os que abrem modal não adiam a interação', () => {
    for (const command of [procurar, marcar]) {
      expect(command.opensModal).toBe(true);
      expect(command.defer).toBeFalsy();
    }
  });

  it('estão todos registrados', () => {
    const names = communityCommands.map((command) => command.data.name);
    for (const name of ['procurar', 'marcar', 'jogatinas', 'avisos', 'squad']) {
      expect(names).toContain(name);
    }
  });
});

describe('/squad', () => {
  it('sobrou só o painel, de admin', () => {
    expect(options.map((option) => option.name)).toEqual(['painel']);
    expect(squad.level).toBe('admin');
    expect(squad.help).toContain('`painel`');
  });

  it('o resumo diz o que foi publicado, reeditado e o que não tem canal', () => {
    const text = guidesText({
      chatGuide: { channelId: '300000000000000010', messageId: '1', created: true },
      deskGuide: { channelId: '300000000000000011', messageId: '2', created: false },
      deskButtons: null,
    });
    expect(text).toContain('Guia do chat: publicado em <#300000000000000010>');
    expect(text).toContain('Guia das jogatinas: atualizado em <#300000000000000011>');
    expect(text).toContain('Botões: sem canal configurado');
  });
});
