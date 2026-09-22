import { ChannelType } from 'discord.js';
import { describe, expect, it } from 'vitest';

import { canBotSend, noticeChannel } from './channels';

import type { Guild, GuildBasedChannel } from 'discord.js';

function channel(input: {
  id: string;
  position?: number;
  text?: boolean;
  pode?: boolean;
  semMe?: boolean;
}): GuildBasedChannel {
  const text = input.text ?? true;
  return {
    id: input.id,
    type: text ? ChannelType.GuildText : ChannelType.GuildVoice,
    rawPosition: input.position ?? 0,
    isTextBased: () => text,
    guild: { members: { me: input.semMe ? null : {} } },
    permissionsFor: () => ({ has: () => input.pode ?? true }),
  } as unknown as GuildBasedChannel;
}

function guild(input: {
  systemChannel?: GuildBasedChannel | null;
  channels?: GuildBasedChannel[];
}): Guild {
  return {
    systemChannel: input.systemChannel ?? null,
    channels: { cache: new Map((input.channels ?? []).map((c) => [c.id, c])) },
  } as unknown as Guild;
}

describe('canBotSend', () => {
  it('recusa canal que não é de texto', () => {
    expect(canBotSend(channel({ id: 'a', text: false }))).toBe(false);
  });

  it('recusa quando o bot não é membro da guild', () => {
    expect(canBotSend(channel({ id: 'a', semMe: true }))).toBe(false);
  });

  it('recusa sem permissão de falar', () => {
    expect(canBotSend(channel({ id: 'a', pode: false }))).toBe(false);
  });
});

describe('noticeChannel', () => {
  it('prefere o canal escolhido pelo servidor', () => {
    const sistema = channel({ id: 'sistema' });
    const escolhido = channel({ id: 'escolhido' });
    const g = guild({ systemChannel: sistema, channels: [sistema, escolhido] });
    expect(noticeChannel(g, 'escolhido')?.id).toBe('escolhido');
  });

  it('cai no canal de sistema quando o escolhido sumiu ou calou o bot', () => {
    const sistema = channel({ id: 'sistema' });
    const mudo = channel({ id: 'mudo', pode: false });
    const g = guild({ systemChannel: sistema, channels: [sistema, mudo] });
    expect(noticeChannel(g, 'apagado')?.id).toBe('sistema');
    expect(noticeChannel(g, 'mudo')?.id).toBe('sistema');
  });

  it('prefere o canal de sistema', () => {
    const sistema = channel({ id: 'sistema' });
    const outro = channel({ id: 'outro' });
    expect(noticeChannel(guild({ systemChannel: sistema, channels: [outro] }))?.id).toBe('sistema');
  });

  it('cai no primeiro canal de texto onde consegue falar', () => {
    const mudo = channel({ id: 'mudo', position: 0, pode: false });
    const voz = channel({ id: 'voz', position: 1, text: false });
    const bom = channel({ id: 'bom', position: 2 });
    expect(noticeChannel(guild({ channels: [mudo, voz, bom] }))?.id).toBe('bom');
  });

  it('ignora o canal de sistema onde o bot não pode falar', () => {
    const sistema = channel({ id: 'sistema', pode: false });
    const bom = channel({ id: 'bom' });
    expect(noticeChannel(guild({ systemChannel: sistema, channels: [bom] }))?.id).toBe('bom');
  });

  it('devolve nulo quando não há onde falar', () => {
    expect(noticeChannel(guild({ channels: [channel({ id: 'mudo', pode: false })] }))).toBeNull();
  });
});
