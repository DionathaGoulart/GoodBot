import { describe, expect, it, vi } from 'vitest';

import {
  CANAL_POR_HANDLE,
  CANAL_SEM_HANDLE,
  FEED,
  FEED_COM_LIVE,
  LIVE_EM_ANDAMENTO,
  LIVE_EM_ANDAMENTO_SEM_METADADOS,
  LIVE_SEM_CANONICAL,
  LIVE_SEM_TRANSMISSAO,
  PAGINA_404,
  WATCH_AGENDADA,
  WATCH_VIDEO,
  WATCH_VIDEO_DO_FEED,
  WATCH_VIDEO_SEM_METADADOS,
  WATCH_VOD_DE_LIVE,
} from './__fixtures__/youtube';
import {
  parseCanonical,
  parseChannelInput,
  parseChannelPage,
  parseCurrentVideoId,
  parseWatchState,
  parseYouTubeFeed,
  YouTubeProvider,
} from './youtube';

import type { SocialAccountRef } from './types';
import type { SocialKind } from '@goodbot/shared';

const CANAL = 'UCabcdefghijklmnopqrstuv';
const LOFI = 'UCSJ4gkVC6NrvII8umztf0Ow';
const SEM_LIVE = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const LIVE_ID = 'rFZHOHl-L8A';
const AVATAR =
  'https://yt3.googleusercontent.com/_BSh2VVvVMzqBoKyWbQnyC35XFOV-ZbXavf9nfu3ZjpFUGEImQnlWt9ZlpfGQBqWEbGNc4rPWg=s900-c-k-c0x00ffffff-no-rj';

interface FakeOptions {
  feed?: string;
  feedStatus?: number;
  /** IDs que a rota `/shorts/<id>` reconhece com `200`. */
  shorts?: readonly string[];
  /** Corpo de `/channel/<id>/live`. */
  live?: string;
  /** `videoId` → HTML de `watch?v=`. */
  watch?: Record<string, string>;
  /** Caminho da página de canal (`/@LofiGirl`, `/c/lofi`) → HTML. */
  pages?: Record<string, string>;
}

/**
 * O YouTube inteiro em vinte linhas: feed, `HEAD /shorts`, `/live`, `watch` e
 * páginas de canal. Tudo o que não está declarado responde `404`, que é o que
 * o YouTube faz de verdade.
 */
function fakeYouTube(options: FakeOptions = {}) {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/feeds/videos.xml')) {
      return Promise.resolve(
        new Response(options.feed ?? FEED, { status: options.feedStatus ?? 200 }),
      );
    }
    if (url.includes('/shorts/')) {
      const id = url.split('/shorts/')[1] ?? '';
      return Promise.resolve(
        new Response(null, { status: options.shorts?.includes(id) ? 200 : 303 }),
      );
    }
    if (url.includes('/watch?v=')) {
      const id = url.split('/watch?v=')[1] ?? '';
      const body = options.watch?.[id];
      return Promise.resolve(
        body ? new Response(body, { status: 200 }) : new Response(PAGINA_404, { status: 404 }),
      );
    }
    if (url.endsWith('/live')) {
      return Promise.resolve(new Response(options.live ?? LIVE_SEM_TRANSMISSAO, { status: 200 }));
    }
    const body = options.pages?.[new URL(url).pathname];
    return Promise.resolve(
      body ? new Response(body, { status: 200 }) : new Response(PAGINA_404, { status: 404 }),
    );
  }) as unknown as typeof globalThis.fetch;
}

