/**
 * Recortes das páginas públicas do YouTube que o provider lê. São **recortes**
 * de propósito: a página real de um `watch` passa de 1,2 MB e o que o parser
 * olha cabe em vinte linhas. Cada bloco mantém a forma original — mesma ordem
 * de atributos, mesmas aspas, mesmo JSON compactado do
 * `ytInitialPlayerResponse` — porque é exatamente essa forma que o teste
 * existe para vigiar.
 *
 * Colhidos com `curl` em 2026-09-08, com o mesmo `User-Agent`, cookie
 * `SOCS=CAI` e `Accept-Language` que o provider manda. O que se aprendeu
 * colhendo, e que o parser depende:
 *
 * · `watch?v=` e a página de canal servem `og:title`/`og:image`;
 * · **`/channel/<id>/live` não serve `og:` nenhum** — ali o título só existe
 *   em `<meta name="title">` e no `videoDetails` do player, e não há capa.
 *
 * Os dois recortes com `SEM_METADADOS` no nome foram colhidos depois, em
 * 2026-09-11, do mesmo jeito: o YouTube passou a servir o `watch` sem `og:`,
 * sem `videoDetails` e com `canonical="undefined"`. Eles ficam **ao lado** dos
 * antigos, e não no lugar deles, porque as duas formas seguem no ar e o parser
 * tem de aguentar as duas.
 */

/**
 * Feed Atom de uploads. Sintético — o formato é o do feed real, com os casos
 * de entidade (`&amp;`, `&#186;`) que o parser precisa decodificar.
 */
export const FEED = `<?xml version="1.0" encoding="UTF-8"?>
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

/**
 * O mesmo feed com a transmissão em andamento na frente. O caso real: a live
 * **aparece** no RSS, com o mesmo `videoId` do canonical de `/live`.
 */
export const FEED_COM_LIVE = FEED.replace(
  '  <entry>\n    <id>yt:video:aaaaaaaaaaa</id>',
  `  <entry>
    <id>yt:video:rFZHOHl-L8A</id>
    <yt:videoId>rFZHOHl-L8A</yt:videoId>
    <title>lofi hip hop radio 📚 beats to relax/study to</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=rFZHOHl-L8A"/>
    <author><name>Canal de Teste</name></author>
    <published>2026-09-08T09:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i4.ytimg.com/vi/rFZHOHl-L8A/hqdefault_live.jpg" width="480" height="360"/>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:aaaaaaaaaaa</id>`,
);

/**
 * `GET /channel/UCSJ4gkVC6NrvII8umztf0Ow/live` com a Lofi Girl transmitindo.
 * Recorte real. Repare no que **não** está aqui: nenhuma tag `og:`. É por isso
 * que `parseWatchState` procura o título em três lugares.
 */
