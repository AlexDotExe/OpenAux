'use client';

/**
 * Patron main queue screen: Now Playing (+ DJ attribution), Up Next (top 3)
 * + randomized rest, song search/request, vote buttons with optimistic
 * updates, my-song monetization card(s), and announcement banners.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type { QueueSnapshot, VoteDirection } from '@openaux/shared';

import { ApiClientError, getApiClient, type AuthContext } from '../../../lib/api';
import {
  applyOptimisticVoteDelta,
  collectMyItems,
  mapSnapshotItem,
} from '../../../lib/queueSnapshotHelpers';
import {
  clearPatronSession,
  loadPatronSession,
  type StoredPatronSession,
} from '../../../lib/session';
import { useVenueChannel } from '../../../lib/useVenueChannel';
import { AnnouncementBanner } from '../../../components/patron/AnnouncementBanner';
import { MySongCard } from '../../../components/patron/MySongCard';
import { NowPlayingCard } from '../../../components/patron/NowPlayingCard';
import { QueueLists } from '../../../components/patron/QueueLists';
import { RequestSongPanel } from '../../../components/patron/RequestSongPanel';

export default function PatronQueuePage() {
  const params = useParams<{ venueId: string }>();
  const venueId = params.venueId;
  const router = useRouter();

  const [session, setSession] = useState<StoredPatronSession | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, VoteDirection>>({});
  const [voteError, setVoteError] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const channel = useVenueChannel(venueId ?? null);

  useEffect(() => {
    if (!venueId) return;
    setSession(loadPatronSession(venueId) ?? null);
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    getApiClient()
      .getQueue(venueId)
      .then(setSnapshot)
      .catch(() => {
        /* the realtime channel will fill this in once it connects */
      });
  }, [venueId]);

  useEffect(() => {
    if (channel.queue) {
      setSnapshot(channel.queue);
      setRefreshToken((n) => n + 1);
    }
  }, [channel.queue]);

  const auth: AuthContext = { sessionId: session?.sessionId };

  const handleToggleVote = useCallback(
    async (queueItemId: string, direction: VoteDirection) => {
      if (!session) return;
      const previous = myVotes[queueItemId] ?? null;
      const next = previous === direction ? null : direction;

      setVoteError(null);
      setSnapshot((prev) =>
        prev
          ? mapSnapshotItem(prev, queueItemId, (item) =>
              applyOptimisticVoteDelta(item, previous, next),
            )
          : prev,
      );
      setMyVotes((prev) => {
        const copy = { ...prev };
        if (next) copy[queueItemId] = next;
        else delete copy[queueItemId];
        return copy;
      });

      try {
        const res = next
          ? await getApiClient().castVote(queueItemId, { direction: next }, auth)
          : await getApiClient().removeVote(queueItemId, auth);
        setSnapshot((prev) =>
          prev ? mapSnapshotItem(prev, queueItemId, () => res.queueItem) : prev,
        );
      } catch (e) {
        // Revert the optimistic change.
        setSnapshot((prev) =>
          prev
            ? mapSnapshotItem(prev, queueItemId, (item) =>
                applyOptimisticVoteDelta(item, next, previous),
              )
            : prev,
        );
        setMyVotes((prev) => {
          const copy = { ...prev };
          if (previous) copy[queueItemId] = previous;
          else delete copy[queueItemId];
          return copy;
        });
        setVoteError(e instanceof ApiClientError ? e.message : 'Vote failed — try again.');
      }
    },
    [myVotes, session, auth],
  );

  if (session === undefined) {
    return <main className="page">Loading…</main>;
  }

  if (!session) {
    return (
      <main className="page stack">
        <div className="top-bar">
          <h1>No active session</h1>
        </div>
        <p className="helper-text">Scan this venue&rsquo;s QR code, or join with its code.</p>
        <Link className="btn btn-primary" href="/patron/join">
          Join a venue
        </Link>
      </main>
    );
  }

  const nowPlayingItem = channel.nowPlaying?.queueItem ?? snapshot?.nowPlaying ?? null;
  const djAttribution = channel.nowPlaying ? channel.nowPlaying.djAttribution : null;
  const myItems = collectMyItems(snapshot, session.userId);

  return (
    <main className="page stack">
      <div className="top-bar">
        <div>
          <h1>{session.venueName}</h1>
          <p className="helper-text">
            <span className={`badge-dot${channel.connectionState === 'open' ? ' is-live' : ''}`} />{' '}
            Live queue
            {creditBalance !== null
              ? ` · ${creditBalance} credit${creditBalance === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => {
            clearPatronSession(venueId);
            router.push('/patron/join');
          }}
        >
          Leave
        </button>
      </div>

      <AnnouncementBanner
        announcements={channel.announcements}
        onDismiss={channel.dismissAnnouncement}
      />

      {channel.sessionExpired && (
        <div className="banner banner--venue_message">
          Your session expired — <Link href="/patron/join">rejoin</Link> to keep voting.
        </div>
      )}

      <NowPlayingCard queueItem={nowPlayingItem} djAttribution={djAttribution} />

      {myItems.map((item) => (
        <MySongCard
          key={item.queueItemId}
          item={item}
          auth={auth}
          refreshToken={refreshToken}
          onBoosted={setCreditBalance}
        />
      ))}

      <div>
        <div className="section-title">Request a song</div>
        <RequestSongPanel
          venueId={venueId}
          auth={auth}
          onRequested={() => setRefreshToken((n) => n + 1)}
        />
      </div>

      {voteError && <p className="error-text">{voteError}</p>}

      <QueueLists
        upNext={snapshot?.upNext ?? []}
        rest={snapshot?.rest ?? []}
        myUserId={session.userId}
        myVotes={myVotes}
        onToggleVote={handleToggleVote}
      />
    </main>
  );
}