function calls(mock: typeof globalThis.fetch): string[] {
  return (mock as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(([url]) =>
    String(url),
  );
}

function account(overrides: Partial<SocialAccountRef> = {}): SocialAccountRef {
  return {
    id: 'conta-1',
    platform: 'youtube',
    externalId: CANAL,
    kinds: ['video', 'short'] as SocialKind[],
    isKnown: () => Promise.resolve(false),
    ...overrides,
  };
}

describe('parseYouTubeFeed', () => {
  it('lê as entradas do feed Atom com título, autor, capa e data', () => {
    const entries = parseYouTubeFeed(FEED);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      videoId: 'aaaaaaaaaaa',
      // O `<title>` do feed vem com entidades; o parser precisa decodificar as
      // nomeadas (&amp;) e as numéricas (&#186;).
      title: 'Café & código: o vídeo nº 3',
      author: 'Canal de Teste',
      url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      thumbnail: 'https://i4.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
    });
    expect(entries[0]?.publishedAt?.toISOString()).toBe('2026-09-06T18:30:00.000Z');
  });

  it('não confunde o título do canal com o da primeira entrada', () => {
    expect(parseYouTubeFeed(FEED)[0]?.title).not.toBe('Canal de Teste');
  });

  it('ignora entrada truncada em vez de lançar', () => {
    const truncado = '<feed><entry><title>sem id</title></entry></feed>';
    expect(parseYouTubeFeed(truncado)).toEqual([]);
  });

  it('devolve lista vazia para um corpo que não é feed', () => {
    expect(parseYouTubeFeed('<html><body>404</body></html>')).toEqual([]);
  });
});

describe('parseCanonical', () => {
  it('lê o canonical de uma live e o de um canal', () => {
    expect(parseCanonical(LIVE_EM_ANDAMENTO)).toBe(`https://www.youtube.com/watch?v=${LIVE_ID}`);
    expect(parseCanonical(LIVE_SEM_TRANSMISSAO)).toBe(
      `https://www.youtube.com/channel/${SEM_LIVE}`,
    );
  });

  it('devolve null quando a tag sumiu, em vez de lançar', () => {
    expect(parseCanonical(LIVE_SEM_CANONICAL)).toBeNull();
    expect(parseCanonical('')).toBeNull();
  });

  it('a tag existe e o href é a string "undefined" — nem URL, nem ausente', () => {
    // O caso que quebrou a sonda: `null` teria virado erro e alerta; isto aqui
    // passou batido como "não tem live".
    expect(parseCanonical(LIVE_EM_ANDAMENTO_SEM_METADADOS)).toBe('undefined');
  });
});

describe('parseCurrentVideoId', () => {
  it('tira o videoId do currentVideoEndpoint quando o canonical não presta', () => {
    expect(parseCurrentVideoId(LIVE_EM_ANDAMENTO_SEM_METADADOS)).toBe(LIVE_ID);
    expect(parseCurrentVideoId(WATCH_VIDEO_SEM_METADADOS)).toBe('aaaaaaaaaaa');
  });

  it('devolve null onde não há ytInitialData, sem lançar', () => {
    expect(parseCurrentVideoId(LIVE_EM_ANDAMENTO)).toBeNull();
    expect(parseCurrentVideoId('')).toBeNull();
  });
});

