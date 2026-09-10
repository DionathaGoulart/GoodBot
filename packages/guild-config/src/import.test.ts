import { MANAGED_CHANNEL_TYPES, permissionsToBitfield } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { buildSpecFromState, toYaml } from './import';
import { buildPlan } from './plan';
import { GuildSpecSchema } from './schema';

import type { CurrentState } from './plan';
import type { GuildChannelDetail, GuildChannelSummary, GuildRoleSummary } from '@goodbot/shared';

const GUILD = '111111111111111111';

const role = (o: Partial<GuildRoleSummary> & { id: string; name: string }): GuildRoleSummary => ({
  color: 0,
  position: 1,
  managed: false,
  hoist: false,
  mentionable: false,
  permissions: '0',
  ...o,
});

const channel = (
  o: Partial<GuildChannelSummary> & { id: string; name: string },
): GuildChannelSummary => ({
  type: MANAGED_CHANNEL_TYPES.text,
  parentId: null,
  position: 0,
  ...o,
});

const detail = (
  base: GuildChannelSummary,
  o: Partial<GuildChannelDetail> = {},
): GuildChannelDetail => ({
  ...base,
  topic: null,
  nsfw: false,
  slowmodeSeconds: 0,
  overrides: [],
  ...o,
});

/** Um servidor com o suficiente de cada coisa para o retrato ter o que errar. */
function servidorRealista(): CurrentState {
  const everyone = role({ id: GUILD, name: '@everyone', position: 0 });
  const admin = role({
    id: '2',
    name: 'Admin',
    position: 3,
    color: 0xe74c3c,
    hoist: true,
    permissions: permissionsToBitfield(['Administrator']),
  });
  const mod = role({
    id: '3',
    name: 'Moderador',
    position: 2,
    permissions: permissionsToBitfield(['KickMembers', 'BanMembers']),
  });
  const botRole = role({ id: '9', name: 'Goodbot', position: 4, managed: true });

  const comunidade = channel({
    id: '10',
    name: 'Comunidade',
    type: MANAGED_CHANNEL_TYPES.category,
    position: 0,
  });
  const geral = channel({ id: '11', name: 'geral', parentId: '10', position: 0 });
  const voz = channel({
    id: '12',
    name: 'Sala 1',
    parentId: '10',
    position: 1,
    type: MANAGED_CHANNEL_TYPES.voice,
  });
  const staff = channel({
    id: '20',
    name: 'Staff',
    type: MANAGED_CHANNEL_TYPES.category,
    position: 1,
  });
  const logs = channel({ id: '21', name: 'logs', parentId: '20', position: 0 });
  const regras = channel({ id: '30', name: 'regras', position: 0 });

  return {
    roles: [everyone, admin, mod, botRole],
    channels: [comunidade, geral, voz, staff, logs, regras],
    details: new Map([
      ['10', detail(comunidade)],
      ['11', detail(geral, { topic: 'Papo livre.', slowmodeSeconds: 5 })],
      ['12', detail(voz)],
      [
        '20',
        detail(staff, {
          overrides: [
            { roleId: GUILD, view: 'deny', send: 'inherit' },
            { roleId: '3', view: 'allow', send: 'allow' },
          ],
        }),
      ],
      // Override no cargo do próprio bot: managed, então não vira `roles:`,
      // mas precisa aparecer em `overrides:` para o retrato ficar fiel.
      ['21', detail(logs, { overrides: [{ roleId: '9', view: 'allow', send: 'allow' }] })],
      ['30', detail(regras, { overrides: [{ roleId: GUILD, view: 'allow', send: 'deny' }] })],
    ]),
  };
}

describe('buildSpecFromState', () => {
  it('o plano contra o arquivo importado sai vazio', () => {
    const state = servidorRealista();
    const yaml = toYaml(buildSpecFromState(state, GUILD), 'Meu servidor');
    const spec = GuildSpecSchema.parse(parse(yaml));

    const plan = buildPlan(spec, state, { guildId: GUILD });

    expect(plan.warnings).toEqual([]);
    expect(plan.operations).toEqual([]);
  });

  it('lista os cargos de cima para baixo e ignora os de bot', () => {
    const { doc } = buildSpecFromState(servidorRealista(), GUILD);
    expect(doc.roles).toEqual([
      { name: 'Admin', color: '#e74c3c', hoist: true, permissions: ['Administrator'] },
      { name: 'Moderador', permissions: ['KickMembers', 'BanMembers'] },
    ]);
  });

  it('mantém override de cargo managed, que não entra em roles', () => {
    const { doc } = buildSpecFromState(servidorRealista(), GUILD);
    const staff = (doc.categories as Record<string, unknown>[]).find((c) => c.name === 'Staff');
    const logs = (staff?.channels as Record<string, unknown>[])[0];
    expect(logs?.overrides).toEqual([{ role: 'Goodbot', view: 'allow', send: 'allow' }]);
  });

  it('omite o que é padrão em vez de poluir o arquivo', () => {
    const { doc } = buildSpecFromState(servidorRealista(), GUILD);
    const comunidade = (doc.categories as Record<string, unknown>[])[0];
    const canais = comunidade?.channels as Record<string, unknown>[];
    // `geral` é text (padrão) e não tem nsfw nem override: só o que foge sai.
    expect(canais[0]).toEqual({ name: 'geral', topic: 'Papo livre.', slowmode: 5 });
    expect(canais[1]).toEqual({ name: 'Sala 1', type: 'voice' });
  });

  it('avisa sobre canal de tipo que o spec não representa', () => {
    const forum = channel({ id: '40', name: 'duvidas', type: 15 });
    const { doc, warnings } = buildSpecFromState(
      {
        roles: [role({ id: GUILD, name: '@everyone', position: 0 })],
        channels: [forum],
        details: new Map([['40', detail(forum)]]),
      },
      GUILD,
    );
    expect(doc.channels).toBeUndefined();
    expect(warnings.some((w) => w.includes('duvidas'))).toBe(true);
  });

  it('o YAML gerado carrega o cabeçalho e nenhum ID', () => {
    const yaml = toYaml(buildSpecFromState(servidorRealista(), GUILD), 'Meu servidor');
    expect(yaml).toContain('pnpm guild import');
    expect(yaml).not.toContain(GUILD);
    expect(yaml).not.toMatch(/\b\d{17,20}\b/u);
  });
});
