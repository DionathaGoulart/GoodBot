'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { groupLabelForPath, labelForPath } from './nav';

/**
 * §6.9 — micro-texto à esquerda da topbar: `SERVIDOR / GRUPO / SEÇÃO`. O
 * grupo é o mesmo da sidebar: quem chegou por link ou pelo `Ctrl+K` vê em que
 * gaveta a tela mora. Some abaixo de `sm`, onde a topbar não comporta três
 * níveis.
 */
export function Breadcrumbs({ guildId, guildName }: { guildId: string; guildName: string }) {
  const pathname = usePathname();
  const current = labelForPath(guildId, pathname);
  const group = groupLabelForPath(guildId, pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`/g/${guildId}`} prefetch={false}>
              {guildName}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {group ? (
          <>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem className="hidden sm:inline-flex">
              <span className="section-label">{group}</span>
            </BreadcrumbItem>
          </>
        ) : null}
        {current ? (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{current}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : null}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
