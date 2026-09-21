import { MANAGED_CHANNEL_TYPES, permissionsToBitfield } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import { buildSpecFromState } from './import';
import { ScanError, renderAnalysis, resolveGuild, slugify } from './scan';

import type { CurrentState } from './plan';
import type {
  AdminGuildLive,
  GuildChannelDetail,
  GuildChannelSummary,
  GuildRoleSummary,
  InternalClient,
} from '@goodbot/shared';

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

const guildLive = (o: Partial<AdminGuildLive> & { id: string; name: string }): AdminGuildLive => ({
  iconUrl: null,
  memberCount: 10,
  ownerId: '999',
  ownerTag: 'dono#0001',
  joinedAt: null,
  canAnnounce: true,
  ...o,
});

/** Um cliente que só sabe listar guilds; é tudo que o `resolveGuild` usa. */
const clientComGuilds = (guilds: AdminGuildLive[]): InternalClient =>
  ({ admin: { guilds: () => Promise.resolve({ guilds, cached: guilds.length }) } }) as
    unknown as InternalClient;

describe('slugify', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(slugify('Fábrica de Memes!')).toBe('fabrica-de-memes');
    expect(slugify('  Goodivers  ')).toBe('goodivers');
  });

  it('não devolve string vazia nem hífen solto', () => {
    expect(slugify('🔥🔥🔥')).toBe('servidor');
    expect(slugify('--- ---')).toBe('servidor');
  });
});

describe('resolveGuild', () => {
  const guilds = [
    guildLive({ id: '1', name: 'Goodivers' }),
    guildLive({ id: '2', name: 'Goodivers Staff' }),
    guildLive({ id: '3', name: 'Darkning Art' }),
  ];

  it('casa pelo ID', async () => {
    await expect(resolveGuild(clientComGuilds(guilds), '3')).resolves.toMatchObject({
      name: 'Darkning Art',
    });
  });

  it('nome exato ganha do prefixo que também casaria', async () => {
    await expect(resolveGuild(clientComGuilds(guilds), 'goodivers')).resolves.toMatchObject({
      id: '1',
    });
  });

  it('casa por pedaço do nome, sem acento', async () => {
    await expect(resolveGuild(clientComGuilds(guilds), 'darkning')).resolves.toMatchObject({
      id: '3',
    });
  });

  it('recusa termo ambíguo em vez de escolher', async () => {
    await expect(resolveGuild(clientComGuilds(guilds), 'good')).rejects.toBeInstanceOf(ScanError);
  });

  it('recusa termo que não casa com nada', async () => {
    await expect(resolveGuild(clientComGuilds(guilds), 'zzz')).rejects.toBeInstanceOf(ScanError);
  });
});

/** Um servidor com um problema plantado em cada observação que esperamos. */
function servidorTorto(): CurrentState {
  const everyone = role({
    id: GUILD,
    name: '@everyone',
    position: 0,
    permissions: permissionsToBitfield(['Administrator']),
  });
  const admin = role({
    id: '2',
    name: 'Admin',
    position: 3,
    color: 0xe74c3c,
    hoist: true,
    permissions: permissionsToBitfield(['Administrator']),
  });
  const etiqueta = role({ id: '3', name: 'Veterano', position: 2 });
  const botRole = role({ id: '9', name: 'Goodbot', position: 4, managed: true });

  const geralCat = channel({
    id: '10',
    name: 'GERAL',
    type: MANAGED_CHANNEL_TYPES.category,
    position: 0,
  });
  const chat = channel({ id: '11', name: 'chat', parentId: '10', position: 0 });
  const vazia = channel({
    id: '20',
    name: 'ARQUIVO',
    type: MANAGED_CHANNEL_TYPES.category,
    position: 1,
  });
  const solto = channel({ id: '30', name: 'regras', position: 0 });
  const forum = channel({ id: '40', name: 'duvidas', type: 15, position: 1 });

  return {
    roles: [everyone, admin, etiqueta, botRole],
    channels: [geralCat, chat, vazia, solto, forum],
    details: new Map([
      ['10', detail(geralCat)],
      ['11', detail(chat, { topic: 'Papo livre.', slowmodeSeconds: 5 })],
      ['20', detail(vazia)],
      ['30', detail(solto, { overrides: [{ roleId: GUILD, view: 'allow', send: 'deny' }] })],
      ['40', detail(forum)],
    ]),
  };
}

