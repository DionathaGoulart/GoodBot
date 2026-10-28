import { expect } from 'vitest';

/** Evita a regressão de `rejects.toThrow` no ambiente web com Vitest 5.0.3. */
export async function expectErrorMessage(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(message);
}
