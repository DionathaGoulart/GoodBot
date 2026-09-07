import { describe, expect, it, vi } from 'vitest';

import { parseYouTubeFeed, YouTubeProvider } from './youtube';

/**
 * Recorte fiel de `youtube.com/feeds/videos.xml?channel_id=…`: mesmos
 * namespaces, mesma ordem de tags, mesma forma do `media:group`. Se o YouTube
 * mudar o formato, é este teste que avisa.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv"/>
  <id>yt:channel:UCabcdefghijklmnopqrstuv</id>
  <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
  <title>Canal de Teste</title>
  <author>
    <name>Canal de Teste</name>
    <uri>https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv</uri>
  </author>
  <published>2020-01-01T00:00:00+00:00</published>
  <entry>
    <id>yt:video:aaaaaaaaaaa</id>
    <yt:videoId>aaaaaaaaaaa</yt:videoId>
    <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
    <title>Café &amp; código: o vídeo n&#186; 3</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=aaaaaaaaaaa"/>
    <author>
      <name>Canal de Teste</name>
      <uri>https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv</uri>
    </author>
    <published>2026-09-06T18:30:00+00:00</published>
    <updated>2026-09-06T19:00:00+00:00</updated>
    <media:group>
      <media:title>Café &amp; código: o vídeo n&#186; 3</media:title>
      <media:content url="https://www.youtube.com/v/aaaaaaaaaaa?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
      <media:thumbnail url="https://i4.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" width="480" height="360"/>
      <media:description>Descrição qualquer.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:bbbbbbbbbbb</id>
    <yt:videoId>bbbbbbbbbbb</yt:videoId>
    <title>Um short</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=bbbbbbbbbbb"/>
    <author><name>Canal de Teste</name></author>
    <published>2026-09-05T10:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i4.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
</feed>`;

const ACCOUNT = {
  id: 'conta-1',
  platform: 'youtube' as const,
  externalId: 'UCabcdefghijklmnopqrstuv',
  kinds: ['video', 'short'] as const,
};

/** `fetch` de mentira: feed no RSS e 200/303 conforme o vídeo seja short. */
function fakeFetch(shorts: string[], feed = FEED) {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/feeds/videos.xml')) {
      return Promise.resolve(new Response(feed, { status: 200 }));
    }
    const videoId = url.split('/shorts/')[1] ?? '';
    // O YouTube responde 200 só quando a rota /shorts/<id> é mesmo um short;
    // caso contrário redireciona para o watch?v=.
    return Promise.resolve(
      new Response(null, { status: shorts.includes(videoId) ? 200 : 303 }),
    );
  }) as unknown as typeof globalThis.fetch;
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

describe('YouTubeProvider', () => {
  it('classifica short e vídeo pelo HEAD em /shorts/<id>', async () => {
    const provider = new YouTubeProvider({ fetch: fakeFetch(['bbbbbbbbbbb']) });
    const items = await provider.fetchLatest(ACCOUNT);

    expect(items.map((item) => [item.externalId, item.kind])).toEqual([
      ['aaaaaaaaaaa', 'video'],
      ['bbbbbbbbbbb', 'short'],
    ]);
    // O link do short é o da rota /shorts, que é como o Discord dá o preview.
    expect(items[1]?.url).toBe('https://www.youtube.com/shorts/bbbbbbbbbbb');
  });

  it('devolve só os tipos que a conta pediu', async () => {
    const provider = new YouTubeProvider({ fetch: fakeFetch(['bbbbbbbbbbb']) });
    const items = await provider.fetchLatest({ ...ACCOUNT, kinds: ['short'] });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('short');
  });

  it('trata falha na checagem de short como vídeo comum, sem perder o anúncio', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/feeds/videos.xml')) {
        return Promise.resolve(new Response(FEED, { status: 200 }));
      }
      return Promise.reject(new Error('rede fora'));
    }) as unknown as typeof globalThis.fetch;

    const items = await new YouTubeProvider({ fetch: fetchMock }).fetchLatest(ACCOUNT);
    expect(items.every((item) => item.kind === 'video')).toBe(true);
  });

  it('não consulta a Data API sem chave, e sem chave não há live', async () => {
    const fetchMock = fakeFetch([]);
    const items = await new YouTubeProvider({ fetch: fetchMock }).fetchLatest({
      ...ACCOUNT,
      kinds: ['live'],
    });

    expect(items).toEqual([]);
    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some(([url]) => String(url).includes('googleapis'))).toBe(false);
  });

  it('sem API key, live fica indisponível mas a plataforma continua utilizável', () => {
    const semChave = new YouTubeProvider();
    expect(semChave.unavailableReason()).toBeNull();
    expect(semChave.liveUnavailableReason()).toContain('YOUTUBE_API_KEY');
    expect(new YouTubeProvider({ apiKey: 'k' }).liveUnavailableReason()).toBeNull();
  });

  it('respeita o intervalo próprio de 15 min da busca de live (cota da API)', async () => {
    let agora = 0;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('googleapis')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(FEED, { status: 200 }));
    }) as unknown as typeof globalThis.fetch;

    const provider = new YouTubeProvider({ apiKey: 'k', fetch: fetchMock, now: () => agora });
    const account = { ...ACCOUNT, kinds: ['live'] as const };

    await provider.fetchLatest(account);
    agora += 60_000;
    await provider.fetchLatest(account);

    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const buscas = calls.filter(([url]) => String(url).includes('googleapis'));
    expect(buscas).toHaveLength(1);
  });
});
