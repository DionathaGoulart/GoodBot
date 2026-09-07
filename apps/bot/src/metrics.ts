/**
 * Métricas do processo em formato Prometheus, sem cliente Prometheus.
 *
 * O que existe aqui cabe em três estruturas — contador, gauge e um resumo de
 * latência com reservatório fixo. Nada disso justifica arrastar `prom-client`
 * (≈ 400 KB e um registro global) para uma VM de 1 GB (PRD §7.2); e como não
 * há Prometheus rodando ainda, o consumidor de hoje é `curl` e o card "Saúde"
 * do painel (PRD §11).
 *
 * Tudo é em memória e some no restart: são métricas operacionais, não dados.
 */

/** Amostras guardadas por série de latência — o suficiente para p50/p95. */
const SAMPLE_CAPACITY = 512;

/**
 * Teto de séries distintas por métrica. A API é pública e o label de rota sai
 * do caminho pedido: sem este teto, quem chamasse `/aaa`, `/aab`… criaria uma
 * série nova a cada requisição, e cada série de latência custa 512 números
 * num container de 384 MB. Passado o teto, a série nova é descartada — perder
 * a métrica de uma rota inexistente não custa nada.
 */
const MAX_SERIES = 256;

type Labels = Record<string, string>;

interface Series {
  labels: Labels;
  value: number;
}

/** Chave estável para um conjunto de labels (ordem alfabética). */
function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${labels[name] ?? ''}`)
    .join(',');
}

/** Escapa o valor de uma label conforme o formato de exposição. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const body = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}="${escapeLabel(value)}"`)
    .join(',');
  return `{${body}}`;
}

class Counter {
  private readonly series = new Map<string, Series>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    const current = this.series.get(key);
    if (current) current.value += by;
    else if (this.series.size < MAX_SERIES) this.series.set(key, { labels, value: by });
  }

  /** Soma de todas as séries — o que o painel mostra sem detalhar labels. */
  total(): number {
    let sum = 0;
    for (const series of this.series.values()) sum += series.value;
    return sum;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.series.size === 0) return [...lines, `${this.name} 0`];
    for (const series of this.series.values()) {
      lines.push(`${this.name}${renderLabels(series.labels)} ${series.value}`);
    }
    return lines;
  }
}

class Gauge {
  private readonly readers: { labels: Labels; read: () => number }[] = [];

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  /** O valor é lido na hora do scrape: nada precisa empurrar atualização. */
  register(read: () => number, labels: Labels = {}): void {
    this.readers.push({ labels, read });
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const reader of this.readers) {
      let value: number;
      try {
        value = reader.read();
      } catch {
        // Um gauge que explode não pode derrubar o scrape inteiro.
        continue;
      }
      if (!Number.isFinite(value)) continue;
      lines.push(`${this.name}${renderLabels(reader.labels)} ${value}`);
    }
    return lines;
  }
}

/**
 * Resumo de latência: guarda as últimas `SAMPLE_CAPACITY` amostras num buffer
 * circular e calcula p50/p95 no scrape. Um histograma de verdade exigiria
 * escolher buckets sem saber ainda como é a distribuição.
 */
class Summary {
  private readonly buffers = new Map<string, { labels: Labels; samples: number[]; next: number }>();
  private readonly sums = new Map<string, number>();
  private readonly counts = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      if (this.buffers.size >= MAX_SERIES) return;
      buffer = { labels, samples: [], next: 0 };
      this.buffers.set(key, buffer);
    }
    if (buffer.samples.length < SAMPLE_CAPACITY) buffer.samples.push(value);
    else {
      buffer.samples[buffer.next] = value;
      buffer.next = (buffer.next + 1) % SAMPLE_CAPACITY;
    }
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Percentil das amostras vivas; `null` quando ainda não houve nenhuma. */
  quantile(q: number, labels: Labels = {}): number | null {
    const buffer = this.buffers.get(labelKey(labels));
    if (!buffer || buffer.samples.length === 0) return null;
    const sorted = [...buffer.samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
    return sorted[Math.max(0, index)] ?? null;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} summary`];
    for (const [key, buffer] of this.buffers) {
      for (const q of [0.5, 0.95]) {
        const value = this.quantile(q, buffer.labels);
        if (value === null) continue;
        lines.push(
          `${this.name}${renderLabels({ ...buffer.labels, quantile: String(q) })} ${value}`,
        );
      }
      lines.push(`${this.name}_sum${renderLabels(buffer.labels)} ${this.sums.get(key) ?? 0}`);
      lines.push(`${this.name}_count${renderLabels(buffer.labels)} ${this.counts.get(key) ?? 0}`);
    }
    return lines;
  }
}

export const metrics = {
  events: new Counter('cobot_events_total', 'Eventos do gateway processados, por tipo.'),
  commands: new Counter('cobot_commands_total', 'Comandos executados até o fim, por nome.'),
  errors: new Counter('cobot_errors_total', 'Erros não tratados, por escopo.'),
  apiRequests: new Counter('cobot_api_requests_total', 'Requisições à API interna, por status.'),
  apiUnauthorized: new Counter(
    'cobot_api_unauthorized_total',
    'Respostas 401 da API interna (alguém sondando o token).',
  ),
  automodHits: new Counter('cobot_automod_hits_total', 'Acionamentos de regra de automod.'),
  apiLatency: new Summary('cobot_api_duration_ms', 'Latência da API interna, em ms.'),
  dbLatency: new Summary('cobot_db_duration_ms', 'Latência do Postgres gerenciado, em ms.'),
  queue: new Gauge('cobot_queue_size', 'Itens represados em cada fila do bot.'),
  process: new Gauge('cobot_process', 'Métricas do processo (memória, uptime).'),
  gateway: new Gauge('cobot_gateway', 'Estado do gateway do Discord.'),
};

export type Metrics = typeof metrics;

/** Corpo de `GET /metrics`, no formato de exposição de texto do Prometheus. */
export function renderMetrics(registry: Metrics = metrics): string {
  const blocks = [
    registry.events,
    registry.commands,
    registry.errors,
    registry.apiRequests,
    registry.apiUnauthorized,
    registry.automodHits,
    registry.apiLatency,
    registry.dbLatency,
    registry.queue,
    registry.process,
    registry.gateway,
  ];
  return `${blocks.flatMap((block) => block.render()).join('\n')}\n`;
}

export { Counter, Gauge, Summary };
