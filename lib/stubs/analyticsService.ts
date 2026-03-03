/**
 * STUB: Analytics Export Service
 *
 * Scaling Path:
 * - Will export session data to a data warehouse (BigQuery, Snowflake, etc.)
 * - Used by venue owners, DJs, and record labels for insights
 * - Event-driven: triggered after session end
 *
 * NOT IMPLEMENTED in MVP.
 */

export interface SessionAnalyticsPayload {
  sessionId: string;
  venueId: string;
}

export interface AnalyticsExportResult {
  exported: boolean;
  recordCount: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function exportSessionAnalytics(_payload: SessionAnalyticsPayload): Promise<AnalyticsExportResult> {
  // TODO: Connect to analytics pipeline
  console.warn('[STUB] exportSessionAnalytics - not implemented');
  return { exported: false, recordCount: 0 };
}
