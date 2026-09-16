import { describe, expect, it } from 'vitest';

import {
  adminActionDm,
  guideMessage,
  manualProposalNote,
  memberLeftMessage,
  partyText,
} from './embeds';

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
      groupSize: 2,
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
        groupSize: 2,
        embedColor: 0,
        byStaff: true,
      }),
    ];
    for (const text of texts) expect(JSON.stringify(text)).not.toMatch(/[—–]/);
  });
});

describe('party', () => {
  it('partyText: nada com menos de dois, vaga, fechada e quantas parties dá', () => {
    expect(partyText(0, 4)).toBeNull();
    expect(partyText(1, 4)).toBeNull();
    expect(partyText(3, 4)).toBe('3 de 4, ainda cabe gente.');
    expect(partyText(4, 4)).toBe('Fechada, 4 de 4.');
    expect(partyText(5, 4)).toBe('Dá 2 parties: 5 vão e cada partida leva até 4. Dividam-se.');
    expect(partyText(9, 4)).toBe('Dá 3 parties: 9 vão e cada partida leva até 4. Dividam-se.');
  });

  it('o guia conta membros pelo grupo e só fala da party quando ela é menor', () => {
    const view = (groupSize: number, partySize: number) =>
      embedOf(
        guideMessage({
          squad: {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Os Bravos',
            status: 'open',
            voiceChannelId: null,
          },
          game: {
            id: '00000000-0000-4000-8000-000000000002',
            name: 'Helldivers 2',
            groupSize,
            partySize,
          },
          memberIds: ['300000000000000001', '300000000000000002'],
          upcoming: [],
          canJoinAnother: false,
          embedColor: 0,
          mentionMembers: false,
        }),
      );

    const big = view(12, 4);
    expect(big?.fields?.[0]?.name).toBe('Membros (2 de 12)');
    expect(big?.fields?.[1]?.value).toMatch(/^10 abertas\./);
    expect(big?.description).toContain('Cada partida leva até 4');
    expect(JSON.stringify(big)).not.toMatch(/[—–]/);

    expect(view(4, 4)?.description).not.toContain('Cada partida');
  });
});
