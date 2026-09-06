import {
  CapsRuleConfigSchema,
  LinksRuleConfigSchema,
  MentionsRuleConfigSchema,
  SpamRuleConfigSchema,
  WordsRuleConfigSchema,
} from '@cobot/shared';
import { describe, expect, it } from 'vitest';

import { capsRule } from './caps';
import { extractHosts, isAllowedHost, linksRule } from './links';
import { mentionsRule } from './mentions';
import { SpamTracker, spamRule } from './spam';
import { compileWordMatcher, WordMatcherCache, wordsRule } from './words';

import type { AutomodRuntime, MessageContext } from '../types';
import type { z } from 'zod';

const GUILD_ID = '900000000000000000';
const CHANNEL_ID = '800000000000000000';
const USER_ID = '700000000000000000';

function runtime(): AutomodRuntime {
  return { spam: new SpamTracker(), words: new WordMatcherCache() };
}

function message(overrides: Partial<MessageContext> = {}): MessageContext {
  return {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    userId: USER_ID,
    messageId: '1',
    content: '',
    mentionedUserIds: [],
    mentionedRoleIds: [],
    mentionsEveryone: false,
    canMentionEveryone: false,
    timestamp: 1_000,
    isEdit: false,
    ...overrides,
  };
}

describe('spamRule', () => {
  const config = SpamRuleConfigSchema.parse({ maxMessages: 5, intervalSeconds: 3 });

  function send(count: number, options: { content?: string; step?: number } = {}) {
    const shared = runtime();
    let last = null;
    for (let i = 0; i < count; i++) {
      last = spamRule.check({
        ctx: message({
          content: options.content ?? `msg ${i}`,
          timestamp: 1_000 + i * (options.step ?? 100),
        }),
        config,
        ruleId: 'rule-spam',
        runtime: shared,
      });
    }
    return last;
  }

  it('não dispara com 5 mensagens em 3s', () => {
    expect(send(5)).toBeNull();
  });

  it('dispara na 6ª mensagem em 3s', () => {
    expect(send(6)?.reason).toContain('Flood');
  });

  it('não conta mensagens fora da janela', () => {
    // 1s entre mensagens: só 3 cabem numa janela de 3s.
    expect(send(10, { step: 1_000 })).toBeNull();
  });

  it('dispara por mensagens idênticas seguidas', () => {
    const duplicates = SpamRuleConfigSchema.parse({
      maxMessages: 50,
      intervalSeconds: 60,
      maxDuplicates: 3,
    });
    const shared = runtime();
    let last = null;
    for (let i = 0; i < 4; i++) {
      last = spamRule.check({
        ctx: message({ content: 'oi', timestamp: 1_000 + i * 100 }),
        config: duplicates,
        ruleId: 'rule-dup',
        runtime: shared,
      });
    }
    expect(last?.reason).toContain('idênticas');
  });

  it('ignora edições', () => {
    const shared = runtime();
    for (let i = 0; i < 20; i++) {
      const result = spamRule.check({
        ctx: message({ content: `x${i}`, isEdit: true, timestamp: 1_000 + i }),
        config,
        ruleId: 'rule-edit',
        runtime: shared,
      });
      expect(result).toBeNull();
    }
  });
});

describe('linksRule', () => {
  const config = LinksRuleConfigSchema.parse({ allowedDomains: ['exemplo.com'] });

  it('extrai domínios com e sem esquema', () => {
    expect(extractHosts('veja https://www.Exemplo.com/a e outro.net/b')).toEqual([
      'exemplo.com',
      'outro.net',
    ]);
  });

  it('libera subdomínio de um domínio permitido', () => {
    expect(isAllowedHost('cdn.exemplo.com', ['exemplo.com'])).toBe(true);
    expect(isAllowedHost('exemplo.com.br', ['exemplo.com'])).toBe(false);
  });

  it('bloqueia convite do Discord', () => {
    const result = linksRule.check({
      ctx: message({ content: 'entra aí discord.gg/abc123' }),
      config,
      ruleId: 'r',
      runtime: runtime(),
    });
    expect(result?.reason).toContain('Convite');
  });

  it('bloqueia link fora da allowlist e libera o que está nela', () => {
    const blocked = linksRule.check({
      ctx: message({ content: 'https://malicioso.tld/x' }),
      config,
      ruleId: 'r',
      runtime: runtime(),
    });
    expect(blocked?.reason).toContain('Link');

    const allowed = linksRule.check({
      ctx: message({ content: 'https://exemplo.com/x' }),
      config,
      ruleId: 'r',
      runtime: runtime(),
    });
    expect(allowed).toBeNull();
  });

  it('respeita canais liberados', () => {
    const result = linksRule.check({
      ctx: message({ content: 'https://malicioso.tld' }),
      config: LinksRuleConfigSchema.parse({ allowedChannelIds: [CHANNEL_ID] }),
      ruleId: 'r',
      runtime: runtime(),
    });
    expect(result).toBeNull();
  });

  it('com invitesOnly, links comuns passam', () => {
    const config = LinksRuleConfigSchema.parse({ invitesOnly: true });
    expect(
      linksRule.check({
        ctx: message({ content: 'https://malicioso.tld' }),
        config,
        ruleId: 'r',
        runtime: runtime(),
      }),
    ).toBeNull();
    expect(
      linksRule.check({
        ctx: message({ content: 'discord.gg/abc' }),
        config,
        ruleId: 'r',
        runtime: runtime(),
      }),
    ).not.toBeNull();
  });
});

