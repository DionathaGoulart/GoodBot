/** `userId:comando` → timestamp em que o cooldown expira. */
export class CooldownStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Retorna os segundos restantes (0 = liberado) e marca o novo cooldown. */
  hit(userId: string, command: string, seconds: number): number {
    if (seconds <= 0) return 0;
    const key = `${userId}:${command}`;
    const expiresAt = this.entries.get(key);
    const now = this.now();
    if (expiresAt && expiresAt > now) return Math.ceil((expiresAt - now) / 1000);
    this.entries.set(key, now + seconds * 1000);
    return 0;
  }

  /** Remove entradas vencidas (chamado pelo sweeper do boot). */
  sweep(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
  }
}
