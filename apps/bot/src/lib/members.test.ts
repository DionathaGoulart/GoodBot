import { describe, expect, it, vi } from 'vitest';

import { MEMBER_LIST_PAGE, ROLE_SCAN_MAX_PAGES, roleMemberCounts } from './members';

import type { Guild, GuildMember } from 'discord.js';

const EVERYONE = '111111111111111111';
const CARGO = '222222222222222222';

function member(id: string, roleIds: string[]): GuildMember {
  return { id, roles: { cache: new Map(roleIds.map((r) => [r, {}])) } } as unknown as GuildMember;
}

function guild(input: {
  memberCount: number;
  cached?: GuildMember[];
  pages?: GuildMember[][];
  list?: () => Promise<never>;
}): { guild: Guild; list: ReturnType<typeof vi.fn> } {
  const pages = input.pages ?? [];
  const list = vi.fn((options: { after?: string }) => {
    if (input.list) return input.list();
    // Página seguinte a cada chamada; o `after` do chamador é só o cursor.
    const index = pages.findIndex((page) => page[0] && page[0].id > (options.after ?? ''));
    const page = index === -1 ? [] : pages[index];
    return Promise.resolve(new Map((page ?? []).map((m) => [m.id, m])));
  });

  return {
    list,
    guild: {
      memberCount: input.memberCount,
      members: { cache: new Map((input.cached ?? []).map((m) => [m.id, m])), list },
    } as unknown as Guild,
  };
}

describe('roleMemberCounts', () => {
  it('conta no cache quando ele tem o servidor inteiro — sem chamada nenhuma', async () => {
    const { guild: g, list } = guild({
      memberCount: 2,
      cached: [member('1', [EVERYONE, CARGO]), member('2', [EVERYONE])],
    });

    const counts = await roleMemberCounts(g);

    expect(counts?.get(EVERYONE)).toBe(2);
    expect(counts?.get(CARGO)).toBe(1);
    expect(list).not.toHaveBeenCalled();
  });

  it('varre por REST quando o cache é só uma amostra', async () => {
    const { guild: g, list } = guild({
      memberCount: 3,
      cached: [member('1', [EVERYONE, CARGO])],
      pages: [[member('1', [EVERYONE, CARGO]), member('2', [EVERYONE]), member('3', [CARGO])]],
    });

    const counts = await roleMemberCounts(g);

    expect(counts?.get(EVERYONE)).toBe(2);
    expect(counts?.get(CARGO)).toBe(2);
    // Varredura não cacheia: era isso que despejava quem a moderação trata.
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ cache: false }));
  });

  it('desiste de contar servidor grande demais em vez de varrer tudo', async () => {
    const { guild: g, list } = guild({
      memberCount: MEMBER_LIST_PAGE * ROLE_SCAN_MAX_PAGES + 1,
      cached: [member('1', [EVERYONE])],
    });

    await expect(roleMemberCounts(g)).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('falha na varredura vira "não sei", não erro na tela', async () => {
    const { guild: g } = guild({
      memberCount: 50,
      cached: [member('1', [EVERYONE])],
      list: () => Promise.reject(new Error('intent GuildMembers desligada')),
    });

    await expect(roleMemberCounts(g)).resolves.toBeNull();
  });

  it('cargo sem ninguém não aparece no mapa (o chamador lê como zero)', async () => {
    const { guild: g } = guild({
      memberCount: 1,
      cached: [member('1', [EVERYONE])],
    });

    const counts = await roleMemberCounts(g);

    expect(counts?.has(CARGO)).toBe(false);
  });
});
