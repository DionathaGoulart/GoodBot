import { describe, expect, it } from 'vitest';

import { adminActionDm, manualProposalNote, memberLeftMessage } from './embeds';

import type { AdminDmKind, AdminDmView } from './embeds';
import type { BaseMessageOptions, EmbedBuilder } from 'discord.js';

const REASON = 'Motivo escrito pelo admin.';

const base: Omit<AdminDmView, 'kind'> = {
  guildName: 'Servidor Teste',
  game: { name: 'Helldivers 2' },
  squad: { name: 'Os Bravos' },
  reason: REASON,
  embedColor: 0xdc143c,
};

const embedOf = (message: BaseMessageOptions) =>
  (message.embeds as EmbedBuilder[] | undefined)?.[0]?.toJSON();

/** O comando que cada aviso indica como próximo passo. */
const NEXT_STEP: Record<AdminDmKind, string> = {
  paused: '/squad status procurando',
  resumed: '/squad status pausado',
  answers: '/squad perfil',
  deleted: '/squad perfil',
  removed: '/squad procurar',
};
const KINDS = Object.keys(NEXT_STEP) as AdminDmKind[];

describe('adminActionDm', () => {
  it.each(KINDS)('%s: título, servidor, jogo, motivo e próximo passo', (kind) => {
    const message = adminActionDm({ ...base, kind });
    const embed = embedOf(message);

    expect(embed?.title).toBeTruthy();
    expect(embed?.description).toContain('**Servidor Teste**');
    expect(embed?.description).toContain('**Helldivers 2**');
    expect(embed?.description).toContain(NEXT_STEP[kind]);
    expect(embed?.fields).toEqual([expect.objectContaining({ value: REASON })]);
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  it('cada aviso tem o seu título', () => {
    const titles = KINDS.map((kind) => embedOf(adminActionDm({ ...base, kind }))?.title);
    expect(new Set(titles).size).toBe(KINDS.length);
  });

  it('saída do squad cita o squad e troca o próximo passo pelo status do perfil', () => {
    const paused = embedOf(adminActionDm({ ...base, kind: 'removed', profileStatus: 'paused' }));
    expect(paused?.description).toContain('**Os Bravos**');
    expect(paused?.description).toContain('/squad status procurando');
    expect(paused?.description).not.toContain('/squad procurar');

    const searching = embedOf(
      adminActionDm({ ...base, kind: 'removed', profileStatus: 'searching' }),
    );
    expect(searching?.description).toContain('/squad procurar');
  });

  it('não nomeia quem clicou', () => {
    for (const kind of KINDS) {
      expect(embedOf(adminActionDm({ ...base, kind }))?.description).toContain('A staff de');
    }
  });
});

describe('copy do match manual e da saída pela staff', () => {
  it('a nota da proposta cita o admin sem chamar ninguém', () => {
    const note = manualProposalNote('300000000000000010');
    expect(note.content).toContain('<@300000000000000010>');
    expect(note.allowedMentions).toEqual({ users: [] });
  });

  it('saída pela staff diz que foi a staff, sem motivo', () => {
    const message = memberLeftMessage({
      userId: '300000000000000002',
      memberCount: 1,
      squadSize: 2,
      embedColor: 0,
      byStaff: true,
    });
    expect(embedOf(message)?.description).toContain('A staff tirou <@300000000000000002>');
    expect(message.allowedMentions).toEqual({ users: [] });
  });

  it('nenhum texto novo usa travessão', () => {
    const texts = [
      ...KINDS.map((kind) => adminActionDm({ ...base, kind, profileStatus: 'paused' })),
      adminActionDm({ ...base, kind: 'removed', profileStatus: null }),
      manualProposalNote('300000000000000010'),
      memberLeftMessage({
        userId: '300000000000000002',
        memberCount: 1,
        squadSize: 2,
        embedColor: 0,
        byStaff: true,
      }),
    ];
    for (const text of texts) expect(JSON.stringify(text)).not.toMatch(/[—–]/);
  });
});
