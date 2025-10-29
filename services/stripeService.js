const admin = require('../firebaseAdmin');

let stripe = null;
try {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.warn('Stripe secret key not configured (STRIPE_SECRET_KEY). Stripe features will be disabled.');
  } else {
    // Lazy require to avoid crashing if package not installed yet
    // eslint-disable-next-line global-require
    stripe = require('stripe')(secretKey);
  }
} catch (err) {
  console.warn('Stripe initialization failed:', err?.message || err);
}

/**
 * Create a Stripe Checkout Session link for a deposit payment.
 * - Uses the hall owner's connected account via stripeAccountId stored on users doc
 * - Amount is expected in AUD dollars (will be converted to cents)
 */
async function createDepositCheckoutLink({ hallOwnerId, bookingId, bookingCode, customerName, hallName, depositAmount, stripeAccountId }) {
  try {
    if (!stripe) {
      console.warn('Stripe client not initialized. Did you set STRIPE_SECRET_KEY?');
      return null;
    }
    const amountNum = Number(depositAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      console.warn('Stripe link skipped: invalid deposit amount', { depositAmount });
      return null;
    }

    // Fetch hall owner's Stripe account ID unless provided
    let connectedAccountId = stripeAccountId;
    if (!connectedAccountId) {
      const ownerSnap = await admin.firestore().collection('users').doc(hallOwnerId).get();
      const ownerData = ownerSnap.exists ? ownerSnap.data() : null;
      connectedAccountId = ownerData?.stripeAccountId;
    }
    if (!connectedAccountId) {
      console.warn('No stripeAccountId for hall owner', hallOwnerId);
      return null;
    }

    const siteUrl = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
    console.log('Creating Stripe checkout session', {
      hallOwnerId,
      bookingId,
      bookingCode,
      depositAmount: amountNum,
      siteUrl,
      stripeAccountId: `${connectedAccountId.substring(0, 8)}...`
    });
    const successUrl = `${siteUrl}/booknow?bookingId=${encodeURIComponent(bookingId)}&payment=success`;
    const cancelUrl = `${siteUrl}/booknow?bookingId=${encodeURIComponent(bookingId)}&payment=cancel`;

    const lineItem = {
      price_data: {
        currency: 'aud',
        unit_amount: Math.round(amountNum * 100),
        product_data: {
          name: `Deposit for booking ${bookingCode || bookingId}`,
          description: hallName ? `Venue: ${hallName}${customerName ? ` • Customer: ${customerName}` : ''}` : (customerName || undefined),
        },
      },
      quantity: 1,
    };

    // Optional platform fee via env percent
    const platformFeePct = Number(process.env.PLATFORM_FEE_PCT || 0);
    const applicationFeeAmount = Number.isFinite(platformFeePct) && platformFeePct > 0
      ? Math.floor(Math.round(amountNum * 100) * (platformFeePct / 100))
      : undefined;

    // Use destination charges so application fees work in live
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [lineItem],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: bookingId,
      metadata: {
        bookingId,
        hallOwnerId,
        purpose: 'deposit',
      },
      payment_intent_data: {
        transfer_data: { destination: connectedAccountId },
        ...(applicationFeeAmount ? { application_fee_amount: applicationFeeAmount } : {}),
        metadata: {
          bookingId,
          hallOwnerId,
          purpose: 'deposit'
        }
      }
    });

    const url = session?.url || null;
    if (!url) {
      console.warn('Stripe session created but no URL returned');
    } else {
      console.log('Stripe checkout URL created', { bookingId, url });
    }
    return url;
  } catch (err) {
    console.error('Failed to create Stripe checkout session:', err?.message || err);
    return null;
  }
}

module.exports = {
  createDepositCheckoutLink,
  /**
   * Retrieve basic status of a connected account for diagnostics.
   */
  async getConnectedAccountStatus(stripeAccountId) {
    try {
      if (!stripe) {
        return { ok: false, error: 'Stripe not initialized (missing STRIPE_SECRET_KEY?)' };
      }
      if (!stripeAccountId) {
        return { ok: false, error: 'Missing stripeAccountId' };
      }
      const acct = await stripe.accounts.retrieve(stripeAccountId);
      const status = {
        ok: true,
        id: acct.id,
        charges_enabled: acct.charges_enabled,
        payouts_enabled: acct.payouts_enabled,
        requirements_due: Array.isArray(acct.requirements?.currently_due) ? acct.requirements.currently_due : []
      };
      console.log('Connected account status', status);
      return status;
    } catch (err) {
      console.error('Failed to retrieve connected account status:', err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    }
  }
};

/**
 * Helpers for Stripe Connect onboarding.
 */
async function ensureStripe() {
  if (!stripe) {
    throw new Error('Stripe not initialized (missing STRIPE_SECRET_KEY?)');
  }
}

async function createExpressAccount({ email, metadata }) {
  await ensureStripe();
  return stripe.accounts.create({
    type: 'express',
    email,
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: metadata || {},
  });
}

async function createAccountOnboardingLink({ accountId, returnUrl, refreshUrl }) {
  await ensureStripe();
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
}

module.exports.createExpressAccount = createExpressAccount;
module.exports.createAccountOnboardingLink = createAccountOnboardingLink;


