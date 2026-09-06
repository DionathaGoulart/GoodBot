import { TicketsConfigSchema } from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { MAX_CHANNEL_NAME_LENGTH, openLimitFor, renderChannelName } from './tickets';

import type { TicketType } from '@cobot/db';

const type = (overrides: Partial<TicketType> = {}): TicketType =>
  ({
    id: 'type-1',
    guildId: '111111111111111111',
    name: 'suporte',
    categoryId: '222222222222222222',
    supportRoleIds: [],
    openingMessage: null,
    maxOpenPerUser: null,
    namingPattern: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as TicketType;

describe('renderChannelName', () => {
  it('substitui as três variáveis do padrão', () => {
    expect(renderChannelName('{type}-{number}-{user}', { number: 7, user: 'fulano', type: 'suporte' }))
      .toBe('suporte-7-fulano');
  });

  it('usa o padrão default do PRD', () => {
    expect(renderChannelName('ticket-{number}', { number: 12, user: 'x', type: 'y' }))
      .toBe('ticket-12');
  });

  it('tira acento e caixa alta — o Discord não aceita', () => {
    expect(renderChannelName('{user}', { number: 1, user: 'João Ção', type: 't' }))
      .toBe('joao-cao');
  });

  it('colapsa separadores e não deixa traço nas pontas', () => {
    expect(renderChannelName('-- {user} !! ', { number: 1, user: 'a b', type: 't' })).toBe('a-b');
  });

  it('corta no limite de nome de canal do Discord', () => {
    const name = renderChannelName('{user}', { number: 1, user: 'a'.repeat(200), type: 't' });
    expect(name).toHaveLength(MAX_CHANNEL_NAME_LENGTH);
  });

  it('cai no nome padrão quando o padrão não sobra nada', () => {
    expect(renderChannelName('!!!', { number: 9, user: '', type: '' })).toBe('ticket-9');
  });
});

describe('openLimitFor', () => {
  const config = TicketsConfigSchema.parse({ maxOpenPerUserDefault: 3 });

  it('o limite do tipo ganha do default', () => {
    expect(openLimitFor(type({ maxOpenPerUser: 1 }), config)).toBe(1);
  });

  it('sem limite no tipo, vale o da config', () => {
    expect(openLimitFor(type(), config)).toBe(3);
  });
});
