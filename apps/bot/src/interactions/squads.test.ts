import { describe, expect, it } from 'vitest';

import {
  callModal,
  cancelPrompt,
  managePanel,
  mineText,
  requireSquadChannel,
  rescheduleModal,
  slotsModal,
  visibilityText,
} from './squads';
import { squadsConfig } from '../services/squads/__fixtures__/rooms';

import type { LfgSession, LfgSessionWithRoster } from '@goodbot/db';

const ALICE = '400000000000000001';
const BOB = '400000000000000002';
const CAROL = '400000000000000003';
const SESSION = '00000000-0000-4000-8000-000000000001';
/** 14/09/2026, 21h em São Paulo. */
const STARTS = new Date('2026-09-15T00:00:00Z');

function found(entries: LfgSessionWithRoster['roster']['entries']): LfgSessionWithRoster {
  return {
    session: { id: SESSION, hostId: ALICE, startsAt: STARTS, slots: 2, note: null } as LfgSession,
    roster: { hostId: ALICE, slots: 2, visibility: 'open', entries },
  };
}

type Row = { components: { data: Record<string, unknown>; options?: { data: unknown }[] }[] };

describe('painel do GERENCIAR', () => {
  it('resume a jogatina e lista quem dá para tirar, sem o host', () => {
    const panel = managePanel(
      found([
        { userId: ALICE, status: 'host', joinedAt: 0 },
        { userId: BOB, status: 'going', joinedAt: 1 },
        { userId: CAROL, status: 'invited', joinedAt: 2 },
      ]),
      (id) => (id === BOB ? 'Bob' : id),
      'Agora são 2 vagas.',
    );
    expect(panel.content).toContain('2/2 vagas · aberta · 1 convite');
    expect(panel.content).toContain('Agora são 2 vagas.');
    expect(panel.allowedMentions).toEqual({ parse: [] });
    const [buttons, select] = panel.components as unknown as Row[];
    expect(buttons?.components.map((c) => c.data.label)).toEqual([
      'REMARCAR',
      'VAGAS',
      'FECHAR',
      'CANCELAR',
    ]);
    expect(select?.components[0]?.data.custom_id).toBe(`squad:m:kick:${SESSION}`);
    expect(select?.components[0]?.options?.map((o) => o.data)).toEqual([
      { label: 'Bob', value: BOB, description: 'vai' },
      { label: CAROL, value: CAROL, description: 'convidado' },
    ]);
  });

  it('só o host na lista: sem select', () => {
    const panel = managePanel(found([{ userId: ALICE, status: 'host', joinedAt: 0 }]), String);
    expect(panel.components).toHaveLength(1);
  });

  it('o cancelar pede confirmação e dá para voltar', () => {
    const prompt = cancelPrompt({ id: SESSION, startsAt: STARTS });
    const [row] = prompt.components as unknown as Row[];
    expect(row?.components.map((c) => c.data.custom_id)).toEqual([
      `squad:m:cancelok:${SESSION}`,
      `squad:m:home:${SESSION}`,
    ]);
  });

  it('os modais abrem com o valor de agora', () => {
    const when = JSON.stringify(
      rescheduleModal({ id: SESSION, startsAt: STARTS, note: 'terminids' }, 'America/Sao_Paulo'),
    );
    expect(when).toContain('"value":"14/09 21:00"');
    expect(when).toContain('"value":"terminids"');
    expect(JSON.stringify(slotsModal({ id: SESSION, slots: 4 }))).toContain('"value":"4"');
  });
});

describe('ABRIR e FECHAR', () => {
  it('diz quantos pedidos entraram e quantos ficaram sem vaga', () => {
    expect(visibilityText({ visibility: 'closed', accepted: 0, refused: 0 })).toContain('Fechada');
    const opened = visibilityText({ visibility: 'open', accepted: 2, refused: 1 });
    expect(opened).toContain('Os 2 pedidos pendentes foram aceitos.');
    expect(opened).toContain('Um pedido ficou sem vaga e foi recusado.');
    expect(opened).not.toContain('espera');
  });
});

describe('/jogatinas', () => {
  it('lista cada jogatina com o papel da pessoa e o link', () => {
    const text = mineText([
      {
        sessionId: SESSION,
        kind: 'scheduled',
        startsAt: STARTS,
        status: 'host',
        url: 'https://x/1',
      },
      { sessionId: SESSION, kind: 'scheduled', startsAt: STARTS, status: 'requested', url: null },
    ]);
    expect(text).toContain('você marcou · [ver](https://x/1)');
    expect(text).toContain('seu pedido está com quem marcou');
  });

  it('o card aparece como agora, sem hora', () => {
    const text = mineText([
      { sessionId: SESSION, kind: 'now', startsAt: STARTS, status: 'host', url: 'https://x/2' },
      { sessionId: SESSION, kind: 'now', startsAt: STARTS, status: 'going', url: null },
    ]);
    expect(text).toContain('- agora: você procura · [ver](https://x/2)');
    expect(text).toContain('- agora: você vai');
    expect(text).not.toContain('<t:');
  });

  it('sem nenhuma, ensina os dois comandos', () => {
    expect(mineText([])).toContain('`/procurar`');
    expect(mineText([])).toContain('`/marcar`');
  });
});

describe('PROCURAR AGORA', () => {
  it('o modal pede o quê e vagas, com o tamanho da sala de padrão', () => {
    const modal = JSON.stringify(callModal({ roomSize: 5 }));
    expect(modal).toContain('"custom_id":"squad:call"');
    expect(modal).toContain('"custom_id":"what"');
    expect(modal).toContain('"placeholder":"5"');
  });

  it('sem o canal, recusa antes do modal dizendo o que falta', () => {
    expect(() => {
      requireSquadChannel(squadsConfig({ chatChannelId: null }), 'chatChannelId');
    }).toThrow(expect.objectContaining({ code: 'SQUADS_NO_CHAT_CHANNEL' }));
    expect(() => {
      requireSquadChannel(squadsConfig({ agendaChannelId: null }), 'agendaChannelId');
    }).toThrow(expect.objectContaining({ code: 'SQUADS_NO_AGENDA_CHANNEL' }));
    expect(() => {
      requireSquadChannel(squadsConfig(), 'agendaChannelId');
    }).not.toThrow();
  });
});
