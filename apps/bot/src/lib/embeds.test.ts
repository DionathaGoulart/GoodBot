import { describe, expect, it } from 'vitest';

import { botFooter, infoEmbed } from './embeds';

describe('botFooter', () => {
  // A versão do bot aparecia em todo embed público — verificação, boas-vindas,
  // reaction roles. Quem lê é membro do servidor, não quem opera o bot.
  it('não devolve nada quando não há o que dizer', () => {
    expect(botFooter()).toBe('');
  });

  it('devolve só o sufixo', () => {
    expect(botFooter('TICKET #12')).toBe('TICKET #12');
  });

  it('embed sem sufixo sai sem rodapé', () => {
    expect(infoEmbed({ title: 'oi', footer: botFooter() }).toJSON().footer).toBeUndefined();
  });
});
