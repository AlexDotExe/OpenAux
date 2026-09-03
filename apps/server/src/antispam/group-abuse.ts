/**
 * Basic group-abuse detection (SPEC.md §5 V1, decision D10).
 *
 * D10 explicitly REJECTS social-graph detection. V1 ships ONLY the coarse
 * arrival-time signal: when a burst of patrons joins a venue within a short
 * window, that cluster is flagged as *possibly* coordinated. This is a soft
 * signal — it feeds the scoring spam term, it does NOT hard-block anyone.
 *
 * Deferred to V2 (do NOT build here): WiFi/BT proximity, social graph, and
 * correlated-voting detection.
 *
 * PURE + unit-tested. No I/O, no clock reads — arrivals are passed in.
 */

/** A patron join event: who joined and when. */
export interface JoinArrival {
  userId: string;
  joinedAt: Date;
}

export interface GroupAbuseConfig {
  /**
   * Window (ms) measured from the FIRST arrival of a cluster. Arrivals landing
   * within this span of the cluster's opener join the same cluster; the next
   * arrival outside it opens a new cluster. Default 60s.
   */
  arrivalWindowMs: number;
  /** A cluster of at least this many joins is flagged suspicious. Default 5. */
  minClusterSize: number;
  /** Spam signal contributed per suspicious cluster (feeds scoring). Default 1. */
  spamSignalPerCluster: number;
}

export const DEFAULT_GROUP_ABUSE_CONFIG: GroupAbuseConfig = {
  arrivalWindowMs: 60_000,
  minClusterSize: 5,
  spamSignalPerCluster: 1,
};

export interface SuspiciousCluster {
  userIds: string[];
  size: number;
  firstJoinAt: Date;
  lastJoinAt: Date;
}

/**
 * PURE. Groups arrivals into clusters anchored at each cluster's first join
 * (span-bounded, so a slow legitimate trickle does not chain into one giant
 * cluster), and returns only the clusters that meet `minClusterSize`.
 */
export function detectArrivalClusters(
  arrivals: readonly JoinArrival[],
  config: GroupAbuseConfig = DEFAULT_GROUP_ABUSE_CONFIG,
): SuspiciousCluster[] {
  const sorted = [...arrivals].sort(
    (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
  );

  const suspicious: SuspiciousCluster[] = [];
  let current: JoinArrival[] = [];

  const close = (): void => {
    const first = current[0];
    const last = current[current.length - 1];
    if (current.length >= config.minClusterSize && first && last) {
      suspicious.push({
        userIds: current.map((a) => a.userId),
        size: current.length,
        firstJoinAt: first.joinedAt,
        lastJoinAt: last.joinedAt,
      });
    }
  };

  for (const arrival of sorted) {
    const anchor = current[0];
    if (!anchor) {
      current = [arrival];
      continue;
    }
    if (arrival.joinedAt.getTime() - anchor.joinedAt.getTime() <= config.arrivalWindowMs) {
      current.push(arrival);
    } else {
      close();
      current = [arrival];
    }
  }
  close();

  return suspicious;
}

/** PURE. The set of user ids that fall inside any suspicious arrival cluster. */
export function flagClusteredUserIds(
  arrivals: readonly JoinArrival[],
  config: GroupAbuseConfig = DEFAULT_GROUP_ABUSE_CONFIG,
): Set<string> {
  const ids = new Set<string>();
  for (const cluster of detectArrivalClusters(arrivals, config)) {
    for (const userId of cluster.userIds) ids.add(userId);
  }
  return ids;
}

/**
 * PURE. Spam signal for a queue item, derived from its supporters' arrival
 * times: one `spamSignalPerCluster` per suspicious cluster found among the
 * supporters. WS3 adds this to the item's spam term (V0 FrictionScore.spamPenalty
 * or V1 `spam`) so coordinated-arrival groups get softly down-weighted while the
 * broader crowd can still override. Returns 0 when no cluster is found.
 */
export function computeGroupArrivalSpamSignal(
  supporterArrivals: readonly JoinArrival[],
  config: GroupAbuseConfig = DEFAULT_GROUP_ABUSE_CONFIG,
): number {
  return detectArrivalClusters(supporterArrivals, config).length * config.spamSignalPerCluster;
}
