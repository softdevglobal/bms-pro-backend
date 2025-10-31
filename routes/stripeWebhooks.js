const express = require('express');
const admin = require('../firebaseAdmin');
const Stripe = require('stripe');

const router = express.Router();

const stripe = (() => {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      console.error('Stripe is not configured: missing STRIPE_SECRET_KEY');
      return null;
    }
    return new Stripe(key);
  } catch (e) {
    console.error('Stripe initialization failed:', e?.message || e);
    return null;
  }
})();

// IMPORTANT: mount this router at path '/api/webhooks/stripe' with express.raw({ type: 'application/json' })
router.post('/', async (req, res) => {
  try {
    if (!stripe) return res.status(500).send('Stripe not configured');
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      console.warn('[Stripe Webhook] missing stripe-signature header');
      return res.status(400).send('Missing Stripe signature');
    }
    const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    const platformSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    let usedSecretKind = null;
    // Cleanly try available secrets (prefer Connect first)
    const errors = [];
    const secretsToTry = [];
    if (connectSecret) secretsToTry.push({ kind: 'connect', secret: connectSecret });
    if (platformSecret) secretsToTry.push({ kind: 'platform', secret: platformSecret });
    for (const s of secretsToTry) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, s.secret);
        usedSecretKind = s.kind;
        break;
      } catch (err) {
        errors.push(`${s.kind}: ${err?.message || err}`);
      }
    }
    if (!event) {
      const msg = errors.length ? errors.join(' | ') : 'No Stripe webhook secret configured';
      return res.status(400).send(`Webhook Error: ${msg}`);
    }

    const connectAccountId = req.headers['stripe-account'] || (event && event.account) || null;
    try {
      console.log('[Stripe Webhook] received', {
        id: event.id,
        type: event.type,
        usedSecretKind: usedSecretKind || 'unknown',
        accountHeader: req.headers['stripe-account'] || null,
        livemode: Boolean(event.livemode),
      });
    } catch (_) {}

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
        if (!bookingId) {
          console.warn('[Stripe Webhook] markDepositPaid skipped: missing bookingId');
          return;
        }
        const bookingRef = admin.firestore().collection('bookings').doc(bookingId);

        const paidAmount = Number.isFinite(Number(amountTotalCents)) ? Math.round(Number(amountTotalCents)) / 100 : undefined;
        let createdPaymentRecordContext = null; // collect context for post-tx payment record

        await admin.firestore().runTransaction(async (tx) => {
          const snap = await tx.get(bookingRef);
          if (!snap.exists) {
            console.warn('[Stripe Webhook] booking not found for deposit', { bookingId });
            return;
          }
          const data = snap.data();
          const paymentDetails = Object.assign({}, data.payment_details || {});
          // Idempotency inside transaction
          if (paymentDetails.deposit_paid === true) {
            console.log('[Stripe Webhook] deposit already marked paid; skipping', { bookingId });
            return;
          }

          paymentDetails.deposit_paid = true;
          paymentDetails.paid_at = admin.firestore.FieldValue.serverTimestamp();
          if (paidAmount !== undefined) paymentDetails.deposit_paid_amount = paidAmount;
          if (currency) paymentDetails.deposit_currency = String(currency).toLowerCase();
          if (session && session.id) paymentDetails.deposit_stripe_session_id = session.id;
          const intentId = paymentIntentId || (session && session.payment_intent) || null;
          if (intentId) paymentDetails.deposit_stripe_payment_intent = intentId;

          tx.update(bookingRef, { payment_details: paymentDetails, payment_success: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

          createdPaymentRecordContext = {
            hallOwnerId: hallOwnerId || data.hallOwnerId || null,
            reference: intentId || (session && session.id) || 'stripe'
          };
        });

        // Best-effort: create a payment record for deposits (post-transaction)
        try {
          if (paidAmount && paidAmount > 0) {
            await admin.firestore().collection('payments').add({
              bookingId: bookingId,
              hallOwnerId: createdPaymentRecordContext ? createdPaymentRecordContext.hallOwnerId : (hallOwnerId || null),
              amount: paidAmount,
              paymentMethod: 'Stripe',
              reference: createdPaymentRecordContext ? createdPaymentRecordContext.reference : (paymentIntentId || (session && session.id) || 'stripe'),
              notes: 'Stripe deposit payment',
              processedAt: admin.firestore.FieldValue.serverTimestamp(),
              processedBy: 'stripe',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Stripe Webhook] deposit payment recorded', { bookingId, paidAmount });
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
        let paymentRecordPayload = null;

        await admin.firestore().runTransaction(async (tx) => {
          const invSnap = await tx.get(invRef);
          if (!invSnap.exists) {
            console.warn('[Stripe Webhook] invoice not found for final payment', { invoiceId });
            return;
          }
          const inv = invSnap.data();
          const amountPaid = Number(inv.depositPaid > 0 ? (inv.finalTotal ?? 0) : (inv.total ?? 0));

          // READ all necessary docs BEFORE any writes
          let bookingRef = null;
          let bookingSnap = null;
          if (inv.bookingId) {
            bookingRef = admin.firestore().collection('bookings').doc(inv.bookingId);
            bookingSnap = await tx.get(bookingRef);
          }

          // Now perform WRITES after reads
          tx.update(invRef, {
            paidAmount: amountPaid,
            status: 'PAID',
            payment_success: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          if (bookingSnap && bookingSnap.exists) {
            const data = bookingSnap.data();
            const paymentDetails = Object.assign({}, data.payment_details || {});
            paymentDetails.final_paid = true;
            paymentDetails.final_paid_amount = amountPaid;
            paymentDetails.final_paid_at = admin.firestore.FieldValue.serverTimestamp();
            if (session && session.id) paymentDetails.final_stripe_session_id = session.id;
            if (referenceId) paymentDetails.final_stripe_payment_intent = referenceId;
            paymentDetails.final_due = 0;
            tx.update(bookingRef, { payment_details: paymentDetails, payment_success: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
          }

          paymentRecordPayload = {
            invoiceNumber: inv.invoiceNumber,
            bookingId: inv.bookingId,
            hallOwnerId: inv.hallOwnerId,
            amountPaid
          };
        });

        // Create a payment record entry (post-transaction)
        try {
          if (paymentRecordPayload) {
            await admin.firestore().collection('payments').add({
              invoiceId: invoiceId,
              invoiceNumber: paymentRecordPayload.invoiceNumber,
              bookingId: paymentRecordPayload.bookingId,
              hallOwnerId: paymentRecordPayload.hallOwnerId,
              amount: paymentRecordPayload.amountPaid,
              paymentMethod: 'Stripe',
              reference: referenceId || (session && session.id) || 'stripe',
              notes: 'Stripe final payment',
              processedAt: admin.firestore.FieldValue.serverTimestamp(),
              processedBy: 'stripe',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('[Stripe Webhook] final invoice payment recorded', { invoiceId, amount: paymentRecordPayload.amountPaid });
          }
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
        if (session.payment_status !== 'paid') {
          console.log('[Stripe Webhook] session completed but not paid; deferring', { id: session?.id, status: session?.payment_status });
          break;
        }
        const bookingId = session?.metadata?.bookingId || session?.client_reference_id || null;
        const purpose = session?.metadata?.purpose;
        const invoiceId = session?.metadata?.invoiceId;
        const hallOwnerId = session?.metadata?.hallOwnerId;

        // For DEPOSIT sessions, mark deposit as paid
        if (purpose !== 'final' && bookingId) {
          console.log('[Stripe Webhook] deposit via checkout.session.completed', { bookingId, sessionId: session?.id, amount_total: session?.amount_total });
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
          console.log('[Stripe Webhook] final via checkout.session.completed', { invoiceId, sessionId: session?.id });
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
          console.log('[Stripe Webhook] deposit via payment_intent.succeeded', { bookingId, intentId: intent?.id, amount: intent?.amount });
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
          console.log('[Stripe Webhook] final via payment_intent.succeeded', { invoiceId, intentId: intent?.id });
          await markFinalInvoicePaid({ invoiceId, referenceId: intent?.id || null, session: null });
        }
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        const bookingId = session?.metadata?.bookingId || session?.client_reference_id || null;
        if (bookingId && session?.metadata?.purpose !== 'final') {
          console.log('[Stripe Webhook] deposit via async_payment_succeeded', { bookingId, sessionId: session?.id, amount_total: session?.amount_total });
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
				// Best-effort: if Stripe Invoice carries a reference to our invoiceId in metadata, mark paid
				if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
					try {
						const inv = event.data.object || {};
						const invoiceId = inv?.metadata?.invoiceId || null; // expected Firestore invoice doc id if provided upstream
						const reference = inv?.payment_intent || inv?.charge || null;
						if (invoiceId) {
							await markFinalInvoicePaid({ invoiceId, referenceId: reference, session: null });
						}
					} catch (e) {
						console.warn('Invoice event reconciliation skipped:', e?.message || e);
					}
				}
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

    try {
      console.log('[Stripe Webhook] completed handler', { id: event.id, type: event.type });
    } catch (_) {}
    res.json({ received: true, account: connectAccountId || undefined });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).send(`Webhook handler error: ${e.message}`);
  }
});

module.exports = router;


