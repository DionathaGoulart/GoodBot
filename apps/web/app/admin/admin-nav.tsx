'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from 'cn';

const LINKS = [
  { href: '/admin', label: 'SAÚDE' },
  { href: '/admin/servidores', label: 'SERVIDORES' },
  { href: '/admin/fila', label: 'FILA' },
  { href: '/admin/manutencao', label: 'MANUTENÇÃO' },
] as const;

/**
 * A navegação do painel admin. Quatro telas cabem numa faixa — não vale uma
 * sidebar como a do painel comum, que existe para dezenas de seções por guild.
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Painel do dono" className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        // `/admin` é prefixo de todas: só ela compara por igualdade.
        const active = link.href === '/admin' ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn('icon-btn', active && 'bg-accent text-accent-content')}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
