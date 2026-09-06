import { DEFAULT_MODERATION_CONFIG, isUserFacingError, MINUTE_MS } from '@cobot/shared';
import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModerationService } from './moderation';

import type { ConfigService } from './config';
import type { ModlogService } from './modlog';
import type { Case } from '@cobot/db';
import type { ModerationConfig } from '@cobot/shared';
import type { Client, Guild, GuildMember, User } from 'discord.js';

const { createCase, scheduleAction, softDeleteCase, cancelScheduledActions, countWarnsSince } =
  vi.hoisted(() => ({
    createCase: vi.fn(),
    scheduleAction: vi.fn(),
    softDeleteCase: vi.fn(),
    cancelScheduledActions: vi.fn(),
    countWarnsSince: vi.fn(),
  }));

vi.mock('@cobot/db', () => ({
  createCase,
  scheduleAction,
  softDeleteCase,
  cancelScheduledActions,
  countWarnsSince,
}));

const BOT_ID = '100000000000000000';
const GUILD_ID = '900000000000000000';

let caseNumber = 0;

/** Devolve um `Case` plausível a partir do que o serviço mandou inserir. */
function fakeCase(input: Record<string, unknown>): Case {
  caseNumber += 1;
  return {
    id: caseNumber,
    caseNumber,
    modlogMessageId: null,
    modlogChannelId: null,
    editedBy: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    ...input,
  } as Case;
}

function makeUser(id: string, tag = `user-${id}`): User {
  return { id, tag, bot: false, send: vi.fn().mockResolvedValue(undefined) } as unknown as User;
}

interface MemberOptions {
  position?: number;
  owner?: boolean;
  bot?: boolean;
}

function makeMember(id: string, options: MemberOptions = {}): GuildMember {
  return {
    id,
    user: { id, tag: `user-${id}`, bot: options.bot ?? false },
    guild: { ownerId: options.owner ? id : '999999999999999999' },
    roles: { cache: new Collection(), highest: { position: options.position ?? 1 } },
    permissions: { has: () => false },
    kick: vi.fn().mockResolvedValue(undefined),
    timeout: vi.fn().mockResolvedValue(undefined),
    communicationDisabledUntil: null,
  } as unknown as GuildMember;
}

interface Harness {
  service: ModerationService;
  guild: Guild;
  actor: GuildMember;
  target: User;
  targetMember: GuildMember;
  bans: { create: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  modlog: ModlogService;
}

function setup(
  options: { config?: Partial<ModerationConfig>; targetPosition?: number } = {},
): Harness {
  const bot = makeMember(BOT_ID, { position: 50, bot: true });
  const actor = makeMember('200000000000000000', { position: 20 });
  const targetMember = makeMember('300000000000000000', {
    position: options.targetPosition ?? 5,
  });
  const target = makeUser(targetMember.id);

  const bans = {
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const guild = {
    id: GUILD_ID,
    name: 'Servidor de Teste',
    ownerId: '999999999999999999',
    iconURL: () => null,
    members: {
      me: bot,
      cache: new Collection([[targetMember.id, targetMember]]),
      fetch: vi.fn().mockRejectedValue(new Error('não deveria buscar')),
    },
    bans,
    client: { user: { id: BOT_ID, tag: 'CoBot#0001' } },
  } as unknown as Guild;

  const config = {
    get: vi.fn().mockResolvedValue({ ...DEFAULT_MODERATION_CONFIG, ...options.config }),
    getSettings: vi.fn().mockResolvedValue({ dmOnPunish: null, embedColor: 0 }),
  } as unknown as ConfigService;

  const modlog: ModlogService = {
    postCase: vi.fn().mockResolvedValue(undefined),
    updateCase: vi.fn().mockResolvedValue(undefined),
    postAction: vi.fn().mockResolvedValue(undefined),
  };

  const client = { user: { id: BOT_ID, tag: 'CoBot#0001' } } as unknown as Client;

  return {
    service: new ModerationService({ db: {} as never, client, config, modlog }),
    guild,
    actor,
    target,
    targetMember,
    bans,
    modlog,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  caseNumber = 0;
  createCase.mockImplementation((_db: unknown, input: Record<string, unknown>) =>
    Promise.resolve(fakeCase(input)),
  );
  scheduleAction.mockResolvedValue(undefined);
  softDeleteCase.mockResolvedValue(null);
  cancelScheduledActions.mockResolvedValue(0);
  countWarnsSince.mockResolvedValue(0);
});

describe('hierarquia', () => {
  it('recusa punir alguém com cargo superior e não cria caso', async () => {
    const h = setup({ targetPosition: 40 });

    await expect(
      h.service.ban({ guild: h.guild, target: h.target, actor: h.actor, reason: 'teste' }),
    ).rejects.toSatisfy((error: unknown) => isUserFacingError(error) && error.code === 'HIERARCHY');

    expect(createCase).not.toHaveBeenCalled();
    expect(h.bans.create).not.toHaveBeenCalled();
  });

  it('recusa quando o cargo do bot está abaixo do alvo', async () => {
    const h = setup({ targetPosition: 80 });

    await expect(
      h.service.kick({ guild: h.guild, target: h.target, actor: h.actor }),
    ).rejects.toSatisfy(
      (error: unknown) => isUserFacingError(error) && error.code === 'BOT_HIERARCHY',
    );
    expect(createCase).not.toHaveBeenCalled();
  });
});

describe('ban', () => {
  it('cria o caso com expires_at e agenda o unban quando há duração', async () => {
    const h = setup();
    const before = Date.now();

    const result = await h.service.ban({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'flood',
      durationMs: 60 * MINUTE_MS,
    });

    const input = createCase.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.type).toBe('ban');
    expect(input.durationMs).toBe(60 * MINUTE_MS);
    const expiresAt = input.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * MINUTE_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * MINUTE_MS);

    const scheduled = scheduleAction.mock.calls[0]![1] as Record<string, unknown>;
    expect(scheduled.kind).toBe('unban');
    expect(scheduled.runAt).toBe(expiresAt);
    expect(scheduled.payload).toMatchObject({ targetId: h.target.id });

    expect(h.bans.create).toHaveBeenCalledOnce();
    expect(h.modlog.postCase).toHaveBeenCalledWith(result.case);
  });

  it('não agenda nada num ban permanente', async () => {
    const h = setup();
    await h.service.ban({ guild: h.guild, target: h.target, actor: h.actor });

    expect((createCase.mock.calls[0]![1] as Record<string, unknown>).expiresAt).toBeNull();
    expect(scheduleAction).not.toHaveBeenCalled();
  });

  it('usa o motivo padrão da config quando nenhum é informado', async () => {
    const h = setup({ config: { defaultReason: 'sem motivo informado' } });
    await h.service.ban({ guild: h.guild, target: h.target, actor: h.actor });

    expect((createCase.mock.calls[0]![1] as Record<string, unknown>).reason).toBe(
      'sem motivo informado',
    );
  });

  it('apaga o caso quando a ação no Discord falha', async () => {
    const h = setup();
    h.bans.create.mockRejectedValueOnce(new Error('403'));

    await expect(
      h.service.ban({ guild: h.guild, target: h.target, actor: h.actor }),
    ).rejects.toThrow();

    expect(createCase).toHaveBeenCalledOnce();
    expect(softDeleteCase).toHaveBeenCalledWith({}, GUILD_ID, 1);
  });
});

