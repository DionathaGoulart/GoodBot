import { MANAGED_CHANNEL_TYPES, permissionsToBitfield } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import { buildPlan } from './plan';
import { GuildSpecSchema } from './schema';

import type { CurrentState } from './plan';
import type { GuildChannelDetail, GuildChannelSummary, GuildRoleSummary } from '@goodbot/shared';

const GUILD = '111111111111111111';

function role(over: Partial<GuildRoleSummary> & { id: string; name: string }): GuildRoleSummary {
  return {
    color: 0,
    position: 1,
    managed: false,
    hoist: false,
    mentionable: false,
    permissions: '0',
    ...over,
  };
}

function channel(
  over: Partial<GuildChannelSummary> & { id: string; name: string },
): GuildChannelSummary {
  return { type: MANAGED_CHANNEL_TYPES.text, parentId: null, position: 0, ...over };
}

function detail(
  base: GuildChannelSummary,
  over: Partial<GuildChannelDetail> = {},
): GuildChannelDetail {
  return { ...base, topic: null, nsfw: false, slowmodeSeconds: 0, overrides: [], ...over };
}

/** `@everyone` é sempre o cargo cujo ID é o da própria guild. */
const everyone = role({ id: GUILD, name: '@everyone', position: 0 });

function state(over: Partial<CurrentState> = {}): CurrentState {
  return { roles: [everyone], channels: [], details: new Map(), ...over };
}

const spec = (yaml: unknown) => GuildSpecSchema.parse(yaml);

