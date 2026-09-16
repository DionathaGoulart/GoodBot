import { describe, expect, it } from 'vitest';

import {
  adminActionDm,
  guideMessage,
  inviteMessage,
  joinableSquadsMessage,
  joinVoteMessage,
  manualProposalNote,
  memberLeftMessage,
  partyText,
  publicCallMessage,
  sessionMessage,
} from './embeds';
import { parseSquadCustomId } from './ids';

import type { AdminDmKind, AdminDmView, GuideView, JoinVoteView, SessionView } from './embeds';
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
          history: { text: 'Ainda não jogaram.', regularIds: [] },
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

const SQUAD_ID = '00000000-0000-4000-8000-000000000001';
const GAME_ID = '00000000-0000-4000-8000-000000000002';
const HISTORY = '6 jogatinas no último mês, geralmente sexta e sábado à noite. Última há 3 dias.';

/** Os `custom_id` de cada linha de botões, já lidos pelo parser. */
function rowsOf(message: BaseMessageOptions) {
  const rows = message.components as unknown as {
    toJSON: () => { components: { custom_id: string }[] };
  }[];
  return rows.map(
    (row) => row.toJSON().components.map((button) => parseSquadCustomId(button.custom_id)?.kind),
  );
}

describe('histórico e chamada pública', () => {
  const guide = (overrides: Partial<GuideView> = {}) =>
    guideMessage({
      squad: { id: SQUAD_ID, name: 'Os Bravos', status: 'open', voiceChannelId: null },
      game: { id: GAME_ID, name: 'Helldivers 2', groupSize: 8, partySize: 4 },
      memberIds: ['300000000000000001', '300000000000000002'],
      upcoming: [],
      canJoinAnother: true,
      history: { text: HISTORY, regularIds: ['300000000000000002', '300000000000000001'] },
      embedColor: 0,
      mentionMembers: false,
      ...overrides,
    });

  it('o guia mostra o histórico e quem mais aparece, e ensina o CHAMAR GENTE', () => {
    const embed = embedOf(guide());
    const history = embed?.fields?.find((field) => field.name === 'Histórico');
    expect(history?.value).toBe(
      `${HISTORY}\nQuem mais aparece: <@300000000000000002>, <@300000000000000001>.`,
    );
    expect(embed?.fields?.find((field) => field.name === 'Como usar')?.value).toContain(
      '**CHAMAR GENTE**',
    );
    const quiet = embedOf(guide({ history: { text: 'Ainda não jogaram.', regularIds: [] } }));
    expect(quiet?.fields?.find((field) => field.name === 'Histórico')?.value).toBe(
      'Ainda não jogaram.',
    );
    expect(JSON.stringify(embed)).not.toMatch(/[—–]/);
  });

  it('o guia divide os botões em jogar e cuidar do squad', () => {
    expect(rowsOf(guide())).toEqual([
      ['bora-open', 'call-next', 'invite-pick'],
      ['rename-open', 'search', 'leave'],
    ]);
    expect(rowsOf(guide({ canJoinAnother: false }))[1]).toEqual(['rename-open', 'leave']);
  });

  it('o convite mostra o histórico enquanto está aberto', () => {
    const view = {
      request: {
        id: '00000000-0000-4000-8000-000000000003',
        userId: '300000000000000009',
        invitedBy: null,
        expiresAt: new Date('2026-09-17T12:00:00Z'),
      },
      squad: { name: 'Os Bravos', textChannelId: null },
      game: { name: 'Helldivers 2', groupSize: 8 },
      memberIds: ['300000000000000001'],
      history: HISTORY,
      embedColor: 0,
      mentionCandidate: false,
    } as const;
    const open = embedOf(inviteMessage({ ...view, state: 'invited' }));
    expect(open?.fields?.find((field) => field.name === 'Histórico')?.value).toBe(HISTORY);
    const done = embedOf(inviteMessage({ ...view, state: 'joined' }));
    expect(done?.fields ?? []).toEqual([]);
  });

  it('a lista do /squad procurar leva o histórico de cada squad', () => {
    const embed = embedOf(
      joinableSquadsMessage({
        game: { name: 'Helldivers 2', groupSize: 8 },
        entries: [{ squad: { id: SQUAD_ID, name: 'Os Bravos' }, memberCount: 3, history: HISTORY }],
        embedColor: 0,
      }),
    );
    expect(embed?.fields?.[0]?.value).toBe(`3 de 8 jogadores. ${HISTORY}`);
  });

  it('a chamada pública: quando, party, squad, histórico e ENTRAR, sem chamar ninguém', () => {
    const startsAt = new Date('2026-09-18T00:00:00Z');
    const message = publicCallMessage({
      session: { id: 42, startsAt },
      squad: { name: 'Os Bravos' },
      game: { name: 'Helldivers 2', groupSize: 8, partySize: 4 },
      memberCount: 3,
      history: HISTORY,
      embedColor: 0,
    });
    const embed = embedOf(message);
    expect(embed?.title).toBe('> BORA JOGAR HELLDIVERS 2?');
    expect(embed?.description).toContain('**Os Bravos**');
    expect(embed?.description).toContain(`<t:${String(startsAt.getTime() / 1000)}:F>`);
    expect(embed?.description).toContain('cada partida leva até 4');
    expect(embed?.fields).toEqual([
      { name: 'Squad', value: '3 de 8 jogadores' },
      { name: 'Histórico', value: HISTORY },
    ]);
    expect(rowsOf(message)).toEqual([['enter']]);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(embed)).not.toMatch(/[—–]/);
  });

  it('a jogatina só oferece CHAMAR GENTE quando dá, e mostra a chamada aberta', () => {
    const view: SessionView = {
      session: {
        id: 7,
        startsAt: new Date('2026-09-18T00:00:00Z'),
        endsAt: new Date('2026-09-18T03:00:00Z'),
        goingIds: ['300000000000000001'],
        notGoingIds: [],
        createdBy: '300000000000000001',
        cancelledBy: null,
        remindedAt: null,
      },
      squad: { name: 'Os Bravos' },
      memberIds: ['300000000000000001', '300000000000000002'],
      partySize: 4,
      voiceChannelId: null,
      canCall: true,
      callChannelId: null,
      state: 'scheduled',
      reminderMinutesBefore: 30,
      embedColor: 0,
      mentionMembers: false,
    };
    expect(rowsOf(sessionMessage(view))).toEqual([['session', 'session', 'call', 'session']]);
    const called = sessionMessage({ ...view, canCall: false, callChannelId: '400000000000000001' });
    expect(rowsOf(called)).toEqual([['session', 'session', 'session']]);
    expect(embedOf(called)?.fields?.find((field) => field.name === 'Chamada')?.value).toContain(
      '<#400000000000000001>',
    );
    const started = sessionMessage({ ...view, state: 'started', callChannelId: '400000000000000001' });
    expect(embedOf(started)?.fields?.some((field) => field.name === 'Chamada')).toBe(false);
  });

  it('a votação de quem veio pela chamada diz de qual jogatina', () => {
    const startsAt = new Date('2026-09-18T00:00:00Z');
    const view: Omit<JoinVoteView, 'session'> = {
      request: {
        id: '00000000-0000-4000-8000-000000000003',
        userId: '300000000000000009',
        acceptedIds: [],
        declinedIds: [],
        expiresAt: new Date('2026-09-17T12:00:00Z'),
      },
      memberIds: ['300000000000000001', '300000000000000002'],
      game: { fields: [] },
      answers: {},
      slot: null,
      blocks: [],
      state: 'open',
      embedColor: 0,
      mentionMembers: false,
    };
    expect(embedOf(joinVoteMessage({ ...view, session: { startsAt } }))?.description).toContain(
      `respondeu à chamada da jogatina de <t:${String(startsAt.getTime() / 1000)}:f>`,
    );
    expect(embedOf(joinVoteMessage({ ...view, session: null }))?.description).toContain(
      'joga em horários parecidos',
    );
  });
});
