import { describe, expect, it } from 'vitest';

import {
  agendaId,
  CALL_ID,
  isSquadDmId,
  manageId,
  MINE_ID,
  NOTIFY_TOGGLE_ID,
  parseSquadId,
  requestId,
  SCHEDULE_ID,
} from './ids';

const GUILD = '123456789012345678';
const USER = '876543210987654321';
const SESSION = '0b8c2f4e-1111-2222-3333-444455556666';

describe('custom_id do squad', () => {
  it('os quatro botões do canal de jogatinas vão e voltam', () => {
    expect(parseSquadId(CALL_ID)).toEqual({ kind: 'call' });
    expect(parseSquadId(SCHEDULE_ID)).toEqual({ kind: 'schedule' });
    expect(parseSquadId(MINE_ID)).toEqual({ kind: 'mine' });
    expect(parseSquadId(NOTIFY_TOGGLE_ID)).toEqual({ kind: 'notify' });
    expect(parseSquadId(`${CALL_ID}:extra`)).toBeNull();
  });

  it('os botões da agenda levam a jogatina', () => {
    expect(parseSquadId(agendaId('join', SESSION))).toEqual({
      kind: 'agenda',
      action: 'join',
      sessionId: SESSION,
    });
    expect(parseSquadId(requestId('ok', GUILD, SESSION, USER))).toEqual({
      kind: 'request',
      answer: 'ok',
      guildId: GUILD,
      sessionId: SESSION,
      userId: USER,
    });
  });

  it('o GERENCIAR leva a operação e a jogatina', () => {
    for (const op of ['home', 'when', 'slots', 'vis', 'kick', 'cancel', 'cancelok'] as const) {
      expect(parseSquadId(manageId(op, SESSION))).toEqual({
        kind: 'manage',
        op,
        sessionId: SESSION,
      });
    }
    expect(parseSquadId(`squad:m:drop:${SESSION}`)).toBeNull();
    expect(() => manageId('kick', 'abc')).toThrow(RangeError);
  });

  it('todo botão do módulo que chega por DM passa pelo desvio; o resto não', () => {
    expect(isSquadDmId(requestId('no', GUILD, SESSION, USER))).toBe(true);
    // O aviso por presença saiu, mas ainda está em DMs antigas: ouve que acabou.
    expect(isSquadDmId(`squad:dm:later:${GUILD}`)).toBe(true);
    expect(isSquadDmId('ticket:close')).toBe(false);
    expect(isSquadDmId('squadx:close')).toBe(false);
  });

  it('cabe no teto de 100 caracteres do Discord', () => {
    const snowflake = '12345678901234567890';
    expect(requestId('ok', snowflake, SESSION, snowflake).length).toBeLessThanOrEqual(100);
  });

  it('recusa jogatina que não é uuid e resposta desconhecida', () => {
    expect(() => agendaId('join', 'abc')).toThrow(RangeError);
    expect(parseSquadId('squad:a:join:abc')).toBeNull();
    expect(parseSquadId(`squad:a:dance:${SESSION}`)).toBeNull();
    expect(parseSquadId(`squad:req:talvez:${GUILD}:${SESSION}:${USER}`)).toBeNull();
  });

  it('recusa guild que não é snowflake', () => {
    expect(() => requestId('ok', 'abc', SESSION, USER)).toThrow(RangeError);
    expect(parseSquadId(`squad:req:ok:abc:${SESSION}:${USER}`)).toBeNull();
  });

  it('botões que saíram viram null', () => {
    expect(parseSquadId('squad:proposal:accept:0b8c2f4e-1111-2222-3333-444455556666')).toBeNull();
    expect(parseSquadId('squad:status:searching:abc')).toBeNull();
    // v1.8: os toggles de cargo e o aviso por presença.
    expect(parseSquadId('squad:search')).toBeNull();
    expect(parseSquadId('squad:optout')).toBeNull();
    expect(parseSquadId(`squad:dm:search:${GUILD}`)).toBeNull();
    // v1.9: a escolha ABERTA ou FECHADA depois do modal.
    expect(parseSquadId('squad:vis:open')).toBeNull();
    expect(parseSquadId('squad:schedule:extra')).toBeNull();
  });

  it('outro prefixo não é do módulo', () => {
    expect(parseSquadId('ticket:close')).toBeNull();
  });
});
