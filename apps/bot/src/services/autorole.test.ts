import { scheduleAction } from '@goodbot/db';
import { AutoroleConfigSchema } from '@goodbot/shared';
import { describe, expect, it, vi } from 'vitest';

import { AutoroleService, selectAutoroleIds } from './autorole';

vi.mock('@goodbot/db', () => ({ scheduleAction: vi.fn() }));

it('persiste mesmo atraso curto para sobreviver ao restart', async () => {
  const service = new AutoroleService({
    db: {} as never,
    config: {
      get: vi
        .fn()
        .mockResolvedValue(
          AutoroleConfigSchema.parse({
            enabled: true,
            delaySeconds: 10,
            humanRoleIds: ['111111111111111111'],
          }),
        ),
    } as never,
  });
  await service.onJoin({ id: 'member', guild: { id: 'guild' }, user: { bot: false } } as never);
  expect(scheduleAction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      kind: 'autorole',
      payload: { targetId: 'member' },
      runAt: expect.any(Date),
    }),
  );
});

const config = (input: Record<string, unknown>) => AutoroleConfigSchema.parse(input);

describe('selectAutoroleIds', () => {
  it('separa humanos de bots', () => {
    const parsed = config({
      humanRoleIds: ['111111111111111111'],
      botRoleIds: ['222222222222222222'],
    });
    expect(selectAutoroleIds(parsed, false)).toEqual(['111111111111111111']);
    expect(selectAutoroleIds(parsed, true)).toEqual(['222222222222222222']);
  });

  it('devolve vazio quando a lista do lado certo está vazia', () => {
    const parsed = config({ humanRoleIds: ['111111111111111111'], botRoleIds: [] });
    expect(selectAutoroleIds(parsed, true)).toEqual([]);
  });

  it('não repete o mesmo cargo', () => {
    const parsed = config({
      humanRoleIds: ['111111111111111111', '111111111111111111', '222222222222222222'],
    });
    expect(selectAutoroleIds(parsed, false)).toEqual(['111111111111111111', '222222222222222222']);
  });

  it('não mistura o cargo de verificação com o autorole da entrada', () => {
    const parsed = config({
      humanRoleIds: ['111111111111111111'],
      verify: { enabled: true, roleId: '999999999999999999' },
    });
    expect(selectAutoroleIds(parsed, false)).toEqual(['111111111111111111']);
  });
});
