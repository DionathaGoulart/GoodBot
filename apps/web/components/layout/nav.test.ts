import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CONFIG_PAGE_KEYS } from '@/lib/config-pages';

import { groupLabelForPath, labelForPath, NAV_GROUPS, navGroupsFor } from './nav';

const APP = fileURLToPath(new URL('../../app/g/[guildId]', import.meta.url));

describe('NAV_GROUPS', () => {
  // O item que aponta para uma tela que não existe é um 404 esperando alguém
  // clicar — e a sidebar é a única lista de telas do painel.
  it.each(NAV_GROUPS.flatMap((group) => group.items.map((item) => [item.href, item.label])))(
    'a rota %s (%s) existe no App Router',
    (href) => {
      expect(existsSync(`${APP}${href}/page.tsx`)).toBe(true);
    },
  );

  it('não repete href entre grupos', () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // A sidebar e o índice `/config` são duas listas da mesma coisa; uma tela de
  // configuração que só existisse numa delas ficaria invisível na outra.
  it('tem um item para cada tela de configuração', () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    for (const page of CONFIG_PAGE_KEYS) {
      expect(hrefs).toContain(`/config/${page}`);
    }
  });

  it('esconde de um mod o que é de admin e de owner', () => {
    const visible = navGroupsFor('mod').flatMap((group) => group.items.map((item) => item.href));
    expect(visible).not.toContain('/servidor');
    expect(visible).not.toContain('/system');
    expect(navGroupsFor('owner').flatMap((g) => g.items).length).toBe(
      NAV_GROUPS.flatMap((g) => g.items).length,
    );
  });
});

describe('labelForPath', () => {
  it('casa a rota mais longa, não a primeira', () => {
    expect(labelForPath('1', '/g/1')).toBe('Dashboard');
    expect(labelForPath('1', '/g/1/config')).toBe('Todas as telas');
    expect(labelForPath('1', '/g/1/config/logs')).toBe('Logs');
    expect(labelForPath('1', '/g/1/membros/42')).toBe('Membros');
    expect(labelForPath('1', '/g/1/nao-existe')).toBeNull();
  });
});

describe('groupLabelForPath', () => {
  it('devolve o grupo que a sidebar precisa manter aberto', () => {
    expect(groupLabelForPath('1', '/g/1/config/automod')).toBe('CONFIGURAÇÃO');
    expect(groupLabelForPath('1', '/g/1/emojis')).toBe('COMUNIDADE');
    expect(groupLabelForPath('1', '/g/1/banidos')).toBe('MODERAÇÃO');
    expect(groupLabelForPath('1', '/g/1/membros')).toBe('SERVIDOR');
    expect(groupLabelForPath('1', '/g/1/system')).toBe('SISTEMA');
  });
});