export const LIVE_EM_ANDAMENTO = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=rFZHOHl-L8A">
<meta name="theme-color" content="rgba(255, 255, 255, 0.98)">
<meta name="title" content="lofi hip hop radio 📚 beats to relax/study to">
<meta name="description" content="🎼 | Listen on Spotify, Apple music and more→  https://lnk.to/lofi-hiphop-beats-to-r...">
<title>lofi hip hop radio 📚 beats to relax/study to - YouTube</title>
<script nonce="Y2Y0Y2M">var ytInitialPlayerResponse = {"responseContext":{},"playabilityStatus":{"status":"OK","playableInEmbed":true},"videoDetails":{"videoId":"rFZHOHl-L8A","title":"lofi hip hop radio 📚 beats to relax/study to","lengthSeconds":"0","isLive":true,"keywords":["lo-fi","lofi","lofi hip hop radio"],"channelId":"UCSJ4gkVC6NrvII8umztf0Ow","isOwnerViewing":false,"shortDescription":"🎼 | Listen on Spotify","isCrawlable":true,"allowRatings":true,"viewCount":"41236","author":"Lofi Girl","isLowLatencyLiveStream":false,"isPrivate":false,"isUnpluggedCorpus":false,"latencyClass":"MDE_STREAM_OPTIMIZATIONS_RENDERER_LATENCY_NORMAL","isLiveContent":true,"isTvfilmVideo":false}};</script>
</head><body></body></html>`;

/**
 * A **mesma** rota `/channel/UCSJ4gkVC6NrvII8umztf0Ow/live`, colhida em
 * 2026-09-11: o formato que o YouTube passou a servir a quem não roda JS.
 * Recorte real, e o que sumiu é o que importa — nenhuma tag `og:`,
 * `<meta name="title">` **vazio**, nenhum `videoDetails` no
 * `ytInitialPlayerResponse` e, sobretudo, `canonical` literalmente
 * `"undefined"`. Foi esse canonical que fez a sonda ler "não tem live" com a
 * transmissão no ar.
 *
 * O que sobrou, e de onde o parser passa a tirar tudo: o `ytInitialData`, com
 * `currentVideoEndpoint` (o ID), `videoPrimaryInfoRenderer` (título e o
 * `"isLive":true` do contador) e `videoOwnerRenderer` (o autor).
 */
export const LIVE_EM_ANDAMENTO_SEM_METADADOS = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="undefined">
<meta name="theme-color" content="rgba(255, 255, 255, 0.98)">
<meta name="title" content="">
<meta name="description" content="Aproveite vídeos e músicas que você ama, envie e compartilhe conteúdo original com amigos, parentes e o mundo no YouTube.">
<title> - YouTube</title>
<script nonce="Y2Y0Y2M">var ytInitialPlayerResponse = {"responseContext":{"serviceTrackingParams":[{"service":"GFEEDBACK","params":[{"key":"is_viewed_live","value":"True"}]}]}};</script>
<script nonce="Y2Y0Y2M">var ytInitialData = {"currentVideoEndpoint":{"clickTrackingParams":"CAAQg2ciEwiTlufFn-eWAxWZSt0CHQpkDk_KAQR3bKE2","commandMetadata":{"webCommandMetadata":{"url":"/watch?v=rFZHOHl-L8A","webPageType":"WEB_PAGE_TYPE_WATCH","rootVe":3832}}},"contents":{"twoColumnWatchNextResults":{"results":{"results":{"contents":[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":"lofi hip hop radio 📚 beats to relax/study to"}]},"viewCount":{"videoViewCountRenderer":{"viewCount":{"runs":[{"text":"17.924"},{"text":" assistindo agora"}]},"isLive":true,"originalViewCount":"17924"}}}},{"videoSecondaryInfoRenderer":{"owner":{"videoOwnerRenderer":{"thumbnail":{"thumbnails":[{"url":"https://yt3.ggpht.com/_BSh2VVvVMzqBoKyWbQnyC35XFOV-ZbXavf9nfu3ZjpFUGEImQnlWt9ZlpfGQBqWEbGNc4rPWg=s48-c-k-c0x00ffffff-no-rj","width":48,"height":48}]},"title":{"runs":[{"text":"Lofi Girl","navigationEndpoint":{"commandMetadata":{"webCommandMetadata":{"url":"/channel/UCSJ4gkVC6NrvII8umztf0Ow"}}}}]}}}}}]}}}}};</script>
</head><body></body></html>`;

/**
 * `GET watch?v=` de um **vídeo comum** no mesmo formato sem metadados, colhido
 * no mesmo dia. Serve para provar o contrário do de cima: sem transmissão, a
 * página não tem `"isLive":true` nenhuma vez, e portanto nada aqui pode ser
 * confundido com uma live.
 */
