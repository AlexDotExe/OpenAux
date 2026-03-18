/**
 * Seed script — creates sample data for local development.
 * Run with: npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create a sample venue
  const venue = await prisma.venue.upsert({
    where: { id: 'seed-venue-1' },
    update: {},
    create: {
      id: 'seed-venue-1',
      name: 'Club Nexus',
      genreProfile: { primary: 'hip-hop', secondary: ['r&b', 'trap'] },
      bpmRange: { min: 80, max: 140 },
      energyCurveProfile: { earlyNight: 0.4, peakHour: 1.0, lateNight: 0.7 },
      adminUsername: 'admin',
      adminPassword: 'admin123',
    },
  });
  console.log(`✅ Venue: ${venue.name} (${venue.id})`);

  // Create sample songs
  const songs = await Promise.all([
    prisma.song.upsert({
      where: { spotifyId: 'seed-song-1' },
      update: {},
      create: {
        id: 'seed-song-s1',
        spotifyId: 'seed-song-1',
        title: "God's Plan",
        artist: 'Drake',
        bpm: 77,
        genreTags: ['hip-hop', 'r&b'],
      },
    }),
    prisma.song.upsert({
      where: { spotifyId: 'seed-song-2' },
      update: {},
      create: {
        id: 'seed-song-s2',
        spotifyId: 'seed-song-2',
        title: 'Sicko Mode',
        artist: 'Travis Scott',
        bpm: 155,
        genreTags: ['hip-hop', 'trap'],
      },
    }),
    prisma.song.upsert({
      where: { spotifyId: 'seed-song-3' },
      update: {},
      create: {
        id: 'seed-song-s3',
        spotifyId: 'seed-song-3',
        title: 'HUMBLE.',
        artist: 'Kendrick Lamar',
        bpm: 150,
        genreTags: ['hip-hop'],
      },
    }),
    prisma.song.upsert({
      where: { spotifyId: 'seed-song-4' },
      update: {},
      create: {
        id: 'seed-song-s4',
        spotifyId: 'seed-song-4',
        title: 'Levitating',
        artist: 'Dua Lipa',
        bpm: 103,
        genreTags: ['pop', 'dance'],
      },
    }),
  ]);
  console.log(`✅ Songs: ${songs.map((s) => s.title).join(', ')}`);

  // Create a sample user
  const user = await prisma.user.upsert({
    where: { deviceFingerprint: 'seed-device-001' },
    update: {},
    create: {
      id: 'seed-user-1',
      deviceFingerprint: 'seed-device-001',
      reputationScore: 1.5,
      influenceWeight: 1.5,
    },
  });
  console.log(`✅ User: ${user.id}`);

  // Create a sample active session
  const session = await prisma.session.upsert({
    where: { id: 'seed-session-1' },
    update: { isActive: true, endedAt: null },
    create: {
      id: 'seed-session-1',
      venueId: venue.id,
      currentEnergyLevel: 0.6,
    },
  });
  console.log(`✅ Session: ${session.id}`);

  // Create sample song requests
  const request = await prisma.songRequest.upsert({
    where: { id: 'seed-req-1' },
    update: {},
    create: {
      id: 'seed-req-1',
      sessionId: session.id,
      songId: songs[0].id,
      userId: user.id,
      voteWeight: 1.5,
      status: 'PENDING',
    },
  });

  // Add a vote
  await prisma.vote.upsert({
    where: { requestId_userId: { requestId: request.id, userId: user.id } },
    update: {},
    create: {
      requestId: request.id,
      userId: user.id,
      value: 1,
      weight: user.influenceWeight,
    },
  });

  console.log(`✅ Request & vote created`);

  // Create a sample sponsor/anthem song for the venue
  await prisma.sponsorSong.upsert({
    where: { venueId_songId: { venueId: venue.id, songId: songs[1].id } },
    update: {},
    create: {
      venueId: venue.id,
      songId: songs[1].id, // "Sicko Mode" — Club Nexus anthem
      promotionText: '🍹 Free shot with any drink purchase during this song!',
      promotionDurationMinutes: 5,
      isAnthem: true,
      isActive: true,
    },
  });

  await prisma.sponsorSong.upsert({
    where: { venueId_songId: { venueId: venue.id, songId: songs[3].id } },
    update: {},
    create: {
      venueId: venue.id,
      songId: songs[3].id, // "Levitating" — sponsor song
      promotionText: '$2 off cocktails while this song plays!',
      promotionDurationMinutes: 4,
      isAnthem: false,
      isActive: true,
    },
  });

  console.log(`✅ Sponsor/anthem songs created`);
  console.log('\n🎉 Seed complete!');
  console.log(`\nVenue URL: /venues/seed-venue-1`);
  console.log(`Admin URL: /admin/seed-venue-1 (username: admin, password: admin123)`);
  console.log(`Admin Sign-In: /admin/sign-in`);
  console.log(`Admin Sign-Up: /admin/sign-up`);
  console.log(`Session URL: /session/seed-session-1`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