describe('capsRule', () => {
  const config = CapsRuleConfigSchema.parse({ minPercent: 70, minLength: 10 });
  const check = (content: string) =>
    capsRule.check({ ctx: message({ content }), config, ruleId: 'r', runtime: runtime() });

  it('ignora mensagem curta', () => {
    expect(check('SOCORRO')).toBeNull();
  });

  it('dispara em gritaria', () => {
    expect(check('SOCORRO GENTE ISSO AQUI')?.reason).toContain('maiúsculas');
  });

  it('não dispara em texto normal', () => {
    expect(check('bom dia pessoal, tudo certo por aí?')).toBeNull();
  });
});

describe('wordsRule', () => {
  const check = (config: z.infer<typeof WordsRuleConfigSchema>, content: string) =>
    wordsRule.check({ ctx: message({ content }), config, ruleId: 'r', runtime: runtime() });

  it('modo exact respeita fronteira de palavra', () => {
    const config = WordsRuleConfigSchema.parse({ mode: 'exact', words: ['bobo'] });
    expect(check(config, 'você é BOBO')?.detail).toBe('bobo');
    expect(check(config, 'bobolândia é legal')).toBeNull();
  });

  it('modo exact ignora acentos por padrão', () => {
    const config = WordsRuleConfigSchema.parse({ mode: 'exact', words: ['palavrao'] });
    expect(check(config, 'que palavrão')).not.toBeNull();
  });

  it('modo wildcard expande *', () => {
    const config = WordsRuleConfigSchema.parse({ mode: 'wildcard', words: ['palavr*'] });
    expect(check(config, 'isso é palavreado')).not.toBeNull();
    expect(check(config, 'nada aqui')).toBeNull();
  });

  it('modo regex casa e respeita caseSensitive', () => {
    const config = WordsRuleConfigSchema.parse({
      mode: 'regex',
      words: ['spam\\d+'],
      caseSensitive: true,
    });
    expect(check(config, 'olha spam42')?.detail).toBe('spam42');
    expect(check(config, 'olha SPAM42')).toBeNull();
  });

  it('recusa regex com backtracking catastrófico', () => {
    const matcher = compileWordMatcher(
      WordsRuleConfigSchema.parse({ mode: 'regex', words: ['(a+)+$', 'ok\\d'] }),
    );
    expect(matcher.rejected).toContain('(a+)+$');
    // O padrão seguro da mesma lista continua valendo.
    expect(matcher.match('ok1')).toBe('ok1');
    expect(matcher.match('aaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toBeNull();
  });

  it('reaproveita o matcher compilado enquanto o config não muda', () => {
    const cache = new WordMatcherCache();
    const config = WordsRuleConfigSchema.parse({ mode: 'exact', words: ['x'] });
    expect(cache.get('r', config)).toBe(cache.get('r', config));

    const changed = WordsRuleConfigSchema.parse({ mode: 'exact', words: ['y'] });
    expect(cache.get('r', changed)).not.toBe(cache.get('r', config));
  });
});

describe('mentionsRule', () => {
  const config = MentionsRuleConfigSchema.parse({ maxMentions: 3 });
  const check = (ctx: Partial<MessageContext>) =>
    mentionsRule.check({ ctx: message(ctx), config, ruleId: 'r', runtime: runtime() });

  it('conta usuários e cargos juntos', () => {
    expect(check({ mentionedUserIds: ['1', '2'], mentionedRoleIds: ['3'] })).toBeNull();
    expect(
      check({ mentionedUserIds: ['1', '2'], mentionedRoleIds: ['3', '4'] })?.reason,
    ).toContain('Menção em massa');
  });

  it('não conta a mesma menção duas vezes', () => {
    expect(check({ mentionedUserIds: ['1', '1', '1', '1', '1'] })).toBeNull();
  });

  it('bloqueia @everyone de quem não pode', () => {
    expect(check({ mentionsEveryone: true })?.detail).toBe('@everyone');
    expect(check({ mentionsEveryone: true, canMentionEveryone: true })).toBeNull();
  });
});

describe('extractHosts', () => {
  it('ignora nomes de arquivo sem esquema e sem caminho', () => {
    expect(extractHosts('manda o relatorio.pdf aí')).toEqual([]);
    expect(extractHosts('baixa em https://cdn.tld/relatorio.pdf')).toEqual(['cdn.tld']);
  });

  it('não repete o mesmo domínio', () => {
    expect(extractHosts('https://a.tld/1 https://a.tld/2')).toEqual(['a.tld']);
  });
});
