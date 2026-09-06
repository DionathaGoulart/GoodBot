import { cn } from 'cn';

/** §6.9 — avatar quadrado; sem foto vira fill accent com a inicial. */
export function AvatarSq({
  src,
  name,
  size = 32,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initial = name.trim().charAt(0) || '?';

  return (
    <span
      className={cn('avatar-sq', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {src ? (
        // Avatares do Discord são servidos pelo CDN deles; `next/image` exigiria
        // liberar o host e não traz ganho num quadrado de 32px.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="size-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}