describe('parseWatchState', () => {
  it('reconhece a transmissão em andamento com título e autor', () => {
    const state = parseWatchState(LIVE_EM_ANDAMENTO);

    expect(state).toMatchObject({ isLive: true, isUpcoming: false, isLiveContent: true });
    // A rota `/live` não serve `og:title`: o título tem de sair do
    // `<meta name="title">` ou do `videoDetails`.
    expect(state.title).toBe('lofi hip hop radio 📚 beats to relax/study to');
    expect(state.author).toBe('Lofi Girl');
    // …e não serve `og:image` nenhuma; quem inventa a capa é o `probeLive`.
    expect(state.thumbnail).toBeNull();
  });

  it('na agendada isUpcoming e isLive são verdadeiros ao mesmo tempo', () => {
    // Recorte real de 2026-09-19. O `isLive` vem do contador de views do
    // `ytInitialData` ("1 aguardando"), o mesmo campo de uma live de verdade, e
    // só o `isUpcoming` do player distingue as duas. Quem decidir olhando só o
    // `isLive` anuncia a estreia como transmissão.
    expect(parseWatchState(WATCH_AGENDADA)).toMatchObject({
      isLive: true,
      isUpcoming: true,
      isLiveContent: true,
    });
    expect(parseWatchState(WATCH_AGENDADA).title).toBe(
      'DIOGO NOGUEIRA no Bem Brasil: Show completo, ao vivo, do Sesc Itaquera - 20/09/2026',
    );
  });

  it('num vídeo comum nada é live', () => {
    const state = parseWatchState(WATCH_VIDEO);

    expect(state).toMatchObject({ isLive: false, isUpcoming: false, isLiveContent: false });
    expect(state.title).toBe('Me at the zoo');
    // O `&amp;` da URL da capa tem de voltar a ser `&`.
    expect(state.thumbnail).toContain('hqdefault.jpg?sqp=');
    expect(state.thumbnail).not.toContain('&amp;');
  });

  it('o VOD de uma live não está ao vivo, mesmo sendo conteúdo de live', () => {
    // É por isso que o provider olha `"isLive"`, e não `"isLiveContent"`:
    // senão a gravação seria anunciada como uma segunda transmissão.
    expect(parseWatchState(WATCH_VOD_DE_LIVE)).toMatchObject({
      isLive: false,
      isLiveContent: true,
    });
  });

  it('no formato sem metadados, título e autor saem do ytInitialData', () => {
    const state = parseWatchState(LIVE_EM_ANDAMENTO_SEM_METADADOS);

    // Sem `og:`, com `<meta name="title">` vazio e sem `videoDetails`: o que
    // resta é o `videoPrimaryInfoRenderer` e o `videoOwnerRenderer`.
    expect(state).toMatchObject({ isLive: true, isUpcoming: false });
    expect(state.title).toBe('lofi hip hop radio 📚 beats to relax/study to');
    expect(state.author).toBe('Lofi Girl');
    expect(state.thumbnail).toBeNull();
  });

  it('vídeo comum no formato sem metadados não é live', () => {
    expect(parseWatchState(WATCH_VIDEO_SEM_METADADOS)).toMatchObject({
      isLive: false,
      isUpcoming: false,
    });
  });

  it('não acha nada num HTML vazio, e não lança', () => {
    expect(parseWatchState('')).toEqual({
      isLive: false,
      isUpcoming: false,
      isLiveContent: false,
      title: null,
      author: null,
      thumbnail: null,
    });
  });
});

describe('parseChannelPage', () => {
  it('tira UC…, nome, @handle e avatar da página de um handle', () => {
    expect(parseChannelPage(CANAL_POR_HANDLE)).toEqual({
      channelId: LOFI,
      title: 'Lofi Girl',
      handle: '@LofiGirl',
      avatarUrl: AVATAR,
    });
  });

  it('aceita canal sem @handle no JSON — o UC… continua saindo do canonical', () => {
    expect(parseChannelPage(CANAL_SEM_HANDLE)).toMatchObject({
      channelId: CANAL,
      title: 'Canal de Teste',
      handle: null,
    });
  });

  it('sem canonical não há channelId, e nada explode', () => {
    expect(parseChannelPage(LIVE_SEM_CANONICAL).channelId).toBeNull();
    expect(parseChannelPage('<html></html>')).toEqual({
      channelId: null,
      title: null,
      handle: null,
      avatarUrl: null,
    });
  });
});

describe('parseChannelInput', () => {
  it('aceita as formas que uma pessoa realmente tem em mãos', () => {
    expect(parseChannelInput(LOFI)).toEqual({ channelId: LOFI });
    expect(parseChannelInput(`  ${LOFI}  `)).toEqual({ channelId: LOFI });
    expect(parseChannelInput('@LofiGirl')).toEqual({
      pageUrl: 'https://www.youtube.com/@LofiGirl',
    });
    expect(parseChannelInput('https://www.youtube.com/@LofiGirl')).toEqual({
      pageUrl: 'https://www.youtube.com/@LofiGirl',
    });
    expect(parseChannelInput('youtube.com/@LofiGirl')).toEqual({
      pageUrl: 'https://www.youtube.com/@LofiGirl',
    });
    expect(parseChannelInput('https://m.youtube.com/@LofiGirl?si=abc')).toEqual({
      pageUrl: 'https://www.youtube.com/@LofiGirl',
    });
    expect(parseChannelInput(`https://www.youtube.com/channel/${LOFI}`)).toEqual({
      channelId: LOFI,
    });
    expect(parseChannelInput('https://www.youtube.com/c/LofiGirl')).toEqual({
      pageUrl: 'https://www.youtube.com/c/LofiGirl',
    });
    expect(parseChannelInput('https://www.youtube.com/user/LofiGirl/videos')).toEqual({
      pageUrl: 'https://www.youtube.com/user/LofiGirl',
    });
  });

  it('recusa o que não é canal do YouTube', () => {
    expect(parseChannelInput('https://www.twitch.tv/lofigirl')).toBeNull();
    expect(parseChannelInput('não é um canal')).toBeNull();
    expect(parseChannelInput('https://www.youtube.com/watch?v=rFZHOHl-L8A')).toBeNull();
    expect(parseChannelInput('')).toBeNull();
  });
});

