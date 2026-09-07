import { Hono } from 'hono';

import { renderMetrics } from '../../metrics';

import type { ApiEnv } from '../context';

/**
 * `GET /metrics` no formato de exposição do Prometheus (PRD §11).
 *
 * Fica **atrás do Bearer** como todo o resto: a API é pública desde a v1.1, e
 * contadores de erro e latência dizem mais sobre o servidor do que deveriam
 * dizer a um estranho. Não há Prometheus rodando ainda — hoje quem lê é o
 * `curl` do runbook e o card "Saúde" do painel.
 */
export function createMetricsRoutes(): Hono<ApiEnv> {
  return new Hono<ApiEnv>().get('/', (c) =>
    c.text(renderMetrics(), 200, {
      // `version=0.0.4` é o que os scrapers esperam do formato de texto.
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    }),
  );
}
