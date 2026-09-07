import { describe, expect, it } from 'vitest';

import {
  AFK_TIMEOUTS,
  BanListQuerySchema,
  GuildSettingsInputSchema,
  MAX_GUILD_IMAGE_BYTES,
  guildGate,
  guildGates,
  guildSettingsBlockers,
  parseImageDataUrl,
} from './guild';

const ACTOR = '200000000000000000';

/** Data URL com um payload base64 que decodifica para ~`bytes` bytes. */
function dataUrl(mime: string, bytes: number): string {
  return `data:${mime};base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
}

const ICON = dataUrl('image/png', 1024);

function settings(overrides: Record<string, unknown> = {}) {
  return {
    actorId: ACTOR,
    name: 'CoBot Lab',
    description: '',
    verificationLevel: 2,
    systemChannelId: '',
    afkChannelId: '',
    afkTimeout: AFK_TIMEOUTS[1],
    ...overrides,
  };
}

describe('imagem do servidor', () => {
  it('aceita os quatro formatos que o Discord aceita', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      const parsed = parseImageDataUrl(dataUrl(mime, 2048));
      expect(parsed.ok).toBe(true);
    }
    expect(parseImageDataUrl(dataUrl('image/gif', 2048))).toMatchObject({
      ok: true,
      image: { animated: true },
    });
  });

  it('recusa tipo fora da lista', () => {
    expect(parseImageDataUrl(dataUrl('image/svg+xml', 512))).toEqual({ ok: false, reason: 'mime' });
    expect(parseImageDataUrl(dataUrl('application/pdf', 512))).toEqual({
      ok: false,
      reason: 'mime',
    });
  });

  it('recusa acima de 8 MB, medindo o binário e não a base64', () => {
    expect(parseImageDataUrl(dataUrl('image/png', MAX_GUILD_IMAGE_BYTES - 3)).ok).toBe(true);
    expect(parseImageDataUrl(dataUrl('image/png', MAX_GUILD_IMAGE_BYTES + 3))).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('recusa o que não é data URL de base64', () => {
    for (const value of ['https://cdn.discord.com/icon.png', 'data:image/png,cru', '', 'png']) {
      expect(parseImageDataUrl(value)).toMatchObject({ ok: false });
    }
  });

  it('o schema do formulário rejeita o mesmo que o parser', () => {
    expect(GuildSettingsInputSchema.safeParse(settings({ icon: ICON })).success).toBe(true);
    // Ausente = não mexer; `null` = remover. Os dois passam.
    expect(GuildSettingsInputSchema.safeParse(settings({ icon: null })).success).toBe(true);
    expect(
      GuildSettingsInputSchema.safeParse(settings({ icon: dataUrl('image/svg+xml', 512) })).success,
    ).toBe(false);
    expect(
      GuildSettingsInputSchema.safeParse(
        settings({ banner: dataUrl('image/png', MAX_GUILD_IMAGE_BYTES + 3) }),
      ).success,
    ).toBe(false);
  });

  it('valida o resto do formulário como o Discord valida', () => {
    expect(GuildSettingsInputSchema.safeParse(settings({ name: 'x' })).success).toBe(false);
    expect(GuildSettingsInputSchema.safeParse(settings({ verificationLevel: 5 })).success).toBe(
      false,
    );
    expect(GuildSettingsInputSchema.safeParse(settings({ afkTimeout: 120 })).success).toBe(false);
    // `''` de um campo apagado no formulário vira `null`, não erro.
    expect(GuildSettingsInputSchema.parse(settings()).systemChannelId).toBeNull();
  });
});

describe('gates de impulso', () => {
  it('recusa banner sem a feature e explica em português', () => {
    const verdict = guildGate([], 'banner');
    expect(verdict.allowed).toBe(false);
    expect(verdict.feature).toBe('BANNER');
    expect(verdict.reason).toContain('Impulso nível 2');
    expect(guildGate(['BANNER'], 'banner')).toEqual({
      allowed: true,
      reason: null,
      feature: 'BANNER',
    });
  });

  it('bloqueia o envio antes de qualquer chamada ao Discord', () => {
    const input = GuildSettingsInputSchema.parse(
      settings({ banner: ICON, description: 'servidor de teste' }),
    );

    expect(guildSettingsBlockers(input, [])).toEqual([
      { field: 'banner', message: expect.stringContaining('Banner do servidor') },
      { field: 'description', message: expect.stringContaining('Comunidade') },
    ]);
    expect(guildSettingsBlockers(input, ['BANNER', 'COMMUNITY'])).toEqual([]);
  });

  it('ícone animado é um gate à parte do ícone comum', () => {
    const gif = GuildSettingsInputSchema.parse(settings({ icon: dataUrl('image/gif', 2048) }));
    expect(guildSettingsBlockers(gif, [])).toEqual([
      { field: 'icon', message: expect.stringContaining('Ícone animado') },
    ]);

    const png = GuildSettingsInputSchema.parse(settings({ icon: ICON }));
    expect(guildSettingsBlockers(png, [])).toEqual([]);
  });

  it('remover uma imagem (`null`) nunca esbarra num gate', () => {
    const input = GuildSettingsInputSchema.parse(settings({ banner: null, icon: null }));
    expect(guildSettingsBlockers(input, [])).toEqual([]);
  });

  it('`guildGates` responde por todos os campos de uma vez', () => {
    const gates = guildGates(['COMMUNITY']);
    expect(gates.description.allowed).toBe(true);
    expect(gates.banner.allowed).toBe(false);
    expect(gates.splash.allowed).toBe(false);
  });
});

describe('lista de banidos', () => {
  it('pagina por cursor com teto de 1000', () => {
    expect(BanListQuerySchema.parse({})).toEqual({ q: '', limit: 100 });
    expect(BanListQuerySchema.parse({ limit: 1000, after: ACTOR }).after).toBe(ACTOR);
    expect(BanListQuerySchema.safeParse({ limit: 1001 }).success).toBe(false);
    expect(BanListQuerySchema.safeParse({ after: '12' }).success).toBe(false);
  });
});