describe('YouTubeProvider.classify', () => {
  it('200 em /shorts/<id> é short — e o segundo pedido sai do cache', async () => {
    const fetchMock = fakeYouTube({ shorts: ['bbbbbbbbbbb'] });
    const provider = new YouTubeProvider({ fetch: fetchMock });

    expect(await provider.classify('bbbbbbbbbbb')).toBe('short');
    expect(await provider.classify('bbbbbbbbbbb')).toBe('short');
    expect(calls(fetchMock)).toHaveLength(1);
  });

  it('303 em /shorts/<id> manda a decisão para o watch: vídeo comum', async () => {
    const fetchMock = fakeYouTube({ watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED } });
    const provider = new YouTubeProvider({ fetch: fetchMock });

    expect(await provider.classify('aaaaaaaaaaa')).toBe('video');
    expect(calls(fetchMock)).toEqual([
      'https://www.youtube.com/shorts/aaaaaaaaaaa',
      'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    ]);
  });

  it('reconhece a live pelo watch', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({ watch: { 'rFZHOHl-L8A': LIVE_EM_ANDAMENTO } }),
    });
    expect(await provider.classify('rFZHOHl-L8A')).toBe('live');
  });

  it('a agendada não é cacheada: ela ainda vai virar outra coisa', async () => {
    const fetchMock = fakeYouTube({ watch: { ccccccccccc: WATCH_AGENDADA } });
    const provider = new YouTubeProvider({ fetch: fetchMock });

    expect(await provider.classify('ccccccccccc')).toBe('upcoming');
    expect(await provider.classify('ccccccccccc')).toBe('upcoming');
    // Duas requisições por passada, das duas vezes: nada foi guardado.
    expect(calls(fetchMock)).toHaveLength(4);
  });

  it('erro de rede vira vídeo — errar o rótulo é melhor que não avisar', async () => {
    const fetchMock = vi.fn(() =>
      Promise.reject(new Error('rede fora')),
    ) as unknown as typeof globalThis.fetch;

    expect(await new YouTubeProvider({ fetch: fetchMock }).classify('aaaaaaaaaaa')).toBe('video');
  });
});

