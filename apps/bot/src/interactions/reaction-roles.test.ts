import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPanel = vi.fn();

vi.mock('@goodbot/db', () => ({
  getPanel: (...args: unknown[]) => getPanel(...args),
  setPanelMessage: vi.fn(),
}));

const { handleReactionRoleComponent } = await import('./reaction-roles');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('menu publicado antes de editar os itens', () => {
  for (const mode of ['single', 'toggle'] as const) {
    it(`não remove cargos com valor obsoleto no modo ${mode}`, async () => {
      const remove = vi.fn();
      const add = vi.fn();
      getPanel.mockResolvedValue({
        id: 'panel',
        mode,
        items: [{ id: 'new-item', roleId: 'role-a' }],
      });
      const member = {
        id: 'user',
        roles: { cache: new Map([['role-a', {}]]), remove, add },
      };
      const interaction = {
        customId: 'rr:panel',
        values: ['old-item'],
        guildId: 'guild',
        member,
        isStringSelectMenu: () => true,
        deferReply: vi.fn(),
        editReply: vi.fn(),
      };
      const ctx = { config: { get: () => ({ enabled: true }) }, db: {} };

      expect(await handleReactionRoleComponent(ctx as never, interaction as never)).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Esta opção não faz mais parte do painel.',
      });
    });
  }
});
