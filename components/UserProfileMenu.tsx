'use client';

import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { CreditPurchaseModal } from './CreditPurchaseModal';
import { CreditTransactionHistory } from './CreditTransactionHistory';

interface UserProfileMenuProps {
  onSignOut?: () => void;
}

const PROVIDER_ICONS: Record<string, string> = {
  email: '✉️',
  instagram: '📸',
  spotify: '🎵',
};

export function UserProfileMenu({ onSignOut }: UserProfileMenuProps) {
  const { authEmail, authProvider, displayName, reputationScore, creditBalance, authToken, clearAuthUser } =
    useSessionStore();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showCreditPurchase, setShowCreditPurchase] = useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click-outside or Escape key
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      if (authToken) {
        await fetch('/api/auth/signout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authToken }),
        });
      }
    } catch {
      // Ignore network errors on sign-out; clear locally regardless
    } finally {
      clearAuthUser();
      setOpen(false);
      setSigningOut(false);
      onSignOut?.();
    }
  };

  const providerIcon = authProvider ? PROVIDER_ICONS[authProvider] ?? '👤' : '👤';
  const displayLabel = displayName
    ? `DJ ${displayName}`
    : authEmail
    ? authEmail.split('@')[0]
    : 'My Account';

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold text-green-400 hover:text-green-300 transition-colors"
          aria-label="Account menu"
        >
          <span>{providerIcon}</span>
          <span className="max-w-[100px] truncate">{displayLabel}</span>
          <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* User info */}
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-xs text-gray-400">Signed in via {authProvider ?? 'email'}</p>
              {authEmail && (
                <p className="text-xs text-gray-300 mt-0.5 truncate">{authEmail}</p>
              )}
            </div>

            {/* Stats */}
            <div className="px-4 py-3 border-b border-gray-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Reputation</span>
                <span className="text-xs font-semibold text-white">
                  {reputationScore.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Credits</span>
                <span className="text-xs font-semibold text-green-400">
                  {creditBalance.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Credit actions */}
            <div className="px-4 py-2 border-b border-gray-800 space-y-1">
              <button
                onClick={() => { setOpen(false); setShowCreditPurchase(true); }}
                className="w-full text-left text-sm text-green-400 hover:text-green-300 transition-colors py-1"
              >
                💳 Buy Credits
              </button>
              <button
                onClick={() => { setOpen(false); setShowTransactionHistory(true); }}
                className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors py-1"
              >
                📋 Credit History
              </button>
            </div>

            {/* Sign out */}
            <div className="px-4 py-2">
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full text-left text-sm text-red-400 hover:text-red-300 disabled:text-gray-600 transition-colors py-1"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreditPurchase && (
        <CreditPurchaseModal onClose={() => setShowCreditPurchase(false)} />
      )}

      {showTransactionHistory && (
        <CreditTransactionHistory onClose={() => setShowTransactionHistory(false)} />
      )}
    </>
  );
}
