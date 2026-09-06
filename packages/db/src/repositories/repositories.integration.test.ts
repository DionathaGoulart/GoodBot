import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import { appendAudit } from './audit';
import { createCase, getCaseByNumber, listCasesForTarget, nextCaseNumber } from './cases';
import { getAllModuleConfigs, getModuleConfig, setModuleConfig, setModuleEnabled } from './configs';
import {
  automodByRule,
  commandsUsage,
  heatmapHourWeekday,
  incrementStatBuckets,
  membersGrowth,
  messagesPerDay,
  rollupHourlyBuckets,
  setStatBucket,
  summary,
  ticketsPerDay,
  topChannels,
  topUsers,
  type StatIncrement,
  type StatsPeriod,
} from './stats';
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

  describe('stats', () => {
    const CHANNEL_A = '400000000000000001';
    const CHANNEL_B = '400000000000000002';
    const TZ = 'America/Sao_Paulo';
    /** 2026-03-10, 15:00 e 18:00 UTC (12h e 15h em SP) e 2026-03-11 às 15:00. */
    const H1 = new Date('2026-03-10T15:00:00.000Z');
    const H2 = new Date('2026-03-10T18:00:00.000Z');
    const H3 = new Date('2026-03-11T15:00:00.000Z');

    const period: StatsPeriod = {
      guildId: GUILD_ID,
      from: new Date('2026-03-01T00:00:00.000Z'),
      to: new Date('2026-03-20T00:00:00.000Z'),
      timezone: TZ,
    };

    const hour = (
      kind: StatIncrement['kind'],
      key: string,
      bucketStart: Date,
      count: number,
    ): StatIncrement => ({ guildId: GUILD_ID, kind, key, bucketStart, granularity: 'hour', count });

    beforeAll(async () => {
      await incrementStatBuckets(db, [
        hour('messages_channel', CHANNEL_A, H1, 20),
        hour('messages_channel', CHANNEL_B, H1, 5),
        hour('messages_channel', CHANNEL_A, H2, 7),
        hour('messages_channel', CHANNEL_A, H3, 3),
        hour('messages_user', USER_A, H1, 18),
        hour('messages_user', USER_B, H1, 7),
        hour('joins', '_', H1, 4),
        hour('leaves', '_', H2, 1),
        hour('cases_type', 'ban', H1, 2),
        hour('automod_rule', 'regra-1', H1, 6),
        hour('commands', 'ban', H1, 3),
        hour('tickets_open', '_', H1, 2),
        hour('tickets_closed', '_', H2, 1),
        hour('voice_minutes_channel', CHANNEL_A, H1, 45),
      ]);
      await setStatBucket(db, {
        guildId: GUILD_ID,
        kind: 'members_total',
        key: '_',
        bucketStart: new Date('2026-03-10T03:00:00.000Z'),
        granularity: 'day',
        count: 1500,
      });
    });

    it('incrementStatBuckets soma no mesmo bucket em vez de duplicar', async () => {
      await incrementStatBuckets(db, [hour('messages_channel', CHANNEL_B, H1, 5)]);
      const rows = await messagesPerDay(db, period);
      // 20 + 5 + 5 no dia 10 (15h e 18h UTC caem no mesmo dia em SP), 3 no dia 11.
      expect(rows).toEqual([
        { date: '2026-03-10', count: 37 },
        { date: '2026-03-11', count: 3 },
      ]);
    });

    it('setStatBucket substitui em vez de somar', async () => {
      await setStatBucket(db, {
        guildId: GUILD_ID,
        kind: 'members_total',
        key: '_',
        bucketStart: new Date('2026-03-10T03:00:00.000Z'),
        granularity: 'day',
        count: 1510,
      });
      const growth = await membersGrowth(db, period);
      expect(growth.find((row) => row.date === '2026-03-10')?.total).toBe(1510);
    });

    it('membersGrowth junta entradas, saídas e o snapshot do dia', async () => {
      const rows = await membersGrowth(db, period);
      const day = rows.find((row) => row.date === '2026-03-10');
      expect(day).toMatchObject({ joins: 4, leaves: 1, total: 1510 });
    });

    it('heatmap usa a hora local da guild', async () => {
      const cells = await heatmapHourWeekday(db, period);
      // 15:00Z de uma terça = 12h de terça (dow 2) em São Paulo.
      expect(cells).toContainEqual({ weekday: 2, hour: 12, count: 30 });
      expect(cells).toContainEqual({ weekday: 2, hour: 15, count: 7 });
    });

    it('rankings ordenam por total', async () => {
      expect(await topChannels(db, period)).toEqual([
        { id: CHANNEL_A, count: 30 },
        { id: CHANNEL_B, count: 10 },
      ]);
      expect(await topUsers(db, period, 1)).toEqual([{ id: USER_A, count: 18 }]);
      expect(await automodByRule(db, period)).toEqual([{ id: 'regra-1', count: 6 }]);
      expect(await commandsUsage(db, period)).toEqual([{ id: 'ban', count: 3 }]);
    });

    it('ticketsPerDay separa abertos de fechados', async () => {
      expect(await ticketsPerDay(db, period)).toEqual([
        { date: '2026-03-10', opened: 2, closed: 1 },
      ]);
    });

    it('summary traz os totais e o delta contra a janela anterior', async () => {
      const result = await summary(db, period);
      expect(result.messages).toMatchObject({ current: 40, previous: 0, delta: 40 });
      expect(result.voiceMinutes.current).toBe(45);
      expect(result.membersTotal).toBe(1510);
    });

    it('rollup agrega os horários em diários e apaga os horários', async () => {
      const before = new Date('2026-03-11T00:00:00.000Z');
      const result = await rollupHourlyBuckets(db, { guildId: GUILD_ID, before, timezone: TZ });
      expect(result.removed).toBeGreaterThan(0);

      // Os totais por dia não podem mudar depois da agregação.
      const rows = await messagesPerDay(db, period);
      expect(rows).toEqual([
        { date: '2026-03-10', count: 37 },
        { date: '2026-03-11', count: 3 },
      ]);

      // A hora deixou de existir: o heatmap só enxerga o que sobrou horário.
      const cells = await heatmapHourWeekday(db, period);
      expect(cells.every((cell) => cell.count === 3)).toBe(true);
    });

    it('rollup rodado de novo não duplica nada', async () => {
      const before = new Date('2026-03-11T00:00:00.000Z');
      const result = await rollupHourlyBuckets(db, { guildId: GUILD_ID, before, timezone: TZ });
      expect(result.removed).toBe(0);
      expect(await messagesPerDay(db, period)).toEqual([
        { date: '2026-03-10', count: 37 },
        { date: '2026-03-11', count: 3 },
      ]);
    });
  });
});
