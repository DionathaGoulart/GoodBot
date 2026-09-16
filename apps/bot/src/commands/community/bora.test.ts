import { describe, expect, it } from 'vitest';

import bora, { whenChoices } from './bora';

const json = bora.data.toJSON();
const SAO_PAULO = 'America/Sao_Paulo';
/** Segunda-feira, 14/09/2026, 9h em São Paulo. */
const MONDAY_9AM = new Date('2026-09-14T12:00:00Z');

describe('/bora', () => {
  it('é do módulo squads, aberto a membros e sem adiar sozinho', () => {
    expect(bora.module).toBe('squads');
    expect(bora.level).toBe('member');
    expect(bora.ephemeral).toBe(true);
    // Sem "quando" o comando abre o modal do BORA: adiar quebraria o `showModal`.
    expect(bora.opensModal).toBe(true);
    expect(bora.defer).toBeFalsy();
  });

  it('as duas opções são opcionais e têm autocomplete', () => {
    expect(
      (json.options ?? []).map((option) => ({
        name: option.name,
        required: option.required ?? false,
        autocomplete: 'autocomplete' in option ? option.autocomplete : false,
      })),
    ).toEqual([
      { name: 'quando', required: false, autocomplete: true },
      { name: 'squad', required: false, autocomplete: true },
    ]);
  });
});

describe('whenChoices', () => {
  it('sem nada digitado, sugere o que vale agora', () => {
    const choices = whenChoices('', MONDAY_9AM, SAO_PAULO);
    expect(choices[0]).toEqual({ name: 'agora → hoje às 09:00', value: 'agora' });
    expect(choices.map((choice) => choice.value)).toContain('amanhã 21h');
  });

  it('ecoa o que entendeu do texto digitado, com o texto como valor', () => {
    expect(whenChoices('sex 22h', MONDAY_9AM, SAO_PAULO)).toEqual([
      { name: 'sex 22h → sexta 18/09 às 22:00', value: 'sex 22h' },
    ]);
  });

  it('mostra o erro antes do envio', () => {
    const [choice] = whenChoices('hoje 8h', MONDAY_9AM, SAO_PAULO);
    expect(choice?.value).toBe('hoje 8h');
    expect(choice?.name).toMatch(/já passou/);
    expect(choice!.name.length).toBeLessThanOrEqual(100);
  });
});