describe('buildPlan', () => {
  it('cria tudo numa guild vazia', () => {
    const plan = buildPlan(
      spec({
        roles: [{ name: 'Mod', permissions: ['KickMembers'] }],
        categories: [{ name: 'Comunidade', channels: [{ name: 'geral' }] }],
      }),
      state(),
      { guildId: GUILD },
    );

    expect(plan.operations.map((o) => o.kind)).toEqual([
      'role.create',
      'category.create',
      'channel.create',
    ]);
  });

  it('não repete trabalho quando a guild já corresponde ao spec', () => {
    const mod = role({
      id: '2',
      name: 'Mod',
      permissions: permissionsToBitfield(['KickMembers']),
    });
    const categoria = channel({
      id: '10',
      name: 'Comunidade',
      type: MANAGED_CHANNEL_TYPES.category,
    });
    const geral = channel({ id: '11', name: 'geral', parentId: '10' });

    const plan = buildPlan(
      spec({
        roles: [{ name: 'Mod', permissions: ['KickMembers'] }],
        categories: [{ name: 'Comunidade', channels: [{ name: 'geral' }] }],
      }),
      state({
        roles: [everyone, mod],
        channels: [categoria, geral],
        details: new Map([
          ['10', detail(categoria)],
          ['11', detail(geral)],
        ]),
      }),
      { guildId: GUILD },
    );

    expect(plan.operations).toEqual([]);
  });

  it('preserva os bits de permissão que o painel não conhece', () => {
    // 1n << 46n não está no PERMISSION_BITS: o bot preserva, o diff ignora.
    const desconhecido = (BigInt(permissionsToBitfield(['KickMembers'])) | (1n << 46n)).toString();
    const plan = buildPlan(
      spec({ roles: [{ name: 'Mod', permissions: ['KickMembers'] }] }),
      state({ roles: [everyone, role({ id: '2', name: 'Mod', permissions: desconhecido })] }),
      { guildId: GUILD },
    );

    expect(plan.operations).toEqual([]);
  });

  it('detecta mudança de permissão, cor e slowmode', () => {
    const mod = role({ id: '2', name: 'Mod', color: 0x000000, permissions: '0' });
    const geral = channel({ id: '11', name: 'geral' });

    const plan = buildPlan(
      spec({
        roles: [{ name: 'Mod', color: '#ff0000', permissions: ['BanMembers'] }],
        channels: [{ name: 'geral', slowmode: 10 }],
      }),
      state({
        roles: [everyone, mod],
        channels: [geral],
        details: new Map([['11', detail(geral)]]),
      }),
      { guildId: GUILD },
    );

    const update = plan.operations.find((o) => o.kind === 'role.update');
    expect(update?.changes).toContain('permissoes');
    expect(update?.changes.some((c) => c.startsWith('cor:'))).toBe(true);
    expect(plan.operations.find((o) => o.kind === 'channel.update')?.changes).toContain(
      'slowmode: 0s para 10s',
    );
  });

  it('nunca apaga sem allowDelete', () => {
    const current = state({
      roles: [everyone, role({ id: '2', name: 'Sobra' })],
      channels: [channel({ id: '11', name: 'sobra' })],
      details: new Map([['11', detail(channel({ id: '11', name: 'sobra' }))]]),
    });

    expect(buildPlan(spec({}), current, { guildId: GUILD }).operations).toEqual([]);

    const kinds = buildPlan(spec({}), current, {
      guildId: GUILD,
      allowDelete: true,
    }).operations.map((o) => o.kind);
    expect(kinds).toEqual(['channel.delete', 'role.delete']);
  });

  it('ignora cargos de bot e o próprio @everyone nas remoções', () => {
    const plan = buildPlan(
      spec({}),
      state({ roles: [everyone, role({ id: '2', name: 'Goodbot', managed: true })] }),
      { guildId: GUILD, allowDelete: true },
    );

    expect(plan.operations).toEqual([]);
  });

  it('recusa @everyone como cargo mas aceita como alvo de override', () => {
    const plan = buildPlan(
      spec({
        roles: [{ name: '@everyone', permissions: ['Administrator'] }],
        channels: [{ name: 'regras', overrides: [{ role: '@everyone', send: 'deny' }] }],
      }),
      state(),
      { guildId: GUILD },
    );

    expect(plan.warnings.some((w) => w.includes('@everyone'))).toBe(true);
    expect(plan.operations.some((o) => o.kind === 'role.create')).toBe(false);
    expect(plan.operations.some((o) => o.kind === 'overrides.set')).toBe(true);
  });

  it('considera o override já aplicado quando ele bate com o canal', () => {
    const regras = channel({ id: '11', name: 'regras' });
    const plan = buildPlan(
      spec({ channels: [{ name: 'regras', overrides: [{ role: '@everyone', send: 'deny' }] }] }),
      state({
        channels: [regras],
        details: new Map([
          ['11', detail(regras, { overrides: [{ roleId: GUILD, view: 'inherit', send: 'deny' }] })],
        ]),
      }),
      { guildId: GUILD },
    );

    expect(plan.operations).toEqual([]);
  });

  it('ignora override que existe no canal e o spec não cita', () => {
    // O cargo do próprio bot costuma ter override em canal fechado. Se isso
    // entrasse na comparação, o plano nunca esvaziaria: a API não remove quem
    // ficou de fora, então a operação voltaria a cada execução.
    const bot = role({ id: '9', name: 'Goodbot', managed: true });
    const logs = channel({ id: '11', name: 'logs' });
    const current = state({
      roles: [everyone, bot],
      channels: [logs],
      details: new Map([
        [
          '11',
          detail(logs, {
            overrides: [
              { roleId: GUILD, view: 'deny', send: 'inherit' },
              { roleId: '9', view: 'allow', send: 'allow' },
            ],
          }),
        ],
      ]),
    });

    const plan = buildPlan(
      spec({ channels: [{ name: 'logs', overrides: [{ role: '@everyone', view: 'deny' }] }] }),
      current,
      { guildId: GUILD },
    );

    expect(plan.operations).toEqual([]);
  });

  it('declarar tudo como inherit é como o spec remove um override', () => {
    const logs = channel({ id: '11', name: 'logs' });
    const plan = buildPlan(
      spec({
        channels: [
          { name: 'logs', overrides: [{ role: '@everyone', view: 'inherit', send: 'inherit' }] },
        ],
      }),
      state({
        channels: [logs],
        details: new Map([
          ['11', detail(logs, { overrides: [{ roleId: GUILD, view: 'deny', send: 'inherit' }] })],
        ]),
      }),
      { guildId: GUILD },
    );

    expect(plan.operations.map((o) => o.kind)).toEqual(['overrides.set']);
  });

  it('distingue canais de mesmo nome em categorias diferentes', () => {
    const catA = channel({ id: '10', name: 'A', type: MANAGED_CHANNEL_TYPES.category });
    const geralA = channel({ id: '11', name: 'geral', parentId: '10' });

    const plan = buildPlan(
      spec({
        categories: [
          { name: 'A', channels: [{ name: 'geral' }] },
          { name: 'B', channels: [{ name: 'geral' }] },
        ],
      }),
      state({
        channels: [catA, geralA],
        details: new Map([
          ['10', detail(catA)],
          ['11', detail(geralA)],
        ]),
      }),
      { guildId: GUILD },
    );

    // O "geral" de A já existe; o de B tem de nascer junto com a categoria B.
    expect(plan.operations.map((o) => o.kind)).toEqual(['category.create', 'channel.create']);
  });

  it('sobe um cargo fora de ordem só com --reorder', () => {
    const roles = [
      everyone,
      role({ id: '2', name: 'Mod', position: 2 }),
      role({ id: '3', name: 'Admin', position: 1 }),
    ];
    const desejado = spec({ roles: [{ name: 'Admin' }, { name: 'Mod' }] });

    expect(buildPlan(desejado, state({ roles }), { guildId: GUILD }).operations).toEqual([]);

    const plan = buildPlan(desejado, state({ roles }), { guildId: GUILD, reorder: true });
    expect(plan.operations).toEqual([{ kind: 'role.move', name: 'admin', direction: 'up' }]);
  });
});
