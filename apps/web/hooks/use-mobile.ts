import * as React from 'react';

/** A sidebar vira `sheet` abaixo deste ponto (styleguide §6.9). */
const MOBILE_BREAKPOINT = 1024;

const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * `useSyncExternalStore` em vez de `useState` + efeito: o media query é estado
 * externo, e assim não há render em cascata na montagem.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