describe('timeout', () => {
  it('recusa duração acima do limite do Discord', async () => {
    const h = setup();
    await expect(
      h.service.timeout({
        guild: h.guild,
        target: h.target,
        actor: h.actor,
        durationMs: 40 * 24 * 60 * 60 * 1000,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isUserFacingError(error) && error.code === 'TIMEOUT_TOO_LONG',
    );
    expect(createCase).not.toHaveBeenCalled();
  });

  it('agenda o untimeout para gerar o caso quando expirar', async () => {
    const h = setup();
    await h.service.timeout({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      durationMs: 10 * MINUTE_MS,
    });

    expect((scheduleAction.mock.calls[0]![1] as Record<string, unknown>).kind).toBe('untimeout');
    expect(h.targetMember.timeout).toHaveBeenCalledWith(10 * MINUTE_MS, expect.any(String));
  });
});

describe('DM ao punido', () => {
  it('avisa o alvo quando a config pede', async () => {
    const h = setup();
    const result = await h.service.warn({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'spam',
    });

    expect(h.target.send).toHaveBeenCalledOnce();
    expect(result.dmSent).toBe(true);
  });

  it('não deixa a DM fechada derrubar a punição', async () => {
    const h = setup();
    vi.mocked(h.target.send).mockRejectedValueOnce(new Error('DM fechada'));

    const result = await h.service.warn({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'spam',
    });

    expect(result.dmSent).toBe(false);
    expect(result.case.type).toBe('warn');
  });

  it('nunca manda DM de anotação', async () => {
    const h = setup();
    await h.service.note({ guild: h.guild, target: h.target, actor: h.actor, reason: 'olho nele' });

    expect(h.target.send).not.toHaveBeenCalled();
  });
});

describe('escalada', () => {
  const escalation = {
    enabled: true,
    steps: [{ warns: 3, withinDays: 1, action: 'timeout' as const, durationMs: 10 * MINUTE_MS }],
  };

  it('aplica o timeout configurado no terceiro warn da janela', async () => {
    const h = setup({ config: { escalation } });
    countWarnsSince.mockResolvedValue(3);

    const result = await h.service.warn({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'terceiro',
    });

    expect(result.escalation?.step.action).toBe('timeout');
    expect(createCase).toHaveBeenCalledTimes(2);
    const escalated = createCase.mock.calls[1]![1] as Record<string, unknown>;
    expect(escalated.type).toBe('timeout');
    expect(escalated.source).toBe('escalation');
    // A escalada é do bot, não do moderador que deu o warn.
    expect(escalated.actorId).toBe(BOT_ID);
  });

  it('não escala quando a contagem ainda não bateu o degrau', async () => {
    const h = setup({ config: { escalation } });
    countWarnsSince.mockResolvedValue(2);

    const result = await h.service.warn({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'segundo',
    });

    expect(result.escalation).toBeNull();
    expect(createCase).toHaveBeenCalledOnce();
  });

  it('uma escalada que falha não invalida o warn', async () => {
    const h = setup({ config: { escalation } });
    countWarnsSince.mockResolvedValue(3);
    vi.mocked(h.targetMember.timeout).mockRejectedValueOnce(new Error('403'));

    const result = await h.service.warn({
      guild: h.guild,
      target: h.target,
      actor: h.actor,
      reason: 'terceiro',
    });

    expect(result.case.type).toBe('warn');
    expect(result.escalation).toBeNull();
  });
});

describe('unban', () => {
  it('cancela o unban agendado do tempban', async () => {
    const h = setup();
    await h.service.unban({ guild: h.guild, target: h.target, actor: h.actor, reason: 'perdão' });

    expect(h.bans.remove).toHaveBeenCalledOnce();
    expect(cancelScheduledActions).toHaveBeenCalledWith(
      {},
      {
        guildId: GUILD_ID,
        kind: 'unban',
        targetId: h.target.id,
      },
    );
    expect(h.target.send).not.toHaveBeenCalled();
  });
});
