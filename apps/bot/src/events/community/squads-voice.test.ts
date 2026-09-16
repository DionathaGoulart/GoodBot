import { describe, expect, it, vi } from 'vitest';

import { squadVoiceStateUpdate } from './squads-voice';

import type { BotContext } from '../../lib/command';
import type { VoiceState } from 'discord.js';

const POOL_A = '400000000000000001';
const POOL_B = '400000000000000002';
const LOBBY = '400000000000000003';
const USER = '300000000000000001';

function harness() {
  const calls: string[] = [];
  const ctx = {
    config: { get: vi.fn(async () => ({ enabled: true, voicePoolIds: [POOL_A, POOL_B] })) },
    squads: {
      recordVoiceLeave: vi.fn(async () => {
        calls.push('leave');
        return 1;
      }),
      releaseEmptyVoice: vi.fn(async () => {
        calls.push('release');
        return false;
      }),
      confirmVoicePresence: vi.fn(async () => {
        calls.push('enter');
        return true;
      }),
    },
  };
  const guild = { id: '900000000000000000' };
  const state = (channelId: string | null) =>
    ({ id: USER, channelId, guild, member: { user: { bot: false } } }) as unknown as VoiceState;
  const run = (from: string | null, to: string | null) =>
    squadVoiceStateUpdate.execute(ctx as unknown as BotContext, state(from), state(to));
  return { ctx, calls, run };
}

describe('evento de voz dos squads', () => {
  it('pular de um voice do pool para outro fecha a presença velha antes de abrir a nova', async () => {
    const h = harness();

    await h.run(POOL_A, POOL_B);

    expect(h.calls).toEqual(['leave', 'release', 'enter']);
    expect(h.ctx.squads.recordVoiceLeave).toHaveBeenCalledWith(expect.anything(), USER);
  });

  it('voice fora do pool não consulta nada, e mute sem troca de canal é ignorado', async () => {
    const h = harness();

    await h.run(LOBBY, null);
    await h.run(POOL_A, POOL_A);

    expect(h.calls).toEqual([]);
  });

  it('entrar no pool vindo de fora só abre; sair para fora só fecha', async () => {
    const h = harness();

    await h.run(LOBBY, POOL_A);
    expect(h.calls).toEqual(['enter']);

    await h.run(POOL_A, null);
    expect(h.calls).toEqual(['enter', 'leave', 'release']);
  });
});
