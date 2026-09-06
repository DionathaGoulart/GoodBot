import { SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { defineCommand } from './command';
import { buildManifest, hashManifest } from './registry';

import type { Command } from './command';

function command(name: string, description = 'descrição'): Command {
  return defineCommand({
    data: new SlashCommandBuilder().setName(name).setDescription(description),
    module: 'utilities',
    level: 'member',
    execute: () => {},
  });
}

describe('buildManifest', () => {
  it('ordena por nome, independente da ordem de carga', () => {
    const a = buildManifest([command('zulu'), command('alfa')]);
    const b = buildManifest([command('alfa'), command('zulu')]);
    expect(a.map((c) => c.name)).toEqual(['alfa', 'zulu']);
    expect(a).toEqual(b);
  });
});

describe('hashManifest', () => {
  it('é estável entre ordens diferentes dos mesmos comandos', () => {
    const a = hashManifest(buildManifest([command('ping'), command('help')]));
    const b = hashManifest(buildManifest([command('help'), command('ping')]));
    expect(a).toBe(b);
  });

  it('muda quando a descrição de um comando muda', () => {
    const a = hashManifest(buildManifest([command('ping', 'antes')]));
    const b = hashManifest(buildManifest([command('ping', 'depois')]));
    expect(a).not.toBe(b);
  });

  it('muda quando um comando é adicionado', () => {
    const a = hashManifest(buildManifest([command('ping')]));
    const b = hashManifest(buildManifest([command('ping'), command('help')]));
    expect(a).not.toBe(b);
  });

  it('produz um SHA-256 em hex', () => {
    expect(hashManifest(buildManifest([command('ping')]))).toMatch(/^[0-9a-f]{64}$/);
  });
});
