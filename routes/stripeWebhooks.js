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
    const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const platformSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    // Try Connect secret first (for connected account events), then fall back to platform secret
    try {
      if (!connectSecret) throw new Error('Missing STRIPE_CONNECT_WEBHOOK_SECRET');
      event = stripe.webhooks.constructEvent(req.body, sig, connectSecret);
    } catch (errConnect) {
      try {
        if (!platformSecret) throw errConnect;
        event = stripe.webhooks.constructEvent(req.body, sig, platformSecret);
      } catch (errPlatform) {
        const errMsg = (errPlatform && errPlatform.message) || (errConnect && errConnect.message) || 'Unknown webhook verification error';
        return res.status(400).send(`Webhook Error: ${errMsg}`);
      }
    }

    const connectAccountId = req.headers['stripe-account'] || (event && event.account) || null;

		// Persist a concise copy of the webhook for auditing/idempotency
		try {
			const minimal = (() => {
				switch (event.type) {
					case 'checkout.session.completed':
					case 'checkout.session.async_payment_failed':
					case 'checkout.session.async_payment_succeeded':
					case 'checkout.session.expired': {
						const s = event.data.object || {};
						return {
							sessionId: s.id,
							paymentStatus: s.payment_status,
							amountTotal: s.amount_total,
							currency: s.currency,
							bookingId: s.metadata && s.metadata.bookingId,
							hallOwnerId: s.metadata && s.metadata.hallOwnerId
						};
					}
					case 'invoice.created':
					case 'invoice.payment_failed':
					case 'invoice.payment_succeeded':
					case 'invoice.paid':
					case 'invoice.sent':
					case 'invoice.updated': {
						const inv = event.data.object || {};
						return {
							invoiceId: inv.id,
							status: inv.status,
							paid: inv.paid,
							number: inv.number,
							customerEmail: inv.customer_email,
							paymentIntent: inv.payment_intent
						};
					}
					case 'payment_link.created':
					case 'payment_link.updated': {
						const pl = event.data.object || {};
						return { paymentLinkId: pl.id, url: pl.url, active: pl.active };
					}
					case 'refund.created':
					case 'refund.failed':
					case 'refund.updated': {
						const rf = event.data.object || {};
						return {
							refundId: rf.id,
							status: rf.status,
							amount: rf.amount,
							currency: rf.currency,
							paymentIntent: rf.payment_intent,
							charge: rf.charge
						};
					}
					default:
						return undefined;
				}
			})();

			const doc = {
				id: event.id,
				type: event.type,
				account: connectAccountId || null,
				created: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000),
				livemode: Boolean(event.livemode),
				data: minimal || null,
				receivedAt: admin.firestore.FieldValue.serverTimestamp()
			};
			await admin.firestore().collection('stripe_events').doc(event.id).set(doc, { merge: true });
		} catch (persistErr) {
			console.warn('Stripe webhook persist failed (non-blocking):', persistErr && persistErr.message ? persistErr.message : persistErr);
		}

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
			case 'checkout.session.expired': {
				// Intentionally no-op; event already persisted above
				break;
			}
			case 'invoice.created':
			case 'invoice.payment_failed':
			case 'invoice.payment_succeeded':
			case 'invoice.paid':
			case 'invoice.sent':
			case 'invoice.updated': {
				// Reserved for future invoice <> booking reconciliation
				break;
			}
			case 'payment_link.created':
			case 'payment_link.updated': {
				break;
			}
			case 'refund.created':
			case 'refund.failed':
			case 'refund.updated': {
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


