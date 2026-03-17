import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable');
}

// Singleton pattern to avoid multiple Stripe instances
declare global {
  var __stripe: Stripe | undefined;
}

export const stripe =
  globalThis.__stripe ??
  new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-02-25.clover',
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__stripe = stripe;
}
