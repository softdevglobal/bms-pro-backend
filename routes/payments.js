const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');
const Stripe = require('stripe');

const router = express.Router();

// use shared auth middleware

// GET /api/payments/hall-owner/:hallOwnerId - Get all payments for a hall owner
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid;

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s payments.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (userId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own payments.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view payments.' });
    }

    // Get all payments for this hall owner
    const paymentsSnapshot = await admin.firestore()
      .collection('payments')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const payments = paymentsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        processedAt: data.processedAt?.toDate?.() || null,
        createdAt: data.createdAt?.toDate?.() || null
      };
    });

    // Sort payments by processedAt in descending order (newest first)
    payments.sort((a, b) => {
      if (!a.processedAt || !b.processedAt) return 0;
      return b.processedAt.getTime() - a.processedAt.getTime();
    });

    res.json(payments);

  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/payments/invoice/:invoiceId - Get all payments for a specific invoice
router.get('/invoice/:invoiceId', verifyToken, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.user.uid;

    // Get invoice to verify access
    const invoiceDoc = await admin.firestore().collection('invoices').doc(invoiceId).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view payments for your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view payments for your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view payments.' });
    }

    // Get all payments for this invoice
    const paymentsSnapshot = await admin.firestore()
      .collection('payments')
      .where('invoiceId', '==', invoiceId)
      .get();

    const payments = paymentsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        processedAt: data.processedAt?.toDate?.() || null,
        createdAt: data.createdAt?.toDate?.() || null
      };
    });

    // Sort payments by processedAt in descending order (newest first)
    payments.sort((a, b) => {
      if (!a.processedAt || !b.processedAt) return 0;
      return b.processedAt.getTime() - a.processedAt.getTime();
    });

    res.json(payments);

  } catch (error) {
    console.error('Error fetching payments for invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/payments/:id - Get a specific payment
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get payment
    const paymentDoc = await admin.firestore().collection('payments').doc(id).get();
    if (!paymentDoc.exists) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const paymentData = paymentDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = paymentData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== paymentData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s payments.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (paymentData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own payments.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view payments.' });
    }

    res.json({
      id: paymentDoc.id,
      ...paymentData,
      processedAt: paymentData.processedAt?.toDate?.() || null,
      createdAt: paymentData.createdAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/payments/:id - Update payment details
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, reference, notes } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Get payment
    const paymentDoc = await admin.firestore().collection('payments').doc(id).get();
    if (!paymentDoc.exists) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const paymentData = paymentDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = paymentData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== paymentData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s payments.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (paymentData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own payments.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update payments.' });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (reference !== undefined) updateData.reference = reference;
    if (notes !== undefined) updateData.notes = notes;

    // Update payment
    await admin.firestore().collection('payments').doc(id).update(updateData);

    // Log payment update
    const AuditService = require('../services/auditService');
    await AuditService.logPaymentUpdated(
      userId,
      req.user.email,
      userData.role,
      paymentData,
      { ...paymentData, ...updateData },
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Payment updated successfully',
      paymentId: id
    });

  } catch (error) {
    console.error('Error updating payment:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/payments/:id - Delete a payment (only if it's the most recent payment for an invoice)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Get payment
    const paymentDoc = await admin.firestore().collection('payments').doc(id).get();
    if (!paymentDoc.exists) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const paymentData = paymentDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = paymentData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== paymentData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your parent hall owner\'s payments.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (paymentData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your own payments.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can delete payments.' });
    }

    // Check if this is the most recent payment for the invoice
    const otherPayments = await admin.firestore()
      .collection('payments')
      .where('invoiceId', '==', paymentData.invoiceId)
      .orderBy('processedAt', 'desc')
      .get();

    if (otherPayments.docs.length > 0 && otherPayments.docs[0].id !== id) {
      return res.status(400).json({
        message: 'Cannot delete payment. Only the most recent payment for an invoice can be deleted.'
      });
    }

    // Delete payment
    await admin.firestore().collection('payments').doc(id).delete();

    // Recalculate invoice paid amount and status
    const remainingPayments = otherPayments.docs.filter(doc => doc.id !== id);
    const totalPaid = remainingPayments.reduce((sum, doc) => sum + doc.data().amount, 0);

    // Get invoice to update its status
    const invoiceDoc = await admin.firestore().collection('invoices').doc(paymentData.invoiceId).get();
    if (invoiceDoc.exists) {
      const invoiceData = invoiceDoc.data();
      const newStatus = totalPaid >= invoiceData.total ? 'PAID' : 
                       totalPaid > 0 ? 'PARTIAL' : 'SENT';

      await admin.firestore().collection('invoices').doc(paymentData.invoiceId).update({
        paidAmount: totalPaid,
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Log payment deletion
    const AuditService = require('../services/auditService');
    await AuditService.logPaymentDeleted(
      userId,
      req.user.email,
      userData.role,
      paymentData,
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Payment deleted successfully',
      paymentId: id
    });

  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

/**
 * POST /api/payments/reconcile-final
 * Body: { invoiceId: string, sessionId?: string, paymentIntentId?: string }
 * - Verifies payment with Stripe (via session or intent) and, if succeeded,
 *   marks the invoice as PAID, updates the related booking's payment_details.final_*,
 *   and creates a payment record. Mirrors webhook behavior as a manual fallback.
 */
router.post('/reconcile-final', verifyToken, async (req, res) => {
  try {
    const { invoiceId, sessionId, paymentIntentId } = req.body || {};
    if (!invoiceId) return res.status(400).json({ message: 'invoiceId is required' });

    // Initialize Stripe
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return res.status(500).json({ message: 'Stripe not configured' });
    const stripe = new Stripe(secretKey);

    // Load invoice, authorize access
    const invRef = admin.firestore().collection('invoices').doc(invoiceId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ message: 'Invoice not found' });
    const inv = invSnap.data();

    // Access control (hall_owner or sub_user for same hall)
    const userDoc = await admin.firestore().collection('users').doc(req.user.uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    if (!userData) return res.status(404).json({ message: 'User not found' });
    const requesterHallOwnerId = userData.role === 'sub_user' ? (userData.parentUserId || null) : req.user.uid;
    if (!requesterHallOwnerId || inv.hallOwnerId !== requesterHallOwnerId) {
      return res.status(403).json({ message: 'Access denied for this invoice' });
    }

    // Determine payment reference by validating with Stripe
    let referenceId = paymentIntentId || null;
    if (!referenceId && sessionId) {
      const session = await stripe.checkout.sessions.retrieve(String(sessionId));
      if (!session) return res.status(400).json({ message: 'Session not found' });
      if (session.payment_status !== 'paid') return res.status(400).json({ message: `Session not paid (status=${session.payment_status})` });
      referenceId = session.payment_intent || null;
    }
    if (!referenceId) return res.status(400).json({ message: 'Provide sessionId or paymentIntentId' });

    // Verify intent succeeded
    const intent = await stripe.paymentIntents.retrieve(String(referenceId));
    if (!intent || intent.status !== 'succeeded') {
      return res.status(400).json({ message: `PaymentIntent not succeeded (status=${intent && intent.status})` });
    }

    // Compute amount to mark as paid
    const amountPaid = Number(inv.depositPaid > 0 ? (inv.finalTotal ?? 0) : (inv.total ?? 0));

    // Apply updates transactionally with reads-before-writes
    await admin.firestore().runTransaction(async (tx) => {
      let bookingRef = null;
      let bookingSnap = null;
      if (inv.bookingId) {
        bookingRef = admin.firestore().collection('bookings').doc(inv.bookingId);
        bookingSnap = await tx.get(bookingRef);
      }

      // Now perform writes
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
        paymentDetails.final_stripe_payment_intent = referenceId;
        paymentDetails.final_due = 0;
        tx.update(bookingRef, { payment_details: paymentDetails, payment_success: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    });

    // Create payment record
    await admin.firestore().collection('payments').add({
      invoiceId,
      invoiceNumber: inv.invoiceNumber,
      bookingId: inv.bookingId || null,
      hallOwnerId: inv.hallOwnerId,
      amount: amountPaid,
      paymentMethod: 'Stripe',
      reference: referenceId,
      notes: 'Manual reconcile (final payment)',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: 'stripe',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ ok: true, invoiceId, referenceId, amountPaid });
  } catch (err) {
    console.error('Reconcile final payment failed:', err?.message || err);
    return res.status(500).json({ message: err?.message || String(err) });
  }
});