describe('YouTubeProvider.probeLive', () => {
  it('canonical de watch + isLive viram um item de live', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ live: LIVE_EM_ANDAMENTO }) });
    const item = await provider.probeLive(LOFI);

    expect(item).toMatchObject({
      externalId: 'rFZHOHl-L8A',
      kind: 'live',
      headline: 'está ao vivo',
      title: 'lofi hip hop radio 📚 beats to relax/study to',
      url: 'https://www.youtube.com/watch?v=rFZHOHl-L8A',
      author: 'Lofi Girl',
      // A rota `/live` não tem `og:image`: a capa é deduzida do ID.
      thumbnail: 'https://i.ytimg.com/vi/rFZHOHl-L8A/hqdefault.jpg',
    });
  });

  it('canonical "undefined" não é "sem live": o ID vem do ytInitialData', async () => {
    // A regressão de 2026-09-11: com a live no ar, a sonda lia `href="undefined"`,
    // não achava `?v=` e devolvia `null` — o módulo passava a transmissão
    // inteira calado, sem uma linha de erro e sem `failure_count` subir.
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({ live: LIVE_EM_ANDAMENTO_SEM_METADADOS }),
    });
    const item = await provider.probeLive(LOFI);

    expect(item).toMatchObject({
      externalId: LIVE_ID,
      kind: 'live',
      title: 'lofi hip hop radio 📚 beats to relax/study to',
      author: 'Lofi Girl',
      url: `https://www.youtube.com/watch?v=${LIVE_ID}`,
      thumbnail: `https://i.ytimg.com/vi/${LIVE_ID}/hqdefault.jpg`,
    });
  });

  it('canonical apontando para o canal significa: não tem live', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ live: LIVE_SEM_TRANSMISSAO }) });
    expect(await provider.probeLive(SEM_LIVE)).toBeNull();
  });

  it('agendada não é live: fica em espera e não vira item', async () => {
    // A página traz `"isLive":true` também (ver o teste de `parseWatchState`),
    // então o `null` aqui só sai porque `isUpcoming` é checado junto.
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ live: WATCH_AGENDADA }) });
    expect(await provider.probeLive(CANAL)).toBeNull();
  });

  it('canonical ausente é falha, não "sem live" — a conta precisa alertar', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ live: LIVE_SEM_CANONICAL }) });
    await expect(provider.probeLive(CANAL)).rejects.toThrow(/mudou de formato/);
  });

  it('canonical que não é nem watch nem canal, e sem ID no JSON, também alerta', async () => {
    // Só `/channel/UC…` autoriza o silêncio. Qualquer outra forma é página
    // nova, e ficar quieto aí é justamente o bug que se está consertando.
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({
        live: LIVE_EM_ANDAMENTO_SEM_METADADOS.replace(/"currentVideoEndpoint":\{[\s\S]*?\}\},/, ''),
      }),
    });
    await expect(provider.probeLive(CANAL)).rejects.toThrow(/mudou de formato/);
  });

  it('quando a live está no feed, título e capa vêm de lá', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ live: LIVE_EM_ANDAMENTO }) });
    const entries = parseYouTubeFeed(FEED_COM_LIVE);
    const item = await provider.probeLive(LOFI, entries);

    expect(item?.thumbnail).toBe('https://i4.ytimg.com/vi/rFZHOHl-L8A/hqdefault_live.jpg');
    expect(item?.publishedAt?.toISOString()).toBe('2026-09-08T09:00:00.000Z');
  });
});

describe('YouTubeProvider.fetchLatest', () => {
  it('classifica short e vídeo pelo HEAD em /shorts/<id>', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({ shorts: ['bbbbbbbbbbb'], watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED } }),
    });
    const items = await provider.fetchLatest(account());

    expect(items.map((item) => [item.externalId, item.kind])).toEqual([
      ['aaaaaaaaaaa', 'video'],
      ['bbbbbbbbbbb', 'short'],
    ]);
    // O link do short é o da rota /shorts, que é como o Discord dá o preview.
    expect(items[1]?.url).toBe('https://www.youtube.com/shorts/bbbbbbbbbbb');
    expect(items[0]?.headline).toBe('publicou um vídeo novo');
    expect(items[1]?.headline).toBe('publicou um short');
  });

  it('devolve só os tipos que a conta pediu', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({ shorts: ['bbbbbbbbbbb'], watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED } }),
    });
    const items = await provider.fetchLatest(account({ kinds: ['short'] }));

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('short');
  });

  it('ID já anunciado não custa nem uma requisição de classificação', async () => {
    const fetchMock = fakeYouTube({
      shorts: ['bbbbbbbbbbb'],
      watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED },
    });
    const provider = new YouTubeProvider({ fetch: fetchMock });

    const items = await provider.fetchLatest(
      account({ isKnown: (id) => Promise.resolve(id === 'aaaaaaaaaaa') }),
    );

    expect(items.map((item) => item.externalId)).toEqual(['bbbbbbbbbbb']);
    expect(calls(fetchMock)).toEqual([
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv',
      'https://www.youtube.com/shorts/bbbbbbbbbbb',
    ]);
  });

  it('a live da sonda que também está no feed aparece uma vez só', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({
        feed: FEED_COM_LIVE,
        live: LIVE_EM_ANDAMENTO,
        shorts: ['bbbbbbbbbbb'],
        watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED },
      }),
    });
    const items = await provider.fetchLatest(account({ kinds: ['video', 'short', 'live'] }));

    expect(items.map((item) => [item.externalId, item.kind])).toEqual([
      // A live vem na frente: é a publicação mais recente por definição.
      ['rFZHOHl-L8A', 'live'],
      ['aaaaaaaaaaa', 'video'],
      ['bbbbbbbbbbb', 'short'],
    ]);
  });

  it('a agendada some do resultado e não é reservada', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({
        feed: FEED.replace('aaaaaaaaaaa', 'ccccccccccc').replace('aaaaaaaaaaa', 'ccccccccccc'),
        watch: { ccccccccccc: WATCH_AGENDADA },
        shorts: ['bbbbbbbbbbb'],
      }),
    });
    const items = await provider.fetchLatest(account({ kinds: ['video', 'short', 'live'] }));

    expect(items.map((item) => item.externalId)).toEqual(['bbbbbbbbbbb']);
  });

  it('conta que só quer live não baixa o feed', async () => {
    const fetchMock = fakeYouTube({ live: LIVE_EM_ANDAMENTO });
    await new YouTubeProvider({ fetch: fetchMock }).fetchLatest(account({ kinds: ['live'] }));

    expect(calls(fetchMock)).toEqual([`https://www.youtube.com/channel/${CANAL}/live`]);
  });

  it('não existe mais chamada à Data API, com ou sem chave', async () => {
    const fetchMock = fakeYouTube({
      live: LIVE_EM_ANDAMENTO,
      watch: { aaaaaaaaaaa: WATCH_VIDEO_DO_FEED },
    });
    await new YouTubeProvider({ fetch: fetchMock }).fetchLatest(
      account({ kinds: ['video', 'short', 'live'] }),
    );

    expect(calls(fetchMock).some((url) => url.includes('googleapis'))).toBe(false);
  });
});

