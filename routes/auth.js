const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Register endpoint
router.post('/register', async (req, res) => {
  const { email, password, role, hallName, address } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ message: 'Missing fields' });
  }
  try {
    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });
    // Prepare user data for Firestore
    let userData = {
      id: userRecord.uid, // Add the UID as a field in the document
      email,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (role === 'hall_owner') {
      // Only keep line1, line2, postcode, state in address
      const { line1 = '', line2 = '', postcode = '', state = '' } = address || {};
      userData.owner_profile = {
        hallName: hallName || '',
        address: { line1, line2, postcode, state },
        status: 'active',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        deleted_at: null,
      };
    }
    await admin.firestore().collection('users').doc(userRecord.uid).set(userData);
    res.status(201).json({ message: 'User registered', uid: userRecord.uid });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
