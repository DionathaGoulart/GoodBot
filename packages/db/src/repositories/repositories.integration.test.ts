import { MODULES } from '@cobot/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from '../client';
import { loadRootEnv } from '../env';
import { appendAudit, listAuditActions, listRecentAudit, searchAudit } from './audit';
import {
  createCase,
  getCaseByNumber,
  listCasesForTarget,
  listRecentCases,
  nextCaseNumber,
  searchCases,
  softDeleteCase,
} from './cases';
import {
  getAllModuleConfigs,
  getGuildSettings,
  getModuleConfig,
  setModuleConfig,
  setModuleEnabled,
} from './configs';
import {
  automodByRule,
  commandsUsage,
  dailySeries,
  seriesByDayAndKey,
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
import { guildSettings } from '../schema/configs';
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
      // Contra a lista de módulos, não contra um número: um módulo novo não
      // deve exigir editar este teste.
      expect(Object.keys(all)).toHaveLength(MODULES.length);
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

    it('listRecentCases traz os últimos casos da guild', async () => {
      const recent = await listRecentCases(db, GUILD_ID, 5);
      expect(recent).toHaveLength(5);
      expect(recent.every((c) => c.guildId === GUILD_ID && c.deletedAt === null)).toBe(true);
    });
  });

  describe('searchCases', () => {
    // Casos próprios desta suíte: alvo e moderador diferentes dos de cima.
    const ACTOR = '100000000000000003';
    const TARGET = '100000000000000004';
    const base = {
      guildId: GUILD_ID,
      targetId: TARGET,
      targetTag: 'alvo-busca',
      actorId: ACTOR,
      actorTag: 'mod-busca',
    } as const;

    beforeAll(async () => {
      await createCase(db, { ...base, type: 'ban', reason: 'spam no geral', source: 'dashboard' });
      await createCase(db, { ...base, type: 'kick', reason: 'flood de imagens' });
      await createCase(db, { ...base, type: 'warn', reason: 'ofensa à moderação' });
    });

    it('sem filtro devolve tudo da guild com o total', async () => {
      const all = await searchCases(db, { guildId: GUILD_ID, pageSize: 100 });
      expect(all.total).toBe(all.rows.length);
      expect(all.total).toBeGreaterThanOrEqual(13);
    });

    it('filtra por tipo e por origem', async () => {
      const bans = await searchCases(db, { guildId: GUILD_ID, type: ['ban'], targetId: TARGET });
      expect(bans.total).toBe(1);
      expect(bans.rows[0]?.reason).toBe('spam no geral');

      const dashboard = await searchCases(db, { guildId: GUILD_ID, source: ['dashboard'] });
      expect(dashboard.total).toBe(1);
    });

    it('combina tipo com período', async () => {
      const future = new Date(Date.now() + 60_000);
      const inWindow = await searchCases(db, {
        guildId: GUILD_ID,
        type: ['kick'],
        targetId: TARGET,
        from: new Date(Date.now() - 3_600_000),
        to: future,
      });
      expect(inWindow.total).toBe(1);

      const outOfWindow = await searchCases(db, {
        guildId: GUILD_ID,
        type: ['kick'],
        targetId: TARGET,
        from: future,
      });
      expect(outOfWindow.total).toBe(0);
      expect(outOfWindow.rows).toEqual([]);
    });

    it('busca por texto no motivo, na tag e no número do caso', async () => {
      expect((await searchCases(db, { guildId: GUILD_ID, q: 'flood' })).total).toBe(1);
      expect((await searchCases(db, { guildId: GUILD_ID, q: 'ALVO-BUSCA' })).total).toBe(3);
      expect((await searchCases(db, { guildId: GUILD_ID, q: 'ofensa à' })).total).toBe(1);

      const byNumber = await searchCases(db, { guildId: GUILD_ID, q: '#2' });
      expect(byNumber.rows.some((c) => c.caseNumber === 2)).toBe(true);
    });

    it('% e _ na busca são texto, não curinga', async () => {
      expect((await searchCases(db, { guildId: GUILD_ID, q: '%' })).total).toBe(0);
    });

    it('pagina e ordena', async () => {
      const first = await searchCases(db, {
        guildId: GUILD_ID,
        sort: 'caseNumber',
        direction: 'asc',
        page: 1,
        pageSize: 2,
      });
      const second = await searchCases(db, {
        guildId: GUILD_ID,
        sort: 'caseNumber',
        direction: 'asc',
        page: 2,
        pageSize: 2,
      });
      expect(first.rows.map((c) => c.caseNumber)).toEqual([1, 2]);
      expect(second.rows.map((c) => c.caseNumber)).toEqual([3, 4]);
      expect(first.total).toBe(second.total);
    });

    it('casos apagados só aparecem com includeDeleted', async () => {
      const created = await createCase(db, { ...base, type: 'note', reason: 'some daqui' });
      await softDeleteCase(db, GUILD_ID, created.caseNumber);

      expect((await searchCases(db, { guildId: GUILD_ID, q: 'some daqui' })).total).toBe(0);
      expect(
        (await searchCases(db, { guildId: GUILD_ID, q: 'some daqui', includeDeleted: true })).total,
      ).toBe(1);
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

    it('listRecentAudit devolve a linha recém-gravada', async () => {
      const recent = await listRecentAudit(db, GUILD_ID, 10);
      expect(recent[0]?.action).toBe('config.update');
    });

    it('searchAudit filtra por ator, família de ação e texto', async () => {
      await appendAudit(db, {
        guildId: GUILD_ID,
        actorId: USER_B,
        actorTag: 'outro-admin',
        action: 'member.ban',
        targetType: 'member',
        targetId: USER_A,
        before: null,
        after: { reason: 'spam' },
      });

      expect((await searchAudit(db, { guildId: GUILD_ID, actorId: USER_B })).total).toBe(1);
      // `config` casa `config.update`: o filtro é por família de ação.
      expect((await searchAudit(db, { guildId: GUILD_ID, action: 'config' })).total).toBe(1);
      expect((await searchAudit(db, { guildId: GUILD_ID, action: 'member.ban' })).total).toBe(1);
      expect((await searchAudit(db, { guildId: GUILD_ID, q: 'outro-admin' })).total).toBe(1);
      expect((await searchAudit(db, { guildId: GUILD_ID, q: 'nada disso' })).total).toBe(0);
    });

    it('searchAudit pagina e o total ignora a página', async () => {
      const page = await searchAudit(db, { guildId: GUILD_ID, page: 1, pageSize: 1 });
      expect(page.rows).toHaveLength(1);
      expect(page.total).toBe(2);
    });

    it('listAuditActions lista as ações distintas em ordem', async () => {
      expect(await listAuditActions(db, GUILD_ID)).toEqual(['config.update', 'member.ban']);
    });
  });

  describe('guild settings', () => {
    it('sem linha devolve null; com linha devolve o fuso', async () => {
      expect(await getGuildSettings(db, GUILD_ID)).toBeNull();
      await db.insert(guildSettings).values({ guildId: GUILD_ID, timezone: 'UTC' });
      expect((await getGuildSettings(db, GUILD_ID))?.timezone).toBe('UTC');
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

    it('dailySeries soma o kind inteiro por dia', async () => {
      expect(await dailySeries(db, period, 'cases_type')).toEqual([
        { date: '2026-03-10', count: 2 },
      ]);
    });

    it('seriesByDayAndKey quebra o dia por chave', async () => {
      const rows = await seriesByDayAndKey(db, period, 'messages_channel');
      expect(rows).toContainEqual({ date: '2026-03-10', key: CHANNEL_A, count: 27 });
      expect(rows).toContainEqual({ date: '2026-03-10', key: CHANNEL_B, count: 10 });
      expect(rows).toContainEqual({ date: '2026-03-11', key: CHANNEL_A, count: 3 });
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
