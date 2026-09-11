/**
 * §6.7 — uma linha `accent` de 40px, sem eixo, sem grid e sem tooltip. É
 * enfeite informativo do stat tile: a forma importa, o valor está ao lado.
 *
 * SVG na mão, e não recharts, por dois motivos medidos. Peso: a biblioteca são
 * ~470 KB de JS, e quatro tiles do dashboard a carregavam só para desenhar uma
 * polilinha. Trabalho em tela: cada `ResponsiveContainer` monta um observador
 * de tamanho próprio, então o dashboard tinha sete deles vigiando layout ao
 * mesmo tempo. Aqui não há nenhum — o `viewBox` faz a escala, o navegador faz
 * o resto, e o componente nem precisa rodar no cliente.
 */
const LARGURA = 160;
const ALTURA = 40;
const RESPIRO = 2;

export function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;

  const menor = Math.min(...values);
  const maior = Math.max(...values);
  // Série constante tem amplitude zero; sem isto a divisão viraria `NaN` e a
  // linha sumiria. Com 1, todo ponto cai na base e ela fica reta lá embaixo —
  // que é o que um período sem movimento deve parecer.
  const amplitude = maior - menor || 1;
  const util = ALTURA - RESPIRO * 2;

  const pontos = values
    .map((valor, indice) => {
      const x = (indice / (values.length - 1)) * LARGURA;
      const y = ALTURA - RESPIRO - ((valor - menor) / amplitude) * util;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      aria-hidden
      className="block"
      width="100%"
      height={ALTURA}
      viewBox={`0 0 ${LARGURA} ${ALTURA}`}
      // A largura real varia com o tile, a altura não: sem `none` o SVG
      // manteria proporção e deixaria buraco nas pontas.
      preserveAspectRatio="none"
    >
      <polyline
        points={pontos}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        // A escala horizontal é desigual; sem isto o traço de 2px esticaria
        // junto e ficaria mais grosso em tile largo do que em tile estreito.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
