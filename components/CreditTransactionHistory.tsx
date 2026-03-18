'use client';

import { useState, useEffect } from 'react';
import { useSessionStore } from '@/lib/store/useSessionStore';

interface CreditTransaction {
  id: string;
  amount: number;
  type: 'PURCHASE' | 'BOOST_DEBIT' | 'REFUND';
  description: string | null;
  createdAt: string;
}

interface CreditTransactionHistoryProps {
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  PURCHASE: '💳 Purchase',
  BOOST_DEBIT: '⚡ Boost',
  REFUND: '↩️ Refund',
};

export function CreditTransactionHistory({ onClose }: CreditTransactionHistoryProps) {
  const { authToken, creditBalance } = useSessionStore();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(!!authToken);
  const [error, setError] = useState<string | null>(authToken ? null : 'Please sign in to view your credit history.');

  useEffect(() => {
    if (!authToken) return;

    fetch('/api/credits/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authToken }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setTransactions(data.transactions ?? []);
        }
      })
      .catch(() => setError('Failed to load transaction history.'))
      .finally(() => setLoading(false));
  }, [authToken]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">📋 Credit History</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Current balance */}
        <div className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Current Balance</span>
          <span className="text-lg font-bold text-green-400">
            {creditBalance.toFixed(2)} credits
          </span>
        </div>

        {/* Transactions list */}
        {loading ? (
          <p className="text-gray-400 animate-pulse text-center py-4">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm text-center">{error}</p>
        ) : transactions.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No transactions yet.</p>
        ) : (
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white">
                    {TYPE_LABELS[tx.type] ?? tx.type}
                  </p>
                  {tx.description && (
                    <p className="text-xs text-gray-400 truncate">{tx.description}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    {new Date(tx.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <span
                  className={`text-sm font-bold ml-3 shrink-0 ${
                    tx.amount > 0 ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {tx.amount > 0 ? '+' : ''}
                  {tx.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg font-semibold text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
