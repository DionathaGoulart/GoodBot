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

import { labelForPath } from './nav';

/** §6.9 — micro-texto à esquerda da topbar: `SERVIDOR / SEÇÃO`. */
export function Breadcrumbs({ guildId, guildName }: { guildId: string; guildName: string }) {
  const pathname = usePathname();
  const current = labelForPath(guildId, pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`/g/${guildId}`}>{guildName}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
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
