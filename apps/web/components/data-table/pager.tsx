import Link from 'next/link';

/**
 * §6.3 — paginação de tabela paginada no servidor. Os botões são links de
 * verdade (e não `router.push`) para a URL continuar sendo o estado da tela:
 * dá para abrir a página 3 em outra aba.
 */
export function Pager({
  basePath,
  query,
  page,
  pageCount,
  total,
}: {
  basePath: string;
  /** Query atual **sem** o `page`; o componente escreve o dele. */
  query: URLSearchParams;
  page: number;
  pageCount: number;
  total: number;
}) {
  const href = (target: number) => {
    const next = new URLSearchParams(query);
    if (target > 1) next.set('page', String(target));
    else next.delete('page');
    const search = next.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="screen-meta">
        PÁGINA {page}/{pageCount} · {total} REGISTRO{total === 1 ? '' : 'S'}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="icon-btn">
            {'< ANTERIOR'}
          </Link>
        ) : (
          <span className="icon-btn opacity-40">{'< ANTERIOR'}</span>
        )}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="icon-btn">
            {'PRÓXIMA >'}
          </Link>
        ) : (
          <span className="icon-btn opacity-40">{'PRÓXIMA >'}</span>
        )}
      </div>
    </div>
  );
}
