import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import { appendAudit } from './audit';
import { createCase, getCaseByNumber, listCasesForTarget, nextCaseNumber } from './cases';
import {
  getAllModuleConfigs,
  getModuleConfig,
  setModuleConfig,
  setModuleEnabled,
} from './configs';
import { guilds } from '../schema/guilds';

loadRootEnv();
const url = process.env.DATABASE_URL;

// Guild fictícia (snowflake válido) para isolar o teste; removida no fim.
const GUILD_ID = `9${String(Date.now()).padStart(17, '0')}`;
const USER_A = '100000000000000001';
const USER_B = '100000000000000002';

describe.skipIf(!url)('repositories (integração com Postgres)', () => {
  let db: Db;
  let end: () => Promise<void>;

  beforeAll(async () => {
    const client = createDb(url!, { max: 3 });
    db = client.db;
    end = () => client.sql.end();
    await db.insert(guilds).values({ id: GUILD_ID, name: 'Teste', ownerId: USER_A });
  });

  afterAll(async () => {
    await db.delete(guilds).where(eq(guilds.id, GUILD_ID));
    await end();
  });

  describe('configs', () => {
    it('sem linha: devolve o default e stored=false', async () => {
      const result = await getModuleConfig(db, GUILD_ID, 'tags');
      expect(result.stored).toBe(false);
      expect(result.config.maxTags).toBe(200);
      expect(result.enabled).toBe(false);
    });

    it('setModuleConfig → getModuleConfig roundtrip com defaults preenchidos', async () => {
      const saved = await setModuleConfig(
        db,
        GUILD_ID,
        'tags',
        { enabled: true, maxTags: 50, managerRoleIds: ['123456789012345678'] },
        USER_A,
      );
      expect(saved.version).toBe(1);
      expect(saved.cooldownSeconds).toBe(3);

      const read = await getModuleConfig(db, GUILD_ID, 'tags');
      expect(read.stored).toBe(true);
      expect(read.enabled).toBe(true);
      expect(read.config).toEqual(saved);
      expect(read.updatedBy).toBe(USER_A);
    });

    it('setModuleEnabled preserva o resto do config', async () => {
      await setModuleEnabled(db, GUILD_ID, 'tags', false, USER_B);
      const read = await getModuleConfig(db, GUILD_ID, 'tags');
      expect(read.enabled).toBe(false);
      expect(read.config.maxTags).toBe(50);
      expect(read.updatedBy).toBe(USER_B);
    });

    it('rejeita config inválido sem gravar', async () => {
      await expect(
        setModuleConfig(db, GUILD_ID, 'tags', { maxTags: -1 } as never),
      ).rejects.toThrow();
      const read = await getModuleConfig(db, GUILD_ID, 'tags');
      expect(read.config.maxTags).toBe(50);
    });

    it('getAllModuleConfigs devolve todos os módulos', async () => {
      const all = await getAllModuleConfigs(db, GUILD_ID);
      expect(all.tags.stored).toBe(true);
      expect(all.moderation.stored).toBe(false);
      expect(all.moderation.config.defaultReason).toBe('[sem motivo]');
      expect(Object.keys(all)).toHaveLength(11);
    });
  });

  describe('cases', () => {
    const base = {
      guildId: GUILD_ID,
      targetId: USER_B,
      targetTag: 'alvo',
      actorId: USER_A,
      actorTag: 'mod',
      reason: 'teste',
    } as const;

    it('numera casos sequencialmente por guild', async () => {
      expect(await nextCaseNumber(db, GUILD_ID)).toBe(1);
      const c1 = await createCase(db, { ...base, type: 'warn' });
      const c2 = await createCase(db, { ...base, type: 'kick' });
      expect(c1.caseNumber).toBe(1);
      expect(c2.caseNumber).toBe(2);
      expect(c2.source).toBe('command');
      expect(await nextCaseNumber(db, GUILD_ID)).toBe(3);
    });

    it('mantém a sequência sob inserções concorrentes', async () => {
      const created = await Promise.all(
        Array.from({ length: 8 }, () => createCase(db, { ...base, type: 'note' })),
      );
      const numbers = created.map((c) => c.caseNumber).sort((a, b) => a - b);
      expect(numbers).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('busca por número e lista histórico do alvo', async () => {
      const found = await getCaseByNumber(db, GUILD_ID, 2);
      expect(found?.type).toBe('kick');
      expect(await getCaseByNumber(db, GUILD_ID, 999)).toBeNull();

      const history = await listCasesForTarget(db, GUILD_ID, USER_B, { type: 'note', limit: 3 });
      expect(history).toHaveLength(3);
      expect(history.every((c) => c.type === 'note')).toBe(true);
    });
  });

  describe('audit', () => {
    it('appendAudit grava e devolve a linha', async () => {
      const row = await appendAudit(db, {
        guildId: GUILD_ID,
        actorId: USER_A,
        actorTag: 'mod',
        action: 'config.update',
        targetType: 'module',
        targetId: 'tags',
        before: { maxTags: 200 },
        after: { maxTags: 50 },
      });
      expect(row.id).toBeGreaterThan(0);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.after).toEqual({ maxTags: 50 });
    });
  });
});
