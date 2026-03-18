'use client';

/**
 * RefundPolicyNotice
 *
 * Shown to users who have one or more boosted songs in the current queue.
 * Communicates the refund policy clearly: if a paid-boost song is not played
 * (session ends, song is skipped, or admin removes it), the user receives a
 * full refund to their original payment method and a note is recorded on their
 * profile score.
 */

interface Props {
  /** Number of boosted songs the current user has in the queue */
  boostedSongCount: number;
}

export function RefundPolicyNotice({ boostedSongCount }: Props) {
  if (boostedSongCount === 0) return null;

  return (
    <div
      role="note"
      aria-label="Boost refund policy"
      className="flex items-start gap-3 rounded-xl border border-yellow-600/40 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200"
    >
      <span className="mt-0.5 text-lg leading-none" aria-hidden="true">
        💳
      </span>
      <div className="space-y-1">
        <p className="font-semibold">
          You have {boostedSongCount} boosted song{boostedSongCount > 1 ? 's' : ''} in the queue
        </p>
        <p className="text-yellow-300/80">
          If your boosted song isn&apos;t played — because the session ends, it&apos;s skipped, or
          removed — you&apos;ll receive a{' '}
          <span className="font-semibold text-yellow-200">full refund</span> to your original
          payment method automatically. Your listener score will still reflect the interaction.
        </p>
      </div>
    </div>
  );
}
