import { DEFAULT_WELCOME_CONFIG, WelcomeConfigSchema } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import { boostTransition } from './welcome';

const NOW = new Date('2026-09-09T12:00:00Z');

describe('boostTransition', () => {
  it('null → data é o começo do impulso', () => {
    expect(boostTransition({ premiumSince: null, partial: false }, { premiumSince: NOW })).toBe(
      'start',
    );
  });

  it('data → null é o fim do impulso', () => {
    expect(boostTransition({ premiumSince: NOW, partial: false }, { premiumSince: null })).toBe(
      'end',
    );
  });

  // Apelido, cargo e avatar chegam no mesmo `guildMemberUpdate`.
  it('ignora atualização que não mexeu no impulso', () => {
    expect(
      boostTransition({ premiumSince: NOW, partial: false }, { premiumSince: NOW }),
    ).toBeNull();
    expect(
      boostTransition({ premiumSince: null, partial: false }, { premiumSince: null }),
    ).toBeNull();
  });

  // Membro parcial tem `premiumSince` nulo por falta de dado, não por não
  // impulsionar: agradecer aí seria agradecer alguém que já era booster.
  it('não decide nada a partir de um membro parcial', () => {
    expect(
      boostTransition({ premiumSince: null, partial: true }, { premiumSince: NOW }),
    ).toBeNull();
    expect(
      boostTransition({ premiumSince: NOW, partial: true }, { premiumSince: null }),
    ).toBeNull();
  });
});

describe('config de impulso', () => {
  it('nasce desligada e sem canal nem cargo', () => {
    expect(DEFAULT_WELCOME_CONFIG.boost).toEqual({
      enabled: false,
      channelId: null,
      template: null,
      roleId: null,
    });
  });

  it('aceita canal e cargo', () => {
    const parsed = WelcomeConfigSchema.parse({
      boost: {
        enabled: true,
        channelId: '111111111111111111',
        roleId: '222222222222222222',
      },
    });
    expect(parsed.boost.enabled).toBe(true);
    expect(parsed.boost.channelId).toBe('111111111111111111');
    expect(parsed.boost.roleId).toBe('222222222222222222');
  });

  it('recusa um id que não é snowflake', () => {
    expect(WelcomeConfigSchema.safeParse({ boost: { roleId: 'cargo-do-boost' } }).success).toBe(
      false,
    );
  });

  // A config antiga não tem a chave; o default tem que preencher sozinho.
  it('config gravada antes do impulso continua válida', () => {
    const parsed = WelcomeConfigSchema.parse({
      enabled: true,
      join: { enabled: true, channelId: '111111111111111111' },
    });
    expect(parsed.boost.enabled).toBe(false);
  });
});
