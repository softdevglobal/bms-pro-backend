const express = require('express');
const admin = require('../firebaseAdmin');
const Stripe = require('stripe');

const router = express.Router();

const stripe = (() => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    return key ? new Stripe(key) : null;
  } catch (e) {
    return null;
  }
})();

// IMPORTANT: mount this router at path '/api/webhooks/stripe' with express.raw({ type: 'application/json' })
router.post('/', async (req, res) => {
  try {
    if (!stripe) return res.status(500).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    const whSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const connectAccountId = req.headers['stripe-account'] || (event && event.account) || null;

    // Handle both sync and async payment confirmations
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Only mark paid if payment_status is paid (card) or defer to async events for redirect methods
        if (session.payment_status !== 'paid') break;
        const bookingId = session?.metadata?.bookingId;
        const hallOwnerId = session?.metadata?.hallOwnerId;

        if (bookingId) {
          try {
            const update = {
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // Mark deposit as paid if stored in unified payment_details
            update['payment_details'] = admin.firestore.FieldValue.arrayUnion(); // no-op placeholder to ensure object path below
            delete update['payment_details'];

            // Read booking to decide how to set fields safely
            const bookingRef = admin.firestore().collection('bookings').doc(bookingId);
            const snap = await bookingRef.get();
            if (snap.exists) {
              const data = snap.data();
              const paymentDetails = Object.assign({}, data.payment_details || {});
              paymentDetails.deposit_paid = true;
              paymentDetails.paid_at = admin.firestore.FieldValue.serverTimestamp();
              await bookingRef.update({ payment_details: paymentDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
          } catch (e) {
            console.error('Failed to mark deposit paid:', e);
          }
        }

        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const bookingId = session?.metadata?.bookingId;
        if (bookingId) {
          try {
            const bookingRef = admin.firestore().collection('bookings').doc(bookingId);
            const snap = await bookingRef.get();
            if (snap.exists) {
              const data = snap.data();
              const paymentDetails = Object.assign({}, data.payment_details || {});
              paymentDetails.deposit_paid = true;
              paymentDetails.paid_at = admin.firestore.FieldValue.serverTimestamp();
              await bookingRef.update({ payment_details: paymentDetails, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
          } catch (e) {
            console.error('Failed to mark deposit paid (async succeeded):', e);
          }
        }
        break;
      }
      case 'checkout.session.async_payment_failed': {
        // Optionally mark a failure flag or notify; keeping no-op for now
        break;
      }
      default:
        break;
    }

    res.json({ received: true, account: connectAccountId || undefined });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send(`Webhook handler error: ${e.message}`);
  }
});

module.exports = router;


