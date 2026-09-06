import { CASE_TYPES } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { caseEmbed, caseFooter, caseLine, caseTypeLabel, CASE_TYPE_COLORS } from './case-embed';
import { STATUS_COLORS } from './embeds';

import type { Case } from '@cobot/db';

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 1,
    guildId: '111111111111111111',
    caseNumber: 12,
    type: 'ban',
    targetId: '222222222222222222',
    targetTag: 'alvo',
    actorId: '333333333333333333',
    actorTag: 'moderador',
    reason: 'spam',
    durationMs: null,
    expiresAt: null,
    source: 'command',
    automodRuleId: null,
    modlogMessageId: null,
    modlogChannelId: null,
    editedBy: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-09-06T12:00:00Z'),
    ...overrides,
  };
}

describe('CASE_TYPE_COLORS', () => {
  it('usa as cores de status do styleguide §9', () => {
    expect(CASE_TYPE_COLORS.ban).toBe(STATUS_COLORS.danger);
    expect(CASE_TYPE_COLORS.kick).toBe(STATUS_COLORS.warning);
    expect(CASE_TYPE_COLORS.timeout).toBe(STATUS_COLORS.warning);
    expect(CASE_TYPE_COLORS.warn).toBe(STATUS_COLORS.info);
    expect(CASE_TYPE_COLORS.unban).toBe(STATUS_COLORS.success);
  });

  it('cobre todos os tipos de caso', () => {
    for (const type of CASE_TYPES) {
      expect(typeof CASE_TYPE_COLORS[type]).toBe('number');
    }
  });
});

describe('caseTypeLabel', () => {
  it('distingue ban permanente de temporário', () => {
    expect(caseTypeLabel(makeCase())).toBe('BAN');
    expect(caseTypeLabel(makeCase({ durationMs: 3_600_000 }))).toBe('BAN TEMPORÁRIO');
  });
});

describe('caseFooter', () => {
  it('segue o formato `CASO #n · MOD: nome`', () => {
    expect(caseFooter(makeCase())).toBe('CASO #12 · MOD: moderador');
  });

  it('marca a origem quando o caso não veio de um comando', () => {
    expect(caseFooter(makeCase({ source: 'automod' }))).toBe(
      'CASO #12 · MOD: moderador · AUTOMOD',
    );
  });
});

describe('caseEmbed', () => {
  it('usa a cor do tipo e o título em caixa alta com `>`', () => {
    const embed = caseEmbed(makeCase({ type: 'warn' })).toJSON();
    expect(embed.color).toBe(STATUS_COLORS.info);
    expect(embed.title).toBe('> AVISO · CASO #12');
  });

  it('mostra duração e expiração só quando o caso tem prazo', () => {
    const semPrazo = caseEmbed(makeCase()).toJSON();
    expect(semPrazo.fields?.map((field) => field.name)).not.toContain('Duração');

    const comPrazo = caseEmbed(
      makeCase({ durationMs: 3_600_000, expiresAt: new Date('2026-09-06T13:00:00Z') }),
    ).toJSON();
    const names = comPrazo.fields?.map((field) => field.name);
    expect(names).toContain('Duração');
    expect(names).toContain('Expira');
  });

  it('avisa quando o caso está apagado', () => {
    const embed = caseEmbed(makeCase({ deletedAt: new Date() })).toJSON();
    expect(embed.description).toContain('apagado');
  });

  it('mostra quem editou o motivo', () => {
    const embed = caseEmbed(
      makeCase({ editedBy: '444444444444444444', editedAt: new Date() }),
    ).toJSON();
    expect(embed.fields?.map((field) => field.name)).toContain('Editado');
  });
});

describe('caseLine', () => {
  it('encurta motivos longos', () => {
    const line = caseLine(makeCase({ reason: 'x'.repeat(200) }));
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(200);
  });
});
