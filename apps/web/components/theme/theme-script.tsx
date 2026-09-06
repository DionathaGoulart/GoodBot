import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from './themes';

/**
 * Roda no `<head>`, antes da hidratação, para não haver flash (§0.2). Fica
 * inline de propósito: um arquivo externo já chegaria tarde demais. O `nonce`
 * é o mesmo da CSP montada no `middleware.ts`.
 */
export function ThemeScript({ nonce }: { nonce?: string }) {
  const script = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(${JSON.stringify(THEMES)}.indexOf(t)===-1){
t=window.matchMedia('(prefers-color-scheme: light)').matches?'crimson':${JSON.stringify(DEFAULT_THEME)};
}
document.documentElement.dataset.theme=t;
}catch(e){document.documentElement.dataset.theme=${JSON.stringify(DEFAULT_THEME)};}})();`;

  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
