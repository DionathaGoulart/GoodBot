import { DEFAULT_SQUAD_BLOCKS } from '@goodbot/shared';
import { describe, expect, it } from 'vitest';

import { formatSlot, renderProposalThreadName, renderSquadChannelName } from './slots';

describe('formatSlot', () => {
  it('escreve dia e faixa com o horário', () => {
    expect(formatSlot(6, 2, DEFAULT_SQUAD_BLOCKS)).toBe('Sábado, Noite (18h às 24h)');
    expect(formatSlot(1, 0, DEFAULT_SQUAD_BLOCKS)).toBe('Segunda, Manhã (6h às 12h)');
  });

  it('a madrugada diz de qual noite ela é', () => {
    expect(formatSlot(6, 3, DEFAULT_SQUAD_BLOCKS)).toBe(
      'Madrugada de sábado (0h às 6h, noite de sexta para sábado)',
    );
    expect(formatSlot(0, 3, DEFAULT_SQUAD_BLOCKS)).toBe(
      'Madrugada de domingo (0h às 6h, noite de sábado para domingo)',
    );
  });

  it('usa o rótulo e o horário editados no painel', () => {
    const blocks = DEFAULT_SQUAD_BLOCKS.map((block) =>
      block.key === 'evening' ? { ...block, label: 'Noitão', startHour: 19, endHour: 23 } : block,
    );
    expect(formatSlot(5, 2, blocks)).toBe('Sexta, Noitão (19h às 23h)');
  });

  it('nunca usa travessão', () => {
    for (let day = 0; day < 7; day++) {
      for (let block = 0; block < 4; block++) {
        expect(formatSlot(day, block, DEFAULT_SQUAD_BLOCKS)).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });

  it('lança fora da grade', () => {
    expect(() => formatSlot(7, 0, DEFAULT_SQUAD_BLOCKS)).toThrow(RangeError);
    expect(() => formatSlot(0, 4, DEFAULT_SQUAD_BLOCKS)).toThrow(RangeError);
  });
});

describe('renderSquadChannelName', () => {
  it('troca {name} e saneia como os tickets', () => {
    expect(renderSquadChannelName('squad-{name}', 'Helldivers 2 #1')).toBe('squad-helldivers-2-1');
    expect(renderSquadChannelName('{name}', 'Esquadrão Ação')).toBe('esquadrao-acao');
  });

  it('corta em 100 caracteres', () => {
    expect(renderSquadChannelName('squad-{name}', 'a'.repeat(300))).toHaveLength(100);
  });

  it('cai em "squad" quando não sobra nada', () => {
    expect(renderSquadChannelName('{name}', '!!!')).toBe('squad');
  });
});

describe('renderProposalThreadName', () => {
  it('é squad-<jogo>', () => {
    expect(renderProposalThreadName('Helldivers 2')).toBe('squad-helldivers-2');
  });
});
