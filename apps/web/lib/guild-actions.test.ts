import { beforeEach, describe, expect, it, vi } from 'vitest';

const GUILD_ID = '100000000000000000';
const ACTOR = '200000000000000000';
const ROLE = '300000000000000000';
const CHANNEL = '400000000000000000';

const createRole = vi.fn();
const updateRole = vi.fn();
const deleteRole = vi.fn();
const setMemberRoles = vi.fn();
const moderate = vi.fn();
const setChannelOverrides = vi.fn();
const channel = vi.fn();
const withAudit = vi.fn();
const revalidatePath = vi.fn();

/** O nível que `requireGuildAccess` vai conceder no teste da vez. */
let level: 'mod' | 'admin' = 'admin';

vi.mock('server-only', () => ({}));
vi.mock('@goodbot/db', () => ({
  listCasesForTarget: vi.fn(),
  countCasesForTarget: vi.fn(),
}));
vi.mock('./db', () => ({ db: () => ({}) }));
vi.mock('./audit', () => ({ withAudit: (...args: unknown[]) => withAudit(...args) }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('./internal-api', () => ({
  internalApi: () => ({
    createRole,
    updateRole,
    deleteRole,
    setMemberRoles,
    moderate,
    setChannelOverrides,
    channel,
  }),
}));
vi.mock('./auth/require', () => ({
  /**
   * O `requireGuildAccess` de verdade faz `redirect()` quando o nível não
   * basta, e `redirect` lança. O mock imita isso lançando, que é o que importa:
   * a action nunca chega a escrever.
   */
  requireGuildAccess: (_guildId: string, minimum: 'mod' | 'admin') => {
    if (minimum === 'admin' && level !== 'admin') throw new Error('NEXT_REDIRECT');
    return Promise.resolve({
      user: { id: ACTOR, name: 'mod#1', image: null },
      level,
      guildId: GUILD_ID,
    });
  },
}));

const { saveRole, removeRole } = await import('./roles');
const { setMemberRoles: setMemberRolesAction, punishMember } = await import('./members');
const { setChannelOverrides: setOverrides, toChannelTree } = await import('./channels');

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  level = 'admin';
  createRole.mockResolvedValue({
    id: ROLE,
    name: 'Mod',
    color: 0,
    position: 3,
    managed: false,
    hoist: false,
    mentionable: false,
    permissions: '0',
  });
  channel.mockResolvedValue({
    id: CHANNEL,
    name: 'geral',
    type: 0,
    parentId: null,
    position: 0,
    topic: null,
    nsfw: false,
    slowmodeSeconds: 0,
    overrides: [],
  });
});

describe('nível insuficiente', () => {
  it('mod não cria, não apaga cargo e não mexe em cargos de membro', async () => {
    level = 'mod';

    await expect(
      saveRole(GUILD_ID, form({ role: JSON.stringify({ name: 'Mod' }) })),
    ).rejects.toThrow('NEXT_REDIRECT');
    await expect(removeRole(GUILD_ID, form({ roleId: ROLE }))).rejects.toThrow('NEXT_REDIRECT');
    await expect(
      setMemberRolesAction(
        GUILD_ID,
        form({ userId: ACTOR, roles: JSON.stringify({ add: [ROLE] }) }),
      ),
    ).rejects.toThrow('NEXT_REDIRECT');
    await expect(
      setOverrides(GUILD_ID, form({ channelId: CHANNEL, overrides: JSON.stringify([]) })),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(createRole).not.toHaveBeenCalled();
    expect(deleteRole).not.toHaveBeenCalled();
    expect(setMemberRoles).not.toHaveBeenCalled();
    expect(setChannelOverrides).not.toHaveBeenCalled();
    expect(withAudit).not.toHaveBeenCalled();
  });

  it('mod ainda pode punir: punir é nível mod (§9.2)', async () => {
    level = 'mod';
    moderate.mockResolvedValue({
      caseId: 1,
      caseNumber: 7,
      type: 'warn',
      expiresAt: null,
      dmSent: true,
    });

    const result = await punishMember(
      GUILD_ID,
      form({ action: JSON.stringify({ type: 'warn', targetId: ROLE, reason: 'spam' }) }),
    );

    expect(result.ok).toBe(true);
    expect(moderate).toHaveBeenCalledWith(GUILD_ID, expect.objectContaining({ actorId: ACTOR }));
    expect(withAudit).toHaveBeenCalled();
  });
});

describe('payloads', () => {
  it('o actorId vem sempre da sessão, nunca do corpo', async () => {
    await saveRole(
      GUILD_ID,
      form({ role: JSON.stringify({ name: 'Mod', actorId: '999999999999999999' }) }),
    );

    expect(createRole).toHaveBeenCalledWith(GUILD_ID, expect.objectContaining({ actorId: ACTOR }));
  });

  it('cargo inválido não vira chamada nem auditoria', async () => {
    const result = await saveRole(GUILD_ID, form({ role: JSON.stringify({ name: '' }) }));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toHaveProperty('name');
    expect(createRole).not.toHaveBeenCalled();
    expect(withAudit).not.toHaveBeenCalled();
  });

  it('override com estado inventado é recusado antes de sair do painel', async () => {
    const result = await setOverrides(
      GUILD_ID,
      form({
        channelId: CHANNEL,
        overrides: JSON.stringify([{ roleId: ROLE, view: 'talvez', send: 'inherit' }]),
      }),
    );

    expect(result.ok).toBe(false);
    expect(setChannelOverrides).not.toHaveBeenCalled();
  });

  it('override válido chega ao bot com o actorId da sessão', async () => {
    setChannelOverrides.mockResolvedValue({});
    const overrides = [{ roleId: ROLE, view: 'deny', send: 'inherit' }];

    const result = await setOverrides(
      GUILD_ID,
      form({ channelId: CHANNEL, overrides: JSON.stringify(overrides) }),
    );

    expect(result.ok).toBe(true);
    expect(setChannelOverrides).toHaveBeenCalledWith(GUILD_ID, CHANNEL, {
      actorId: ACTOR,
      overrides,
    });
  });
});

describe('toChannelTree', () => {
  const channels = [
    { id: '1', name: 'Textos', type: 4, parentId: null, position: 1 },
    { id: '2', name: 'geral', type: 0, parentId: '1', position: 1 },
    { id: '3', name: 'regras', type: 0, parentId: '1', position: 0 },
    { id: '4', name: 'solto', type: 0, parentId: null, position: 0 },
  ];

  it('agrupa por categoria e ordena pelos números do Discord', () => {
    const tree = toChannelTree(channels);

    expect(tree.map((branch) => branch.name)).toEqual(['SEM CATEGORIA', 'Textos']);
    expect(tree[1]?.children.map((c) => c.name)).toEqual(['regras', 'geral']);
  });

  it('sem canais soltos o grupo "sem categoria" não aparece', () => {
    const tree = toChannelTree(channels.filter((c) => c.id !== '4'));

    expect(tree.map((branch) => branch.name)).toEqual(['Textos']);
  });
});
