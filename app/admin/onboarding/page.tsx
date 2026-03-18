'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface OnboardingContext {
  provider: 'spotify' | 'google';
  connectedAccountName?: string | null;
  connectedAccountEmail?: string | null;
}

export default function AdminOnboardingPage() {
  const router = useRouter();
  const [context, setContext] = useState<OnboardingContext | null>(null);
  const [venueName, setVenueName] = useState('');
  const [defaultBoostPrice, setDefaultBoostPrice] = useState(1);
  const [maxSongRepeatsPerHour, setMaxSongRepeatsPerHour] = useState(3);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(5);
  const [monetizationEnabled, setMonetizationEnabled] = useState(false);
  const [smartMonetizationEnabled, setSmartMonetizationEnabled] = useState(false);
  const [suggestionModeEnabled, setSuggestionModeEnabled] = useState(false);
  const [crowdControlEnabled, setCrowdControlEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetch('/api/admin/onboarding')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('No pending onboarding session');
        }
        return res.json();
      })
      .then((data: OnboardingContext) => {
        if (!mounted) return;
        setContext(data);
        setVenueName(data.connectedAccountName?.trim() || '');
      })
      .catch(() => {
        if (!mounted) return;
        setError('Start with Spotify or Google sign-in before creating your venue.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const providerLabel = useMemo(() => {
    if (context?.provider === 'spotify') return 'Spotify';
    if (context?.provider === 'google') return 'Google';
    return 'OAuth';
  }, [context]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch('/api/admin/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueName,
          defaultBoostPrice,
          maxSongRepeatsPerHour,
          maxSongsPerUser,
          monetizationEnabled,
          smartMonetizationEnabled,
          suggestionModeEnabled,
          crowdControlEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Unable to create your venue.');
        return;
      }

      router.push(`/admin/${data.venueId}`);
    } catch {
      setError('Unable to create your venue.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <p className="text-gray-400 animate-pulse">Loading onboarding…</p>
      </main>
    );
  }

  if (error && !context) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-4 text-center">
          <h1 className="text-3xl font-bold">🎛️ Admin Onboarding</h1>
          <p className="text-red-400 text-sm">{error}</p>
          <a
            href="/admin/sign-in"
            className="inline-block rounded-lg bg-green-600 hover:bg-green-500 px-4 py-2 font-semibold transition-colors"
          >
            Go to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Finish your venue setup</h1>
          <p className="text-sm text-gray-400">
            Signed in with {providerLabel}
            {context?.connectedAccountEmail ? ` • ${context.connectedAccountEmail}` : ''}.
          </p>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-300">
          Pick your venue name and any settings you want right now. You can change all of these
          later from the admin dashboard.
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-gray-900 p-5">
          <div className="space-y-1">
            <label className="block text-sm text-gray-400">Venue Name</label>
            <input
              type="text"
              value={venueName}
              onChange={(event) => setVenueName(event.target.value)}
              placeholder="e.g. Club Nexus"
              className="w-full rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ToggleRow
              label="Smart Monetization"
              description="Auto-adjust pricing based on crowd size."
              checked={smartMonetizationEnabled}
              onChange={setSmartMonetizationEnabled}
              color="green"
            />
            <ToggleRow
              label="Suggestion Mode"
              description="Approve requests before they enter the queue."
              checked={suggestionModeEnabled}
              onChange={setSuggestionModeEnabled}
              color="purple"
            />
            <ToggleRow
              label="Crowd Control Mode"
              description="Let crowd votes drive queue order."
              checked={crowdControlEnabled}
              onChange={setCrowdControlEnabled}
              color="blue"
            />
            {!smartMonetizationEnabled && (
              <ToggleRow
                label="Boost Purchases"
                description="Let guests pay to boost songs."
                checked={monetizationEnabled}
                onChange={setMonetizationEnabled}
                color="emerald"
              />
            )}
          </div>

          {!smartMonetizationEnabled && (
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField
                label="Boost Price"
                step={0.5}
                min={0}
                value={defaultBoostPrice}
                onChange={setDefaultBoostPrice}
              />
              <NumberField
                label="Max repeats / hr"
                min={0}
                step={1}
                value={maxSongRepeatsPerHour}
                onChange={setMaxSongRepeatsPerHour}
              />
              <NumberField
                label="Max songs / user"
                min={0}
                step={1}
                value={maxSongsPerUser}
                onChange={setMaxSongsPerUser}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 py-3 font-semibold transition-colors"
          >
            {saving ? 'Creating venue…' : 'Create venue'}
          </button>
        </form>
      </div>
    </main>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  color,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  color: 'green' | 'purple' | 'blue' | 'emerald';
}) {
  const colorClasses = {
    green: 'bg-green-600',
    purple: 'bg-purple-600',
    blue: 'bg-blue-600',
    emerald: 'bg-emerald-600',
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
            checked ? colorClasses[color] : 'bg-gray-700'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-gray-400">{label}</label>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg bg-gray-800 px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
      />
    </div>
  );
}
