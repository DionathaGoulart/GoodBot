import { describe, expect, it } from 'vitest';

import {
  agendaId,
  isSquadDmId,
  OPT_OUT_TOGGLE_ID,
  parseSquadId,
  requestId,
  SCHEDULE_ID,
  SEARCH_TOGGLE_ID,
  squadDmId,
  visibilityId,
} from './ids';

const GUILD = '123456789012345678';
const USER = '876543210987654321';
const SESSION = '0b8c2f4e-1111-2222-3333-444455556666';

describe('custom_id do squad', () => {
  it('os toggles vão e voltam', () => {
    expect(parseSquadId(SEARCH_TOGGLE_ID)).toEqual({ kind: 'search' });
    expect(parseSquadId(OPT_OUT_TOGGLE_ID)).toEqual({ kind: 'optout' });
    expect(parseSquadId(SCHEDULE_ID)).toEqual({ kind: 'schedule' });
  });

  it('o botão da DM leva a guild', () => {
    for (const choice of ['search', 'later', 'optout'] as const) {
      expect(parseSquadId(squadDmId(choice, GUILD))).toEqual({
        kind: 'dm',
        choice,
        guildId: GUILD,
      });
    }
  });

  it('os botões da agenda levam a jogatina', () => {
    expect(parseSquadId(visibilityId('closed'))).toEqual({
      kind: 'visibility',
      visibility: 'closed',
    });
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

  it('o pedido de vaga e o aviso chegam por DM; o resto não', () => {
    expect(isSquadDmId(requestId('no', GUILD, SESSION, USER))).toBe(true);
    expect(isSquadDmId(squadDmId('later', GUILD))).toBe(true);
    expect(isSquadDmId(agendaId('join', SESSION))).toBe(false);
    expect(isSquadDmId(SEARCH_TOGGLE_ID)).toBe(false);
  });

  it('cabe no teto de 100 caracteres do Discord', () => {
    const snowflake = '12345678901234567890';
    expect(squadDmId('optout', snowflake).length).toBeLessThanOrEqual(100);
    expect(requestId('ok', snowflake, SESSION, snowflake).length).toBeLessThanOrEqual(100);
  });

  it('recusa jogatina que não é uuid e resposta desconhecida', () => {
    expect(() => agendaId('join', 'abc')).toThrow(RangeError);
    expect(parseSquadId('squad:a:join:abc')).toBeNull();
    expect(parseSquadId(`squad:a:dance:${SESSION}`)).toBeNull();
    expect(parseSquadId(`squad:req:talvez:${GUILD}:${SESSION}:${USER}`)).toBeNull();
    expect(parseSquadId('squad:vis:secreta')).toBeNull();
  });

  it('recusa guild que não é snowflake', () => {
    expect(() => squadDmId('search', 'abc')).toThrow(RangeError);
    expect(parseSquadId('squad:dm:search:abc')).toBeNull();
  });

  it('botão do squad fixo e escolha desconhecida viram null', () => {
    expect(parseSquadId('squad:proposal:accept:0b8c2f4e-1111-2222-3333-444455556666')).toBeNull();
    expect(parseSquadId('squad:status:searching:abc')).toBeNull();
    expect(parseSquadId(`squad:dm:talvez:${GUILD}`)).toBeNull();
    expect(parseSquadId('squad:search:extra')).toBeNull();
    expect(parseSquadId('squad:schedule:extra')).toBeNull();
  });

  it('outro prefixo não é do módulo', () => {
    expect(parseSquadId('ticket:close')).toBeNull();
  });
});
