'use client';

/**
 * Sign in with Google (Google Identity Services).
 *
 * GIS mints an ID token in the browser; we hand it to the server as
 * `JoinSessionRequest.authToken`, where it is verified against Google's JWKS
 * with the audience pinned (apps/server/src/sessions/oidc-verifier.ts). Nothing
 * here is trusted — this component only transports the token.
 *
 * Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, so a deployment
 * without sign-in configured simply shows the guest path instead of a button
 * that could never work.
 */

import { useEffect, useRef, useState } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GisCredentialResponse {
  credential?: string;
}

interface GisIdApi {
  initialize(config: {
    client_id: string;
    callback: (res: GisCredentialResponse) => void;
    auto_select?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GisIdApi } };
  }
}

function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google sign-in failed to load')));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in failed to load'));
    document.head.appendChild(script);
  });
}

export interface GoogleSignInButtonProps {
  /** Receives the Google ID token to send as `authToken`. */
  onCredential: (idToken: string) => void;
  disabled?: boolean;
}

export function GoogleSignInButton({ onCredential, disabled }: GoogleSignInButtonProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Keep the latest callback without re-running GIS init (which would re-render
  // the button and drop the iframe).
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !hostRef.current) return;
        const id = window.google?.accounts?.id;
        if (!id) {
          setFailed(true);
          return;
        }
        id.initialize({
          client_id: clientId,
          callback: (res) => {
            if (res.credential) callbackRef.current(res.credential);
          },
        });
        id.renderButton(hostRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 280,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;

  if (failed) {
    return (
      <p className="helper-text">
        Google sign-in is unavailable right now — you can still continue as a guest.
      </p>
    );
  }

  return (
    <div
      ref={hostRef}
      aria-label="Sign in with Google"
      style={{
        display: 'flex',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        minHeight: 44,
      }}
    />
  );
}
