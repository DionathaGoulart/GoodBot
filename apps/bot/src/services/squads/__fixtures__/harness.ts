import { DEFAULT_SQUADS_CONFIG } from '@goodbot/shared';
import { Collection } from 'discord.js';
import { vi } from 'vitest';

import { SquadService } from '../index';
import { fakeCategory, fakeGuild, fakeSearchChannel, fakeVoice } from './discord';
import { fakeDb, GUILD_ID, resetStore } from './fake-db';

import type { ConfigService } from '../../config';
import type { SquadParts } from '../context';
import type { SquadsConfig } from '@goodbot/shared';
import type { Client, Guild } from 'discord.js';

/** Segunda-feira, meio-dia UTC. */
export const NOW = Date.parse('2026-09-14T12:00:00Z');

export const A = '300000000000000001';
export const B = '300000000000000002';
export const C = '300000000000000003';
export const D = '300000000000000004';

/**
 * Service de squads com banco em memória, uma guild falsa com categoria,
 * canal de busca e dois voices no pool, config ligado e relógio controlável.
 */
export function createHarness(overrides: Partial<SquadsConfig> = {}) {
  const clock = { now: NOW };
  resetStore(() => clock.now);

  const guild = fakeGuild();
  const category = guild.add(fakeCategory());
  const search = fakeSearchChannel(guild);
  const voices = [guild.add(fakeVoice()), guild.add(fakeVoice())];

  let config: SquadsConfig = {
    ...DEFAULT_SQUADS_CONFIG,
    enabled: true,
    categoryId: category.id,
    searchChannelId: search.id,
    voicePoolIds: voices.map((voice) => voice.id),
    ...overrides,
  };
  const configService = {
    get: vi.fn(async () => config),
    getSettings: vi.fn(async () => ({ timezone: 'America/Sao_Paulo', embedColor: 0xdc143c })),
    invalidate: vi.fn(),
    publishInvalidate: vi.fn(),
  };
  const audit = { record: vi.fn() };
  const client = { guilds: { cache: new Collection([[GUILD_ID, guild]]) } };

  const service = new SquadService({
    db: fakeDb,
    client: client as unknown as Client,
    config: configService as unknown as ConfigService,
    audit,
    now: () => clock.now,
  });

  return {
    service,
    /** As partes por trás da fachada, para testar o que ela não expõe. */
    parts: (service as unknown as { ctx: { parts: SquadParts } }).ctx.parts,
    client: client as unknown as Client,
    guild,
    /** A mesma guild, com o tipo que o service espera. */
    discordGuild: guild as unknown as Guild,
    category,
    search,
    voices,
    audit,
    configService,
    clock,
    setConfig(next: Partial<SquadsConfig>): void {
      config = { ...config, ...next };
    },
  };
}
export type Harness = ReturnType<typeof createHarness>;