export const WATCH_VIDEO_SEM_METADADOS = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="undefined">
<meta name="title" content="">
<title> - YouTube</title>
<script nonce="Y2Y0Y2M">var ytInitialData = {"currentVideoEndpoint":{"clickTrackingParams":"CAAQg2ciEwjV5rSdn-eWAxXRad0CHRk8Bg4","commandMetadata":{"webCommandMetadata":{"url":"/watch?v=aaaaaaaaaaa","webPageType":"WEB_PAGE_TYPE_WATCH","rootVe":3832}}},"contents":{"twoColumnWatchNextResults":{"results":{"results":{"contents":[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":"Café & código: o vídeo nº 3"}]},"viewCount":{"videoViewCountRenderer":{"viewCount":{"simpleText":"1.204 visualizações"},"isLive":false}}}}]}}}}};</script>
</head><body></body></html>`;

/**
 * `GET /channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/live` de um canal que **não** está
 * transmitindo: `200`, canonical apontando de volta para o canal, nenhum
 * `"isLive"`. Recorte real.
 */
export const LIVE_SEM_TRANSMISSAO = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw">
<meta property="og:title" content="Google for Developers">
<meta property="og:image" content="https://yt3.googleusercontent.com/Jrfy3VrP1QDikidneCoruk9MmhsQsEAgeQSELZtL2fn1pKxCjh2ohk7derV33UpetVZwt-DuRQ=s900-c-k-c0x00ffffff-no-rj">
<script nonce="Y2Y0Y2M">var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"Google for Developers","externalId":"UC_x5XG1OV2P6uZZ5FSM9Ttw"}}};</script>
</head><body></body></html>`;

/** A mesma página, mas com o `<link rel="canonical">` fora do ar. */
export const LIVE_SEM_CANONICAL = LIVE_SEM_TRANSMISSAO.replace(/<link rel="canonical"[^>]*>\n/, '');

/**
 * `GET watch?v=jNQXAC9IVRw` de um vídeo comum. Recorte real — e aqui as tags
 * `og:` existem, ao contrário da rota `/live`.
 */
export const WATCH_VIDEO = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=jNQXAC9IVRw">
<meta name="title" content="Me at the zoo">
<meta property="og:title" content="Me at the zoo">
<meta property="og:image" content="https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg?sqp=-oaymwEmCOADEOgC8quKqQMa8AEB-AG-AoAC8AGKAgwIABABGFUgWShlMA8=&amp;rs=AOn4CLA9eLBatYv9WbkD4BbZ2Im-biSPTw">
<meta itemprop="duration" content="PT19S">
<script nonce="Y2Y0Y2M">var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"jNQXAC9IVRw","title":"Me at the zoo","lengthSeconds":"19","channelId":"UCX6OQ3DkcsbYNE6H8uQQuVA","isCrawlable":true,"allowRatings":true,"viewCount":"371284736","author":"jawed","isPrivate":false,"isUnpluggedCorpus":false,"isLiveContent":false}};</script>
</head><body></body></html>`;

/** O mesmo recorte, com o `videoId` trocado para casar com o `FEED` acima. */
export const WATCH_VIDEO_DO_FEED = WATCH_VIDEO.replaceAll('jNQXAC9IVRw', 'aaaaaaaaaaa');

/**
 * O VOD de uma transmissão que terminou. **Derivado** do recorte real da live:
 * `isLive` sai, a duração entra, `isLiveContent` fica. É a diferença exata que
 * faz o provider perguntar por `"isLive"` e não por `"isLiveContent"` — senão
 * a gravação seria anunciada como uma segunda transmissão.
 */
export const WATCH_VOD_DE_LIVE = LIVE_EM_ANDAMENTO.replace(
  '"lengthSeconds":"0","isLive":true,',
  '"lengthSeconds":"10868",',
);

/**
 * ⚠️ **Fixture sintética.** É o único estado que não foi colhido de uma página
 * real: não havia live agendada pública à mão em 2026-09-08. A forma copia a
 * do recorte real de `/live` (sem `og:`, título em `<meta name="title">` e no
 * `videoDetails`), trocando `"isLive":true` por `"isUpcoming":true`.
 * **Trocar por um recorte real na primeira oportunidade.**
 */
export const WATCH_AGENDADA = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="https://www.youtube.com/watch?v=ccccccccccc">
<meta name="title" content="Estreia de sábado">
<title>Estreia de sábado - YouTube</title>
<script nonce="Y2Y0Y2M">var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LIVE_STREAM_OFFLINE","reason":"A transmissão começa em breve","liveStreamability":{"liveStreamabilityRenderer":{"videoId":"ccccccccccc","pollDelayMs":"15000"}}},"videoDetails":{"videoId":"ccccccccccc","title":"Estreia de sábado","lengthSeconds":"0","isUpcoming":true,"channelId":"UCabcdefghijklmnopqrstuv","isCrawlable":true,"viewCount":"0","author":"Canal de Teste","isPrivate":false,"isLiveContent":true}};</script>
</head><body></body></html>`;

/** `GET /@LofiGirl`: o canonical já traz o `UC…`. Recorte real. */
export const CANAL_POR_HANDLE = `<!DOCTYPE html><html lang="pt-BR"><head>
<link rel="canonical" href="https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow">
<meta property="og:title" content="Lofi Girl">
<meta property="og:image" content="https://yt3.googleusercontent.com/_BSh2VVvVMzqBoKyWbQnyC35XFOV-ZbXavf9nfu3ZjpFUGEImQnlWt9ZlpfGQBqWEbGNc4rPWg=s900-c-k-c0x00ffffff-no-rj">
<meta property="og:url" content="https://www.youtube.com/@LofiGirl">
<script nonce="Y2Y0Y2M">var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"Lofi Girl","externalId":"UCSJ4gkVC6NrvII8umztf0Ow","vanityChannelUrl":"http://www.youtube.com/@LofiGirl"}},"header":{"pageHeaderRenderer":{"content":{"pageHeaderViewModel":{"image":{"decoratedAvatarViewModel":{"rendererContext":{"commandContext":{"onTap":{"innertubeCommand":{"browseEndpoint":{"browseId":"UCSJ4gkVC6NrvII8umztf0Ow","canonicalBaseUrl":"/@LofiGirl"}}}}}}}}}}}};</script>
</head><body></body></html>`;

/**
 * Canal alcançado por uma URL legada `/c/…`, sem `@handle` no JSON. Derivado
 * do recorte real acima, com o `canonicalBaseUrl` removido.
 */
export const CANAL_SEM_HANDLE = CANAL_POR_HANDLE.replace(',"canonicalBaseUrl":"/@LofiGirl"', '')
  .replaceAll('UCSJ4gkVC6NrvII8umztf0Ow', 'UCabcdefghijklmnopqrstuv')
  .replace('content="Lofi Girl"', 'content="Canal de Teste"');

/** Corpo de um `404` do YouTube. Nunca é parseado: só o status importa. */
export const PAGINA_404 = `<!DOCTYPE html><html lang="pt-BR"><head>
<title>404 Not Found</title>
</head><body><p>Esta página não está disponível.</p></body></html>`;
