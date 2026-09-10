import { describe, expect, it } from 'vitest';

import { Counter, Gauge, Summary, renderMetrics } from './metrics';

describe('Counter', () => {
  it('soma por conjunto de labels e expõe cada série', () => {
    const counter = new Counter('goodbot_x_total', 'ajuda');
    counter.inc({ tipo: 'a' });
    counter.inc({ tipo: 'a' });
    counter.inc({ tipo: 'b' }, 3);

    expect(counter.total()).toBe(5);
    const text = counter.render().join('\n');
    expect(text).toContain('goodbot_x_total{tipo="a"} 2');
    expect(text).toContain('goodbot_x_total{tipo="b"} 3');
  });

  it('sem série nenhuma ainda expõe o zero', () => {
    expect(new Counter('goodbot_y_total', 'ajuda').render()).toContain('goodbot_y_total 0');
  });

  it('escapa aspas no valor da label', () => {
    const counter = new Counter('goodbot_z_total', 'ajuda');
    counter.inc({ rota: 'a"b' });
    expect(counter.render().join('\n')).toContain('rota="a\\"b"');
  });
});

describe('Summary', () => {
  it('calcula p50 e p95 das amostras', () => {
    const summary = new Summary('goodbot_lat_ms', 'ajuda');
    for (let i = 1; i <= 100; i += 1) summary.observe(i);

    expect(summary.quantile(0.5)).toBe(50);
    expect(summary.quantile(0.95)).toBe(95);
    const text = summary.render().join('\n');
    expect(text).toContain('goodbot_lat_ms_count 100');
    expect(text).toContain('quantile="0.5"');
  });

  it('sem amostra não inventa percentil', () => {
    expect(new Summary('goodbot_vazio', 'ajuda').quantile(0.5)).toBeNull();
  });
});

describe('Gauge', () => {
  it('lê o valor na hora da renderização', () => {
    let value = 1;
    const gauge = new Gauge('goodbot_fila', 'ajuda');
    gauge.register(() => value, { fila: 'log' });

    expect(gauge.render().join('\n')).toContain('goodbot_fila{fila="log"} 1');
    value = 7;
    expect(gauge.render().join('\n')).toContain('goodbot_fila{fila="log"} 7');
  });

  it('um leitor que explode não derruba o scrape', () => {
    const gauge = new Gauge('goodbot_fila', 'ajuda');
    gauge.register(
      () => {
        throw new Error('x');
      },
      { fila: 'ruim' },
    );
    gauge.register(() => 2, { fila: 'boa' });

    const text = gauge.render().join('\n');
    expect(text).toContain('goodbot_fila{fila="boa"} 2');
    expect(text).not.toContain('ruim');
  });
});

describe('renderMetrics', () => {
  it('sai no formato de exposição, com HELP e TYPE e quebra final', () => {
    const text = renderMetrics();
    expect(text).toMatch(/^# HELP goodbot_events_total /);
    expect(text).toContain('# TYPE goodbot_api_duration_ms summary');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('teto de séries', () => {
  it('descarta séries novas depois do teto, sem perder as que já existem', () => {
    const counter = new Counter('goodbot_muitos_total', 'ajuda');
    for (let i = 0; i < 300; i += 1) counter.inc({ rota: `/r${String(i)}` });
    counter.inc({ rota: '/r0' });

    // 256 séries no máximo, e a primeira continua contando.
    expect(
      counter.render().filter((line) => line.startsWith('goodbot_muitos_total{')),
    ).toHaveLength(256);
    expect(counter.render().join('\n')).toContain('goodbot_muitos_total{rota="/r0"} 2');
  });

  it('o mesmo vale para o resumo de latência', () => {
    const summary = new Summary('goodbot_muitos_ms', 'ajuda');
    for (let i = 0; i < 300; i += 1) summary.observe(1, { rota: `/r${String(i)}` });
    expect(summary.quantile(0.5, { rota: '/r299' })).toBeNull();
    expect(summary.quantile(0.5, { rota: '/r0' })).toBe(1);
  });
});
