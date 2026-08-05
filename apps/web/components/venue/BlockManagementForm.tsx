'use client';

/** Venue blocks: explicit songs, genres, artists (SPEC.md §5, D11 — kept
 * visible in-app so patrons' expectations are set). */

import { useState } from 'react';

import { ApiClientError, getApiClient, type AuthContext } from '../../lib/api';

export interface BlockManagementFormProps {
  venueId: string;
  auth: AuthContext;
  blockExplicit: boolean;
  blockedGenres: string[];
  blockedArtists: string[];
  onChanged: (next: {
    blockExplicit: boolean;
    blockedGenres: string[];
    blockedArtists: string[];
  }) => void;
}

function TagInput({
  label,
  values,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="stack">
      <span className="helper-text">{label}</span>
      <div className="tag-list">
        {values.map((v) => (
          <span className="tag-chip" key={v}>
            {v}
            <button type="button" onClick={() => onRemove(v)} aria-label={`Remove ${v}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onAdd(draft.trim());
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            if (draft.trim()) {
              onAdd(draft.trim());
              setDraft('');
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function BlockManagementForm({
  venueId,
  auth,
  blockExplicit,
  blockedGenres,
  blockedArtists,
  onChanged,
}: BlockManagementFormProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: {
    blockExplicit: boolean;
    blockedGenres: string[];
    blockedArtists: string[];
  }) => {
    setSaving(true);
    setError(null);
    try {
      await getApiClient().updateVenueSettings(venueId, next, auth);
      onChanged(next);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save blocks.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card stack">
      <strong>Blocks</strong>
      <label className="row">
        <input
          type="checkbox"
          checked={blockExplicit}
          onChange={(e) => save({ blockExplicit: e.target.checked, blockedGenres, blockedArtists })}
          disabled={saving}
        />
        Block explicit songs
      </label>
      <TagInput
        label="Blocked genres"
        values={blockedGenres}
        placeholder="e.g. trap"
        onAdd={(v) => save({ blockExplicit, blockedGenres: [...blockedGenres, v], blockedArtists })}
        onRemove={(v) =>
          save({
            blockExplicit,
            blockedGenres: blockedGenres.filter((g) => g !== v),
            blockedArtists,
          })
        }
      />
      <TagInput
        label="Blocked artists"
        values={blockedArtists}
        placeholder="e.g. Some Artist"
        onAdd={(v) =>
          save({ blockExplicit, blockedGenres, blockedArtists: [...blockedArtists, v] })
        }
        onRemove={(v) =>
          save({
            blockExplicit,
            blockedGenres,
            blockedArtists: blockedArtists.filter((a) => a !== v),
          })
        }
      />
      <p className="helper-text">Blocks are shown to patrons in-app so expectations are set.</p>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
