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

    // Helper: mark a booking's deposit as paid (idempotent)
    async function markDepositPaid({ bookingId, hallOwnerId, amountTotalCents, currency, session, paymentIntentId }) {
      try {
        if (!bookingId) return;
        const bookingRef = admin.firestore().collection('bookings').doc(bookingId);
        const snap = await bookingRef.get();
        if (!snap.exists) return;

        const data = snap.data();
        const paymentDetails = Object.assign({}, data.payment_details || {});

        // Idempotency: if already marked paid, skip heavy work
        if (paymentDetails.deposit_paid === true) return;

        const paidAmount = Number.isFinite(Number(amountTotalCents)) ? Math.round(Number(amountTotalCents)) / 100 : undefined;
        paymentDetails.deposit_paid = true;
        paymentDetails.paid_at = admin.firestore.FieldValue.serverTimestamp();
        if (paidAmount !== undefined) paymentDetails.deposit_paid_amount = paidAmount;
        if (currency) paymentDetails.deposit_currency = String(currency).toLowerCase();
        if (session && session.id) paymentDetails.deposit_stripe_session_id = session.id;
        const intentId = paymentIntentId || (session && session.payment_intent) || null;
        if (intentId) paymentDetails.deposit_stripe_payment_intent = intentId;

        await bookingRef.update({ payment_details: paymentDetails, payment_success: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

        // Best-effort: create a payment record for deposits
        try {
          if (paidAmount && paidAmount > 0) {
            await admin.firestore().collection('payments').add({
              bookingId: bookingId,
              hallOwnerId: hallOwnerId || data.hallOwnerId || null,
              amount: paidAmount,
              paymentMethod: 'Stripe',
              reference: intentId || (session && session.id) || 'stripe',
              notes: 'Stripe deposit payment',
              processedAt: admin.firestore.FieldValue.serverTimestamp(),
              processedBy: 'stripe',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        } catch (e) {
          console.warn('Failed to create payment record for Stripe deposit (non-blocking):', e?.message || e);
        }
      } catch (e) {
        console.error('Failed to mark deposit paid:', e);
      }
    }

    // Helper: mark a FINAL invoice as paid and reflect on booking (idempotent-ish)
    async function markFinalInvoicePaid({ invoiceId, referenceId, session }) {
      try {
        if (!invoiceId) return;
        const invRef = admin.firestore().collection('invoices').doc(invoiceId);
        const invSnap = await invRef.get();
        if (!invSnap.exists) return;
        const inv = invSnap.data();

        const amountPaid = Number(inv.depositPaid > 0 ? (inv.finalTotal ?? 0) : (inv.total ?? 0));
        await invRef.update({
          paidAmount: amountPaid,
          status: 'PAID',
          payment_success: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Reflect final payment on related booking
        if (inv.bookingId) {
          try {
            const bookingRef = admin.firestore().collection('bookings').doc(inv.bookingId);
            const snap = await bookingRef.get();
            if (snap.exists) {
              const data = snap.data();
              const paymentDetails = Object.assign({}, data.payment_details || {});
              paymentDetails.final_paid = true;
              paymentDetails.final_paid_amount = amountPaid;
              paymentDetails.final_paid_at = admin.firestore.FieldValue.serverTimestamp();
              if (session && session.id) paymentDetails.final_stripe_session_id = session.id;
              if (referenceId) paymentDetails.final_stripe_payment_intent = referenceId;
              paymentDetails.final_due = 0;
              await bookingRef.update({ payment_details: paymentDetails, payment_success: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            }
          } catch (e) {
            console.error('Failed to write final payment details to booking:', e?.message || e);
          }
        }

        // Create a payment record entry
        try {
          await admin.firestore().collection('payments').add({
            invoiceId: invoiceId,
            invoiceNumber: inv.invoiceNumber,
            bookingId: inv.bookingId,
            hallOwnerId: inv.hallOwnerId,
            amount: amountPaid,
            paymentMethod: 'Stripe',
            reference: referenceId || (session && session.id) || 'stripe',
            notes: 'Stripe final payment',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: 'stripe',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) {
          console.warn('Failed to create payment record for Stripe final payment (non-blocking):', e?.message || e);
        }
      } catch (e) {
        console.error('Failed to mark FINAL invoice paid:', e?.message || e);
      }
    }

    // Handle both sync and async payment confirmations
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Only mark paid if payment_status is paid (card) or defer to async events for redirect methods
        if (session.payment_status !== 'paid') break;
        const bookingId = session?.metadata?.bookingId;
        const purpose = session?.metadata?.purpose;
        const invoiceId = session?.metadata?.invoiceId;
        const hallOwnerId = session?.metadata?.hallOwnerId;

        // For DEPOSIT sessions, mark deposit as paid
        if (purpose !== 'final' && bookingId) {
          await markDepositPaid({
            bookingId,
            hallOwnerId,
            amountTotalCents: session?.amount_total,
            currency: session?.currency,
            session,
            paymentIntentId: session?.payment_intent
          });
        }

        // Handle FINAL invoice payments
        if (purpose === 'final' && invoiceId) {
          await markFinalInvoicePaid({ invoiceId, referenceId: session?.payment_intent || null, session });
        }

        break;
      }
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const purpose = intent?.metadata?.purpose;
        if (purpose === 'deposit') {
          const bookingId = intent?.metadata?.bookingId;
          const hallOwnerId = intent?.metadata?.hallOwnerId;
          await markDepositPaid({
            bookingId,
            hallOwnerId,
            amountTotalCents: intent?.amount,
            currency: intent?.currency,
            session: null,
            paymentIntentId: intent?.id
          });
        } else if (purpose === 'final') {
          const invoiceId = intent?.metadata?.invoiceId;
          await markFinalInvoicePaid({ invoiceId, referenceId: intent?.id || null, session: null });
        }
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const bookingId = session?.metadata?.bookingId;
        if (bookingId && session?.metadata?.purpose !== 'final') {
          await markDepositPaid({
            bookingId,
            hallOwnerId: session?.metadata?.hallOwnerId,
            amountTotalCents: session?.amount_total,
            currency: session?.currency,
            session,
            paymentIntentId: session?.payment_intent
          });
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


