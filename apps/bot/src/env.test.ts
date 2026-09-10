import { describe, expect, it, vi } from 'vitest';

const A = '111111111111111111';
const B = '222222222222222222';

// `env.ts` valida `process.env` no próprio import (falhar no boot é melhor do
// que descobrir um token vazio no meio de um comando). O `vi.hoisted` roda
// antes dos imports e dá a ele o mínimo para carregar.
vi.hoisted(() => {
  process.env.DISCORD_TOKEN = 'token';
  process.env.DISCORD_CLIENT_ID = '333333333333333333';
  process.env.GUILD_ID = '111111111111111111';
  process.env.DATABASE_URL = 'postgres://localhost:5432/goodbot';
  process.env.INTERNAL_API_TOKEN = 'a'.repeat(64);
});

const { parseEnv } = await import('./env');

/** O mínimo que o schema exige, sem nada de guild. */
const base = {
  DISCORD_TOKEN: 'token',
  DISCORD_CLIENT_ID: '333333333333333333',
  DATABASE_URL: 'postgres://localhost:5432/goodbot',
  INTERNAL_API_TOKEN: 'a'.repeat(64),
};

describe('parseEnv — guilds', () => {
  it('aceita GUILD_IDS com uma lista', () => {
    expect(parseEnv({ ...base, GUILD_IDS: `${A},${B}` }).guildIds).toEqual([A, B]);
  });

  it('preserva a ordem, que é a do seletor do painel', () => {
    expect(parseEnv({ ...base, GUILD_IDS: `${B},${A}` }).guildIds).toEqual([B, A]);
  });

  it('continua aceitando o GUILD_ID singular', () => {
    // Compatibilidade que importa na prática: a variável vive em três cofres
    // (VM, GitHub Secrets, Vercel) e renomear nos três de uma vez só para
    // acrescentar um servidor seria um degrau desnecessário.
    expect(parseEnv({ ...base, GUILD_ID: A }).guildIds).toEqual([A]);
  });

  it('GUILD_IDS ganha de GUILD_ID quando os dois existem', () => {
    expect(parseEnv({ ...base, GUILD_ID: A, GUILD_IDS: B }).guildIds).toEqual([B]);
  });

  it('apara espaço e descarta entrada vazia', () => {
    expect(parseEnv({ ...base, GUILD_IDS: ` ${A} , , ${B} ,` }).guildIds).toEqual([A, B]);
  });

  it('remove repetido — buscar os membros da mesma guild duas vezes é desperdício', () => {
    expect(parseEnv({ ...base, GUILD_IDS: `${A},${B},${A}` }).guildIds).toEqual([A, B]);
  });

  it('aceita a ausência das duas — quem manda é o registro', () => {
    // A variável virou semente: o bot sobe sem ela e atende quem já está na
    // tabela `guild_registry`.
    expect(parseEnv(base).guildIds).toEqual([]);
  });

  it('recusa um id que não é snowflake, dizendo qual', () => {
    expect(() => parseEnv({ ...base, GUILD_IDS: `${A},nao-e-id` })).toThrow(/snowflake/u);
  });
});
