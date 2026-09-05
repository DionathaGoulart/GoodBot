import { VERSION } from '@cobot/shared';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-3xl font-bold">CoBot</h1>
      <p className="font-mono text-sm">v{VERSION}</p>
    </main>
  );
}
