const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');
const { createExpressAccount, createAccountOnboardingLink, getConnectedAccountStatus } = require('../services/stripeService');

const router = express.Router();

// POST /api/connect/account - Create an Express connected account for hall owner (or sub-user's parent)
router.post('/account', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid || req.user.user_id;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'User not found' });
    const user = userDoc.data();
    const targetUid = user.role === 'sub_user' && user.parentUserId ? user.parentUserId : uid;

    const ownerDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!ownerDoc.exists) return res.status(404).json({ message: 'Hall owner not found' });
    const owner = ownerDoc.data();

    if (owner.stripeAccountId) {
      return res.json({ stripeAccountId: owner.stripeAccountId, created: false });
    }

    const acct = await createExpressAccount({ email: owner.email, metadata: { hallOwnerId: targetUid } });

    await admin.firestore().collection('users').doc(targetUid).set({
      stripeAccountId: acct.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ stripeAccountId: acct.id, created: true });
  } catch (e) {
    console.error('Connect account creation failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// POST /api/connect/onboarding-link - Generate onboarding link for existing connected account
router.post('/onboarding-link', verifyToken, async (req, res) => {
  try {
    const { returnUrl, refreshUrl } = req.body || {};
    const uid = req.user.uid || req.user.user_id;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'User not found' });
    const user = userDoc.data();
    const targetUid = user.role === 'sub_user' && user.parentUserId ? user.parentUserId : uid;

    const ownerDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!ownerDoc.exists) return res.status(404).json({ message: 'Hall owner not found' });
    const owner = ownerDoc.data();

    if (!owner?.stripeAccountId) return res.status(400).json({ message: 'No Stripe account on file' });

    const siteUrl = process.env.PUBLIC_SITE_URL || 'http://localhost:5173';
    const link = await createAccountOnboardingLink({
      accountId: owner.stripeAccountId,
      returnUrl: returnUrl || `${siteUrl}/settings/payments?onboarding=return`,
      refreshUrl: refreshUrl || `${siteUrl}/settings/payments?onboarding=refresh`,
    });

    res.json({ url: link.url });
  } catch (e) {
    console.error('Connect onboarding link failed:', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/connect/status - Basic status of connected account
router.get('/status', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid || req.user.user_id;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ message: 'User not found' });
    const user = userDoc.data();
    const targetUid = user.role === 'sub_user' && user.parentUserId ? user.parentUserId : uid;

    const ownerDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!ownerDoc.exists) return res.status(404).json({ message: 'Hall owner not found' });
    const owner = ownerDoc.data();

    const status = await getConnectedAccountStatus(owner?.stripeAccountId);
    res.json(status);
  } catch (e) {
    console.error('Connect status failed:', e);
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;