describe('renderAnalysis', () => {
  const render = (state: CurrentState = servidorTorto()): string =>
    renderAnalysis({
      guild: guildLive({ id: GUILD, name: 'Servidor Torto', memberCount: 1204 }),
      state,
      avisosDoYaml: buildSpecFromState(state, GUILD).warnings,
    });

  it('abre com a identidade do servidor', () => {
    const md = render();
    expect(md).toContain('# Servidor Torto');
    expect(md).toContain('1.204');
    expect(md).toContain('dono#0001');
  });

  it('não escreve snowflake nenhum, nem o do servidor nem o do dono', () => {
    const md = render();
    expect(md).not.toContain(GUILD);
    expect(md).not.toContain('`999`');
    expect(md).not.toMatch(/\d{17,20}/);
  });

  it('lista os cargos do topo para a base e separa os de bot', () => {
    const md = render();
    const admin = md.indexOf('| 1 | Admin');
    const veterano = md.indexOf('| 2 | Veterano');
    expect(admin).toBeGreaterThan(-1);
    expect(veterano).toBeGreaterThan(admin);
    expect(md).toContain('**Cargos de bot**');
    expect(md).toMatch(/Cargos de bot[\s\S]*Goodbot/u);
  });

  it('põe cada canal sob a sua categoria, com tópico e override', () => {
    const md = render();
    expect(md).toMatch(/### GERAL[\s\S]*\*\*#chat\*\*/u);
    expect(md).toContain('_Papo livre._');
    expect(md).toContain('slowmode 5s');
    expect(md).toContain('`@everyone` — vê, não escreve');
  });

  it('nomeia o cargo do override em vez de mostrar o ID', () => {
    const md = render();
    expect(md).not.toContain('roleId');
    expect(md).not.toContain('cargo 111111111111111111');
  });

  it('aponta @everyone com permissão perigosa', () => {
    expect(render()).toMatch(/@everyone` tem permissão perigosa[\s\S]*Administrator/u);
  });

  it('aponta categoria vazia, canal solto e cargo sem permissão', () => {
    const md = render();
    expect(md).toContain('Categoria vazia: ARQUIVO');
    expect(md).toContain('#regras');
    expect(md).toContain('Veterano');
  });

  it('avisa sobre canal fora do alcance do yaml', () => {
    const md = render();
    expect(md).toMatch(/Fora do alcance[\s\S]*duvidas \(fórum\)/u);
  });

  it('avisa sobre cargos de mesmo nome, que o yaml não distingue', () => {
    const state = servidorTorto();
    state.roles.push(role({ id: '4', name: 'admin', position: 1 }));
    expect(render(state)).toMatch(/2 cargos chamados "admin"/u);
  });

  it('não inventa problema num servidor arrumado', () => {
    const everyone = role({ id: GUILD, name: '@everyone', position: 0 });
    const cat = channel({
      id: '10',
      name: 'GERAL',
      type: MANAGED_CHANNEL_TYPES.category,
      position: 0,
    });
    const chat = channel({ id: '11', name: 'chat', parentId: '10', position: 0 });
    const md = render({
      roles: [everyone, role({ id: '2', name: 'Membro', permissions: permissionsToBitfield(['ViewChannel']) })],
      channels: [cat, chat],
      details: new Map([
        ['10', detail(cat)],
        ['11', detail(chat)],
      ]),
    });
    expect(md).not.toContain('permissão perigosa');
    expect(md).not.toContain('Categoria vazia');
    expect(md).not.toContain('Fora do alcance');
  });
});
