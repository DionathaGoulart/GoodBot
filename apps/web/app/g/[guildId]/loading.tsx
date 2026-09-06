import { PageSkeleton } from '@/components/retro/states';

/** §8 — a casca da rota enquanto o server component ainda não respondeu. */
export default function Loading() {
  return <PageSkeleton rows={6} />;
}
