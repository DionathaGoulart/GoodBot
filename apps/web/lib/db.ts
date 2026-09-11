import 'server-only';

import { createDb } from '@goodbot/db';

import { env } from './env';

/**
 * Quantas conexões o painel abre por instância da Vercel.
 *
 * Já foi 1, com o raciocínio de que quem faz pool é o pooler do Supabase e não
 * nós. O raciocínio está certo para *capacidade* e errado para *concorrência*:
 * uma conexão só atende uma consulta por vez, e um render que dispare duas ao
 * mesmo tempo tem de empilhá-las na mesma.
 *
 * Empilhar é justamente o que o pooler em modo transação não suporta. O
 * postgres-js manda as consultas concorrentes emendadas na mesma conexão, e o
 * Supavisor, que empresta uma conexão de servidor por transação, não sabe
 * atender duas ao mesmo tempo: ninguém responde e ninguém falha. Medido contra
 * a produção, quatro consultas concorrentes numa conexão só ficaram penduradas
 * além de 15 s; com duas conexões as mesmas quatro voltaram em 139 ms.
 *
 * Era esse o carregamento infinito de quem estava logado: a função da Vercel
 * ficava presa até o teto dela e devolvia 504. O painel do dono nunca abria
 * porque a tela dele pede o registro e o uso **em paralelo**, então caía no
 * caso ruim toda vez; as telas comuns caíam quando o render pedia mais de uma
 * coisa ao mesmo tempo. Deslogado nada consulta o banco, e por isso tudo
 * parecia rápido.
 *
 * Cinco cobre o render mais paralelo do painel com folga e continua barato: em
 * modo transação a conexão de cliente é multiplexada, e com `idleTimeout` de
 * 10 s a instância devolve o que não está usando.
 */
const MAX_CONEXOES = 5;

// O singleton sobrevive ao HMR do dev, que reavalia o módulo a cada edição.
const globalForDb = globalThis as unknown as { goodbotDb?: ReturnType<typeof createDb> };

function connection() {
  globalForDb.goodbotDb ??= createDb(env().DATABASE_URL, {
    max: MAX_CONEXOES,
    idleTimeout: 10,
    // O painel **precisa** falar com o pooler em modo transação (porta 6543).
    // No modo sessão cada função da Vercel prende uma conexão de servidor
    // inteira, e o teto do pool (15, menos as 5 do bot) vira teto de requests
    // simultâneos: da décima primeira em diante cada uma espera os 10s do
    // `connect_timeout` antes de conseguir conectar. Em modo transação a
    // conexão é emprestada por query, mas prepared statement não sobrevive à
    // troca — por isso `prepare: false`.
    prepare: false,
  });
  return globalForDb.goodbotDb;
}

export function db() {
  return connection().db;
}