describe('YouTubeProvider.resolveChannel', () => {
  it('resolve um @handle para UC…, nome e avatar', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({ pages: { '/@LofiGirl': CANAL_POR_HANDLE } }),
    });

    expect(await provider.resolveChannel('https://www.youtube.com/@LofiGirl')).toEqual({
      channelId: LOFI,
      title: 'Lofi Girl',
      handle: '@LofiGirl',
      avatarUrl: AVATAR,
    });
  });

  it('aceita as URLs legadas /c/ e /user/', async () => {
    const provider = new YouTubeProvider({
      fetch: fakeYouTube({
        pages: { '/c/LofiGirl': CANAL_POR_HANDLE, '/user/LofiGirl': CANAL_SEM_HANDLE },
      }),
    });

    expect((await provider.resolveChannel('youtube.com/c/LofiGirl')).channelId).toBe(LOFI);
    expect((await provider.resolveChannel('youtube.com/user/LofiGirl')).channelId).toBe(CANAL);
  });

  it('um UC… é confirmado pelo feed, sem baixar a página do canal', async () => {
    const fetchMock = fakeYouTube();
    const provider = new YouTubeProvider({ fetch: fetchMock });

    expect(await provider.resolveChannel(CANAL)).toEqual({
      channelId: CANAL,
      title: 'Canal de Teste',
      handle: null,
      avatarUrl: null,
    });
    expect(calls(fetchMock)).toEqual([
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CANAL}`,
    ]);
  });

  it('UC… que o feed não conhece é recusado com mensagem legível', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube({ feedStatus: 404 }) });
    await expect(provider.resolveChannel(CANAL)).rejects.toThrow(
      'Não encontrei esse canal no YouTube.',
    );
  });

  it('handle inexistente é recusado sem criar nada', async () => {
    const provider = new YouTubeProvider({ fetch: fakeYouTube() });
    await expect(provider.resolveChannel('@naoexiste-xyz')).rejects.toThrow(
      'Não encontrei esse canal no YouTube.',
    );
  });

  it('entrada que não é do YouTube nem chega a virar requisição', async () => {
    const fetchMock = fakeYouTube();
    const provider = new YouTubeProvider({ fetch: fetchMock });

    await expect(provider.resolveChannel('https://www.twitch.tv/lofigirl')).rejects.toThrow(
      'Não encontrei esse canal no YouTube.',
    );
    expect(calls(fetchMock)).toEqual([]);
  });
});
