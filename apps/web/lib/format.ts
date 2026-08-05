export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatEta(minutes: number): string {
  if (minutes <= 0) return 'Now playing';
  if (minutes < 1) return '< 1 min';
  return `~${Math.round(minutes)} min`;
}
