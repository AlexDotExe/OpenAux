/**
 * Smart Monetization Logic
 * Dynamically adjusts pricing and limits based on active user count
 */

export interface SmartMonetizationSettings {
  boostPrice: number;
  maxSongsPerUser: number;
  maxSongRepeatsPerHour: number;
  monetizationEnabled: boolean;
}

/**
 * Calculate smart monetization settings based on user count
 *
 * Pricing tiers:
 * - < 5 users: Free (no monetization)
 * - 5-9 users: $0.50 to boost
 * - 10-14 users: $1.00 to boost
 * - >= 15 users: $2.00 to boost
 *
 * Queue limits scale inversely with user count:
 * - More users = fewer songs per user
 * - More users = lower repeat limits
 */
export function calculateSmartSettings(userCount: number): SmartMonetizationSettings {
  // Less than 5 users: Free queueing
  if (userCount < 5) {
    return {
      boostPrice: 0,
      maxSongsPerUser: 10, // Generous limit for small crowds
      maxSongRepeatsPerHour: 5,
      monetizationEnabled: false, // No boost needed when free
    };
  }

  // 5-9 users: $0.50 to boost
  if (userCount < 10) {
    return {
      boostPrice: 0.5,
      maxSongsPerUser: 5,
      maxSongRepeatsPerHour: 3,
      monetizationEnabled: true,
    };
  }

  // 10-14 users: $1.00 to boost
  if (userCount < 15) {
    return {
      boostPrice: 1.0,
      maxSongsPerUser: 5,
      maxSongRepeatsPerHour: 3,
      monetizationEnabled: true,
    };
  }

  // 15+ users: $2.00 to boost
  return {
    boostPrice: 2.0,
    maxSongsPerUser: 3, // Stricter limits for large crowds
    maxSongRepeatsPerHour: 2,
    monetizationEnabled: true,
  };
}
