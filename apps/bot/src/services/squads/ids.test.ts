import { describe, expect, it } from 'vitest';

import { OPT_OUT_TOGGLE_ID, parseSquadId, SEARCH_TOGGLE_ID, squadDmId } from './ids';

const GUILD = '123456789012345678';

describe('custom_id do squad', () => {
  it('os toggles vão e voltam', () => {
    expect(parseSquadId(SEARCH_TOGGLE_ID)).toEqual({ kind: 'search' });
    expect(parseSquadId(OPT_OUT_TOGGLE_ID)).toEqual({ kind: 'optout' });
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

  it('cabe no teto de 100 caracteres do Discord', () => {
    expect(squadDmId('optout', '12345678901234567890').length).toBeLessThanOrEqual(100);
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
  });

  it('outro prefixo não é do módulo', () => {
    expect(parseSquadId('ticket:close')).toBeNull();
  });
});
