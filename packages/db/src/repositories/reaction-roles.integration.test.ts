import { MessageTemplateSchema } from '@goodbot/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPanel, getPanel, replacePanelItems, updatePanel } from './reaction-roles';
import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import { guilds } from '../schema/guilds';

loadRootEnv();
const url = process.env.DATABASE_URL;
const GUILD = `9${String(Date.now()).padStart(17, '0')}`;
const ROLE_A = '111111111111111111';
const ROLE_B = '222222222222222222';
const ROLE_C = '333333333333333333';

describe.skipIf(!url)('reaction roles: edição transacional', () => {
  let db: Db;
  let end: () => Promise<void>;

  beforeAll(async () => {
    const client = createDb(url!, { max: 2 });
    db = client.db;
    end = () => client.sql.end();
    await db.insert(guilds).values({ id: GUILD, name: 'Teste', ownerId: ROLE_A });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, GUILD));
    await end();
  });

  it('preserva UUIDs dos cargos mantidos, muda ordem e remove só o item excluído', async () => {
    const panel = await createPanel(db, {
      guildId: GUILD,
      channelId: ROLE_A,
      mode: 'single',
      style: 'buttons',
      content: MessageTemplateSchema.parse({ content: 'Cargos' }),
    });
    const first = await replacePanelItems(db, panel.id, [
      { roleId: ROLE_A, label: 'A' },
      { roleId: ROLE_B, label: 'B' },
    ]);

    const second = await replacePanelItems(db, panel.id, [
      { roleId: ROLE_B, label: 'B editado' },
      { roleId: ROLE_C, label: 'C' },
    ]);
    const after = await getPanel(db, GUILD, panel.id);

    expect(second[0]?.id).toBe(first[1]?.id);
    expect(second[0]?.label).toBe('B editado');
    expect(after?.items.map((item) => item.roleId)).toEqual([ROLE_B, ROLE_C]);
    expect(after?.items.some((item) => item.id === first[0]?.id)).toBe(false);
  });

  it('falha intermediária reverte metadados e itens', async () => {
    const panel = await createPanel(db, {
      guildId: GUILD,
      channelId: ROLE_A,
      mode: 'single',
      style: 'buttons',
      content: MessageTemplateSchema.parse({ content: 'Original' }),
    });
    await replacePanelItems(db, panel.id, [{ roleId: ROLE_A, label: 'A' }]);

    await expect(
      db.transaction(async (tx) => {
        await updatePanel(tx, GUILD, panel.id, {
          content: MessageTemplateSchema.parse({ content: 'Mudou' }),
        });
        await replacePanelItems(tx, panel.id, [{ roleId: ROLE_B, label: 'B' }]);
        throw new Error('falha induzida');
      }),
    ).rejects.toThrow('falha induzida');

    const after = await getPanel(db, GUILD, panel.id);
    expect(after?.content).toEqual(MessageTemplateSchema.parse({ content: 'Original' }));
    expect(after?.items.map((item) => item.roleId)).toEqual([ROLE_A]);
  });
});
