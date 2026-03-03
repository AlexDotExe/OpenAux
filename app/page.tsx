import { QrScanner } from '@/components/QrScanner';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">🎵 OpenAux</h1>
        <p className="text-gray-400 text-lg">Virtual DJ — powered by the crowd</p>
        <p className="text-gray-500 text-sm">
          Scan the QR code at your venue to join the session, request songs, and vote on the queue.
        </p>
        <div className="pt-4">
          <QrScanner />
        </div>
      </div>
    </main>
  );
}
