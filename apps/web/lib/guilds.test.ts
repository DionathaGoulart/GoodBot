import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuildGrant } from './auth/access';

const ALFA = '100000000000000001';
const BETA = '100000000000000002';
const GAMA = '100000000000000003';

const guildProfile = vi.fn();
let servidas: string[] = [];
let grants: Record<string, GuildGrant> | undefined = {};

vi.mock('server-only', () => ({}));
// `guilds.ts` só usa o `cache` do React (memoização por requisição); aqui ele
// é a própria função, sem contexto de requisição para depender.
vi.mock('react', () => ({ cache: <T,>(fn: T): T => fn }));
vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { id: 'u' }, guilds: grants }) }));
vi.mock('./registry', () => ({ servedGuildIds: () => Promise.resolve(servidas) }));
vi.mock('./internal-api', () => ({ cachedInternalApi: () => ({ guildProfile }) }));

const { listAccessibleGuilds } = await import('./guilds');

beforeEach(() => {
  vi.clearAllMocks();
  servidas = [ALFA, BETA, GAMA];
  grants = {
    [ALFA]: { level: 'owner', checkedAt: Date.now() },
    [BETA]: { level: 'none', checkedAt: Date.now() },
    [GAMA]: { level: 'mod', checkedAt: Date.now() },
  };
  guildProfile.mockImplementation((id: string) =>
    Promise.resolve({ name: id === ALFA ? 'Zulu' : 'Alfa', iconUrl: `https://cdn/${id}.png` }),
  );
});

describe('listAccessibleGuilds', () => {
  it('mostra só onde o usuário tem nível — o resto nem é nome que ele deva ler', async () => {
    const guilds = await listAccessibleGuilds();

    expect(guilds.map((g) => g.id)).toEqual([GAMA, ALFA]);
    expect(guilds.find((g) => g.id === BETA)).toBeUndefined();
  });

  it('ordena por nome, não pela ordem do registro', async () => {
    const guilds = await listAccessibleGuilds();
    expect(guilds.map((g) => g.name)).toEqual(['Alfa', 'Zulu']);
  });

  it('guild que o bot ainda não entrou aparece com o ID de rótulo', async () => {
    guildProfile.mockRejectedValue(new Error('404'));

    const guilds = await listAccessibleGuilds();

    expect(guilds.map((g) => g.name)).toEqual([ALFA, GAMA]);
    expect(guilds.every((g) => g.iconUrl === null)).toBe(true);
  });

  it('sem nível em lugar nenhum, a lista é vazia (e a tela explica)', async () => {
    grants = {};
    await expect(listAccessibleGuilds()).resolves.toEqual([]);
  });

  it('registro é a fonte: nível órfão de guild que saiu não vira acesso', async () => {
    servidas = [ALFA];

    const guilds = await listAccessibleGuilds();

    expect(guilds.map((g) => g.id)).toEqual([ALFA]);
  });
});
