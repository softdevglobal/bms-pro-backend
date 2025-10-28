const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');
const multer = require('multer');

const router = express.Router();

// Initialize Firebase Storage
let bucket;
try {
  bucket = admin.storage().bucket('bms-pro-e3125.firebasestorage.app');
  console.log('Firebase Storage bucket initialized:', bucket.name);
} catch (error) {
  console.error('Error initializing Firebase Storage bucket:', error);
  bucket = null;
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ message: error.message });
  } else if (error) {
    return res.status(400).json({ message: error.message });
  }
  next();
};

// GET /api/users - List all users from Firestore
router.get('/', async (req, res) => {
  try {
    const usersSnapshot = await admin.firestore().collection('users').get();
    console.log('Total users found:', usersSnapshot.docs.length);
    
    const users = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      console.log(`User ${doc.id} raw data:`, JSON.stringify(data, null, 2));
      
      return {
        id: doc.id,
        email: data.email,
        role: data.role,
        hallName: data.hallName || (data.owner_profile?.hallName) || null,
        contactNumber: data.contactNumber || (data.owner_profile?.contactNumber) || null,
        address: data.address ? {
          line1: data.address.line1,
          line2: data.address.line2,
          postcode: data.address.postcode,
          state: data.address.state
        } : (data.owner_profile?.address ? {
          line1: data.owner_profile.address.line1,
          line2: data.owner_profile.address.line2,
          postcode: data.owner_profile.address.postcode,
          state: data.owner_profile.address.state
        } : null)
      };
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users - Create a new user
router.post('/', async (req, res) => {
  try {
    const { email, password, role, hallName, contactNumber, address, parentUserId, permissions, name } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!email || !password || !role) {
      return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    // Validate role
    if (!['hall_owner', 'super_admin', 'sub_user'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be hall_owner, super_admin, or sub_user' });
    }

    // For sub_users, validate parent user, permissions, and name
    if (role === 'sub_user') {
      if (!parentUserId) {
        return res.status(400).json({ message: 'Parent user ID is required for sub-users' });
      }
      if (!permissions || !Array.isArray(permissions)) {
        return res.status(400).json({ message: 'Permissions array is required for sub-users' });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Name is required for sub-users' });
      }
    }

    // For hall owners, validate required fields
    if (role === 'hall_owner') {
      if (!hallName || !contactNumber || !address || !address.line1 || !address.postcode || !address.state) {
        return res.status(400).json({ 
          message: 'Hall name, contact number, and complete address (line1, postcode, state) are required for hall owners' 
        });
      }
    }

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      emailVerified: false
    });

    // Prepare user data for Firestore
    const userData = {
      id: userRecord.uid, // Add the UID as a field in the document
      email: email,
      role: role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add hall-specific data for hall owners
    if (role === 'hall_owner') {
      userData.hallName = hallName;
      userData.contactNumber = contactNumber;
      userData.address = {
        line1: address.line1,
        line2: address.line2 || '',
        postcode: address.postcode,
        state: address.state
      };
      // Add profile picture if provided
      if (req.body.profilePicture) {
        userData.profilePicture = req.body.profilePicture;
      }
    }

    // Add sub-user specific data
    if (role === 'sub_user') {
      userData.parentUserId = parentUserId;
      userData.permissions = permissions;
      userData.status = 'active';
      userData.name = name.trim();
    }

    // Initialize default settings including GST defaults
    userData.settings = {
      timezone: 'Australia/Sydney',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
      currency: 'AUD',
      // Tax/GST defaults
      taxType: 'Inclusive',
      taxRate: 10
    };

    // Save user data to Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set(userData);

    // Log user creation
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserCreated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      {
        email: userRecord.email,
        role: role,
        name: name || '',
        hallName: hallName || ''
      },
      ipAddress,
      hallId
    );

    res.status(201).json({ 
      message: 'User created successfully',
      uid: userRecord.uid,
      email: userRecord.email,
      role: role
    });

  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (error.code === 'auth/weak-password') {
      return res.status(400).json({ message: 'Password is too weak' });
    }

    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/settings - Update user settings (timezone, date format, currency, GST)
router.put('/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { timezone, dateFormat, timeFormat, currency, taxType, taxRate } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate timezone
    const validTimezones = [
      'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
      'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Kolkata',
      'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Adelaide',
      'Pacific/Auckland', 'Pacific/Fiji'
    ];

    if (timezone && !validTimezones.includes(timezone)) {
      return res.status(400).json({ message: 'Invalid timezone' });
    }

    // Validate date format
    const validDateFormats = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
    if (dateFormat && !validDateFormats.includes(dateFormat)) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Validate time format
    const validTimeFormats = ['12h', '24h'];
    if (timeFormat && !validTimeFormats.includes(timeFormat)) {
      return res.status(400).json({ message: 'Invalid time format' });
    }

    // Validate currency
    const validCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'INR'];
    if (currency && !validCurrencies.includes(currency)) {
      return res.status(400).json({ message: 'Invalid currency' });
    }

    // Validate tax type (GST mode)
    const validTaxTypes = ['Inclusive', 'Exclusive'];
    if (taxType !== undefined && !validTaxTypes.includes(taxType)) {
      return res.status(400).json({ message: 'Invalid tax type. Must be Inclusive or Exclusive' });
    }

    // Validate tax rate (percentage 0-100)
    if (taxRate !== undefined) {
      const rateNumber = Number(taxRate);
      if (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > 100) {
        return res.status(400).json({ message: 'Invalid tax rate. Must be a number between 0 and 100' });
      }
    }

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get existing settings
    const existingSettings = userDoc.data().settings || {};
    
    // Prepare new settings object
    const newSettings = { ...existingSettings };
    
    // Add settings fields if provided
    if (timezone !== undefined) {
      newSettings.timezone = timezone;
    }
    if (dateFormat !== undefined) {
      newSettings.dateFormat = dateFormat;
    }
    if (timeFormat !== undefined) {
      newSettings.timeFormat = timeFormat;
    }
    if (currency !== undefined) {
      newSettings.currency = currency;
    }
    if (taxType !== undefined) {
      newSettings.taxType = taxType;
    }
    if (taxRate !== undefined) {
      newSettings.taxRate = Number(taxRate);
    }

    // Prepare settings update
    const settingsUpdate = {
      settings: newSettings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update user settings in Firestore
    await admin.firestore().collection('users').doc(userId).update(settingsUpdate);

    // Log settings update
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logSettingsUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      {
        timezone: timezone || null,
        dateFormat: dateFormat || null,
        timeFormat: timeFormat || null,
        currency: currency || null,
        taxType: taxType || null,
        taxRate: taxRate !== undefined ? Number(taxRate) : null
      },
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'Settings updated successfully',
      settings: newSettings
    });

  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/stripe-account - Get hall owner's Stripe Account ID (handles sub-users)
router.get('/stripe-account', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.uid;

    // Load requester to determine hall owner target
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();

    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    const targetDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const data = targetDoc.data();
    res.json({ stripeAccountId: data?.stripeAccountId || '' });
  } catch (error) {
    console.error('Error fetching stripe account id:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/stripe-account - Set hall owner's Stripe Account ID (handles sub-users)
router.put('/stripe-account', verifyToken, async (req, res) => {
  try {
    const { stripeAccountId } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    const value = (stripeAccountId || '').trim();
    if (value && !value.startsWith('acct_')) {
      return res.status(400).json({ message: 'Stripe Account ID must start with "acct_"' });
    }

    // Determine hall owner target
    const requesterId = req.user.uid;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();

    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    // Update only stripeAccountId field on hall owner's user doc
    await admin.firestore().collection('users').doc(targetUid).set({
      stripeAccountId: value,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Audit log
    try {
      const AuditService = require('../services/auditService');
      const hallId = targetUid; // hall owner's uid is hallId
      await AuditService.logEvent({
        userId: req.user.uid,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: 'stripe_account_updated',
        targetType: 'user',
        target: `User: ${targetUid}`,
        changes: { new: { stripeAccountId: value ? 'acct_****' : '' } },
        ipAddress,
        hallId,
        additionalInfo: 'Updated Stripe Account ID for hall owner'
      });
    } catch (auditErr) {
      console.warn('Audit log failed for stripe update:', auditErr.message);
    }

    res.json({ stripeAccountId: value });
  } catch (error) {
    console.error('Error updating stripe account id:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/bank-details - Get hall owner's bank transfer details (handles sub-users)
router.get('/bank-details', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.uid;

    // Determine hall owner target
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();

    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    const targetDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const data = targetDoc.data();
    const bankDetails = data?.bankDetails || null;
    res.json({ bankDetails });
  } catch (error) {
    console.error('Error fetching bank details:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/bank-details - Set hall owner's bank transfer details (handles sub-users)
router.put('/bank-details', verifyToken, async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const {
      accountName = '',
      bsb = '',
      accountNumber = '',
      bankName = '',
      referenceNote = ''
    } = req.body || {};

    // Basic validation
    if (bsb && !/^\d{3}-?\d{3}$/.test(bsb)) {
      return res.status(400).json({ message: 'Invalid BSB format. Use 6 digits (e.g. 123-456 or 123456)' });
    }
    if (accountNumber && !/^\d{4,12}$/.test(accountNumber)) {
      return res.status(400).json({ message: 'Invalid account number. Use 4-12 digits' });
    }

    // Determine hall owner target
    const requesterId = req.user.uid;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();

    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    const bankDetails = {
      accountName: String(accountName || '').trim(),
      bsb: String(bsb || '').replace(/[^0-9]/g, '').replace(/(\d{3})(\d{3})/, '$1-$2'),
      accountNumber: String(accountNumber || '').trim(),
      bankName: String(bankName || '').trim(),
      referenceNote: String(referenceNote || '').trim()
    };

    await admin.firestore().collection('users').doc(targetUid).set({
      bankDetails,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Audit log
    try {
      const AuditService = require('../services/auditService');
      const hallId = targetUid;
      await AuditService.logEvent({
        userId: req.user.uid,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: 'bank_details_updated',
        targetType: 'user',
        target: `User: ${targetUid}`,
        changes: { new: { bankDetails: { ...bankDetails, accountNumber: bankDetails.accountNumber ? '****' : '' } } },
        ipAddress,
        hallId,
        additionalInfo: 'Updated bank transfer details for hall owner'
      });
    } catch (auditErr) {
      console.warn('Audit log failed for bank details update:', auditErr.message);
    }

    res.json({ bankDetails });
  } catch (error) {
    console.error('Error updating bank details:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/payment-methods - Get payment method toggles (handles sub-users)
router.get('/payment-methods', verifyToken, async (req, res) => {
  try {
    const requesterId = req.user.uid;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();
    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    const targetDoc = await admin.firestore().collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }
    const data = targetDoc.data();
    const defaults = { stripe: false, bankTransfer: true, cash: true, cheque: false };
    const saved = data?.paymentMethods || {};
    res.json({ paymentMethods: { ...defaults, ...saved } });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/payment-methods - Update payment method toggles (handles sub-users)
router.put('/payment-methods', verifyToken, async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    // Accept either top-level fields or nested paymentMethods
    const payload = req.body || {};
    const incoming = payload.paymentMethods || payload;
    const updates = {};
    if (incoming.stripe !== undefined) {
      if (typeof incoming.stripe !== 'boolean') return res.status(400).json({ message: 'stripe must be boolean' });
      updates.stripe = incoming.stripe;
    }
    if (incoming.bankTransfer !== undefined) {
      if (typeof incoming.bankTransfer !== 'boolean') return res.status(400).json({ message: 'bankTransfer must be boolean' });
      updates.bankTransfer = incoming.bankTransfer;
    }
    if (incoming.cash !== undefined) {
      if (typeof incoming.cash !== 'boolean') return res.status(400).json({ message: 'cash must be boolean' });
      updates.cash = incoming.cash;
    }
    if (incoming.cheque !== undefined) {
      if (typeof incoming.cheque !== 'boolean') return res.status(400).json({ message: 'cheque must be boolean' });
      updates.cheque = incoming.cheque;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid payment method fields provided' });
    }

    const requesterId = req.user.uid;
    const requesterDoc = await admin.firestore().collection('users').doc(requesterId).get();
    if (!requesterDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const requesterData = requesterDoc.data();

    const targetUid = requesterData.role === 'sub_user' && requesterData.parentUserId
      ? requesterData.parentUserId
      : requesterId;

    const targetRef = admin.firestore().collection('users').doc(targetUid);
    const currentDoc = await targetRef.get();
    const current = currentDoc.exists && currentDoc.data().paymentMethods ? currentDoc.data().paymentMethods : {};
    const newPaymentMethods = { ...current, ...updates };

    await targetRef.set({
      paymentMethods: newPaymentMethods,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    try {
      const AuditService = require('../services/auditService');
      const hallId = targetUid;
      await AuditService.logEvent({
        userId: req.user.uid,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: 'payment_methods_updated',
        targetType: 'user',
        target: `User: ${targetUid}`,
        changes: { new: { paymentMethods: newPaymentMethods } },
        ipAddress,
        hallId,
        additionalInfo: 'Updated payment method toggles'
      });
    } catch (auditErr) {
      console.warn('Audit log failed for payment methods update:', auditErr.message);
    }

    res.json({ paymentMethods: newPaymentMethods });
  } catch (error) {
    console.error('Error updating payment methods:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/settings - Get user settings
router.get('/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const settings = userData.settings || {};

    // Return default settings if none exist
    const defaultSettings = {
      timezone: 'Australia/Sydney',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '12h',
      currency: 'AUD',
      taxType: 'Inclusive',
      taxRate: 10
    };

    res.json({
      ...defaultSettings,
      ...settings
    });

  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users/log-password-change - Log password change for audit purposes
router.post('/log-password-change', verifyToken, async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Log password change
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logPasswordChanged(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'Password change logged successfully'
    });

  } catch (error) {
    console.error('Error logging password change:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/change-sub-user-password - Change sub-user password (hall owner only)
router.put('/change-sub-user-password', verifyToken, async (req, res) => {
  try {
    const { subUserId, newPassword } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!subUserId || !newPassword) {
      return res.status(400).json({ message: 'Sub-user ID and new password are required' });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }

    // Only hall owners can change sub-user passwords
    if (req.user.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Only hall owners can change sub-user passwords' });
    }

    // Check if the sub-user exists and belongs to this hall owner
    const subUserDoc = await admin.firestore().collection('users').doc(subUserId).get();
    if (!subUserDoc.exists) {
      return res.status(404).json({ message: 'Sub-user not found' });
    }

    const subUserData = subUserDoc.data();
    if (subUserData.role !== 'sub_user' || subUserData.parentUserId !== req.user.uid) {
      return res.status(403).json({ message: 'You can only change passwords for your own sub-users' });
    }

    // Update password in Firebase Auth
    try {
      await admin.auth().updateUser(subUserId, {
        password: newPassword
      });

      // Log password change for audit
      const AuditService = require('../services/auditService');
      const hallId = req.user.uid; // Hall owner's ID is the hall ID
      
      await AuditService.logSubUserPasswordChanged(
        req.user.uid,
        req.user.email,
        req.user.role,
        subUserData,
        ipAddress,
        hallId
      );

      res.json({ 
        message: 'Sub-user password changed successfully'
      });

    } catch (authError) {
      console.error('Firebase Auth error:', authError);
      
      // Handle specific Firebase Auth errors
      if (authError.code === 'auth/weak-password') {
        return res.status(400).json({ message: 'New password is too weak' });
      }
      if (authError.code === 'auth/user-not-found') {
        return res.status(404).json({ message: 'Sub-user not found in authentication system' });
      }
      
      throw authError;
    }

  } catch (error) {
    console.error('Error changing sub-user password:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/:id - Update a user
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role, hallName, contactNumber, address } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!email || !role) {
      return res.status(400).json({ message: 'Email and role are required' });
    }

    // Validate role
    if (!['hall_owner', 'super_admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be hall_owner or super_admin' });
    }

    // For hall owners, validate required fields
    if (role === 'hall_owner') {
      if (!hallName || !contactNumber || !address || !address.line1 || !address.postcode || !address.state) {
        return res.status(400).json({ 
          message: 'Hall name, contact number, and complete address (line1, postcode, state) are required for hall owners' 
        });
      }
    }

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const oldUserData = userDoc.data();

    // Prepare user data for Firestore
    const userData = {
      id: id, // Ensure the ID field is maintained
      email: email,
      role: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add hall-specific data for hall owners
    if (role === 'hall_owner') {
      userData.hallName = hallName;
      userData.contactNumber = contactNumber;
      userData.address = {
        line1: address.line1,
        line2: address.line2 || '',
        postcode: address.postcode,
        state: address.state
      };
    } else {
      // Remove hall-specific data for non-hall owners
      userData.hallName = admin.firestore.FieldValue.delete();
      userData.contactNumber = admin.firestore.FieldValue.delete();
      userData.address = admin.firestore.FieldValue.delete();
    }

    // Update user data in Firestore
    await admin.firestore().collection('users').doc(id).update(userData);

    // Update email in Firebase Auth if it changed
    const currentUser = await admin.auth().getUser(id);
    if (currentUser.email !== email) {
      await admin.auth().updateUser(id, { email: email });
    }

    // Log user update
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      oldUserData,
      {
        ...oldUserData,
        email: email,
        role: role,
        hallName: hallName || oldUserData.hallName,
        contactNumber: contactNumber || oldUserData.contactNumber,
        address: address || oldUserData.address
      },
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'User updated successfully',
      uid: id,
      email: email,
      role: role
    });

  } catch (error) {
    console.error('Error updating user:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ message: 'Email already exists' });
    }
    if (error.code === 'auth/invalid-email') {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/users/:id - Delete a user
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Check if user exists
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();

    // Delete user from Firebase Auth
    await admin.auth().deleteUser(id);

    // Delete user data from Firestore
    await admin.firestore().collection('users').doc(id).delete();

    // Log user deletion
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logUserDeleted(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      userData,
      ipAddress,
      hallId
    );

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/profile - Get current user's profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    console.log('Fetching profile for user ID:', userId);
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log('User document not found for ID:', userId);
      return res.status(404).json({ message: 'User profile not found' });
    }

    const userData = userDoc.data();
    console.log('Raw user data from Firestore:', JSON.stringify(userData, null, 2));
    
    // Return user profile data
    const profile = {
      id: userId,
      email: userData.email,
      role: userData.role,
      hallName: userData.hallName || (userData.owner_profile?.hallName) || null,
      contactNumber: userData.contactNumber || (userData.owner_profile?.contactNumber) || null,
      address: userData.address || (userData.owner_profile?.address) || null,
      profilePicture: userData.profilePicture || null,
      createdAt: userData.createdAt,
      updatedAt: userData.updatedAt
    };

    // Add sub-user specific data
    if (userData.role === 'sub_user') {
      profile.parentUserId = userData.parentUserId;
      profile.permissions = userData.permissions || [];
      profile.status = userData.status || 'active';
      profile.name = userData.name || '';
    }

    console.log('Processed profile data:', JSON.stringify(profile, null, 2));
    res.json(profile);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/users/customers - Create a new customer (public endpoint for customer registration)
router.post('/customers', async (req, res) => {
  try {
    const {
      customerId,
      name,
      email,
      phone,
      avatar,
      source
    } = req.body;

    // Validate required fields
    if (!customerId || !name || !email) {
      return res.status(400).json({
        message: 'Missing required fields: customerId, name, email'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Check if customer already exists
    const existingCustomer = await admin.firestore().collection('customers').doc(customerId).get();
    if (existingCustomer.exists) {
      return res.status(409).json({ message: 'Customer already exists with this ID' });
    }

    // Create customer data
    const customerData = {
      customerId: customerId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e63946&color=fff`,
      role: 'customer',
      status: 'active',
      source: source || 'website',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to customers collection in Firestore
    await admin.firestore().collection('customers').doc(customerId).set(customerData);

    console.log('Customer created successfully:', {
      customerId: customerId,
      name: name,
      email: email,
      source: source || 'website'
    });

    res.status(201).json({
      message: 'Customer created successfully',
      customer: {
        id: customerId,
        ...customerData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/sub-users/:parentUserId - Get all sub-users for a hall owner
router.get('/sub-users/:parentUserId', async (req, res) => {
  try {
    const { parentUserId } = req.params;
    
    const subUsersSnapshot = await admin.firestore()
      .collection('users')
      .where('parentUserId', '==', parentUserId)
      .where('role', '==', 'sub_user')
      .get();
    
    const subUsers = subUsersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        name: data.name || '',
        role: data.role,
        permissions: data.permissions || [],
        status: data.status || 'active',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    });
    
    res.json(subUsers);
  } catch (error) {
    console.error('Error fetching sub-users:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/users/sub-users/:id - Update sub-user permissions
router.put('/sub-users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions, status, name } = req.body;

    // Check if user exists and is a sub-user
    const userDoc = await admin.firestore().collection('users').doc(id).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'sub_user') {
      return res.status(400).json({ message: 'User is not a sub-user' });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (permissions !== undefined) {
      updateData.permissions = permissions;
    }

    if (status !== undefined) {
      updateData.status = status;
    }

    if (name !== undefined && name.trim()) {
      updateData.name = name.trim();
    }

    // Update user data in Firestore
    await admin.firestore().collection('users').doc(id).update(updateData);

    res.json({ 
      message: 'Sub-user updated successfully',
      uid: id
    });

  } catch (error) {
    console.error('Error updating sub-user:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/permissions - Get available permissions
router.get('/permissions', async (req, res) => {
  try {
    const permissions = [
      { id: 'dashboard', name: 'Dashboard', description: 'Access to dashboard overview' },
      { id: 'calendar', name: 'Calendar', description: 'View and manage calendar' },
      { id: 'bookings', name: 'Bookings', description: 'Manage all bookings' },
      { id: 'invoices', name: 'Invoices & Payments', description: 'Manage invoices and payments' },
      { id: 'resources', name: 'Resources', description: 'Manage hall resources' },
      { id: 'pricing', name: 'Pricing', description: 'Manage pricing and rate cards' },
      { id: 'customers', name: 'Customers', description: 'Manage customer information' },
      { id: 'reports', name: 'Reports', description: 'View and generate reports' },
      { id: 'comms', name: 'Comms', description: 'Manage communications' },
      { id: 'settings', name: 'Settings', description: 'Access system settings' },
      { id: 'audit', name: 'Audit Log', description: 'View audit logs' },
      { id: 'help', name: 'Help', description: 'Access help documentation' }
    ];

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/parent-data/:parentUserId - Get parent user's data for sub-users
router.get('/parent-data/:parentUserId', async (req, res) => {
  try {
    const { parentUserId } = req.params;
    
    // Get parent user data
    const parentUserDoc = await admin.firestore().collection('users').doc(parentUserId).get();
    
    if (!parentUserDoc.exists) {
      return res.status(404).json({ message: 'Parent user not found' });
    }

    const parentData = parentUserDoc.data();
    
    // Return parent user's hall information
    const parentInfo = {
      id: parentUserId,
      email: parentData.email,
      role: parentData.role,
      hallName: parentData.hallName || (parentData.owner_profile?.hallName) || null,
      contactNumber: parentData.contactNumber || (parentData.owner_profile?.contactNumber) || null,
      address: parentData.address || (parentData.owner_profile?.address) || null
    };

    res.json(parentInfo);
  } catch (error) {
    console.error('Error fetching parent user data:', error);
    res.status(500).json({ message: error.message });
  }
});

// Test endpoint to check Firebase Storage connectivity
router.get('/test-storage', verifyToken, async (req, res) => {
  try {
    console.log('Testing Firebase Storage connectivity...');
    
    if (!bucket) {
      return res.status(500).json({ 
        message: 'Firebase Storage bucket not initialized',
        bucketName: 'bms-pro-e3125.firebasestorage.app'
      });
    }
    
    // Test if we can access the bucket
    const [exists] = await bucket.exists();
    console.log('Bucket exists:', exists);
    
    if (!exists) {
      return res.status(500).json({ 
        message: 'Firebase Storage bucket does not exist',
        bucketName: bucket.name,
        suggestion: 'Please create the bucket in Firebase Console or check the bucket name'
      });
    }
    
    // Test if we can list files (just to verify permissions)
    const [files] = await bucket.getFiles({ maxResults: 1 });
    console.log('Storage test successful, can list files:', files.length);
    
    res.json({ 
      message: 'Firebase Storage is working correctly',
      bucketName: bucket.name,
      bucketExists: exists,
      canListFiles: true
    });
    
  } catch (error) {
    console.error('Firebase Storage test failed:', error);
    res.status(500).json({ 
      message: 'Firebase Storage test failed',
      bucketName: bucket ? bucket.name : 'unknown',
      error: error.message,
      details: error.details || error.code
    });
  }
});

// POST /api/users/upload-profile-picture - Upload profile picture
router.post('/upload-profile-picture', verifyToken, upload.single('profilePicture'), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    console.log('Upload request received for user:', userId);
    console.log('File info:', req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file');

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Check if Firebase Storage bucket is available
    if (!bucket) {
      return res.status(500).json({ 
        message: 'Firebase Storage is not available. Please check your Firebase configuration.',
        bucketName: 'bms-pro-e3125.firebasestorage.app'
      });
    }

    // Verify bucket exists
    const [bucketExists] = await bucket.exists();
    if (!bucketExists) {
      return res.status(500).json({ 
        message: 'Firebase Storage bucket does not exist. Please create it in Firebase Console.',
        bucketName: bucket.name,
        instructions: 'Go to Firebase Console > Storage > Get Started to create the bucket'
      });
    }

    // Generate unique filename
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `profile-pictures/${userId}-${Date.now()}.${fileExtension}`;
    
    console.log('Uploading file to:', fileName);
    
    // Create file reference in Firebase Storage
    const file = bucket.file(fileName);
    
    // Upload file to Firebase Storage
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    console.log('File uploaded successfully to Firebase Storage');

    // Make file publicly accessible
    await file.makePublic();
    console.log('File made public');
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log('Public URL:', publicUrl);
    
    // Update user document in Firestore with profile picture URL
    await admin.firestore().collection('users').doc(userId).update({
      profilePicture: publicUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('User document updated with profile picture URL');

    // Log profile picture upload
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logProfilePictureUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      publicUrl,
      ipAddress,
      hallId
    );

    console.log('Audit log created');

    res.json({ 
      message: 'Profile picture uploaded successfully',
      profilePicture: publicUrl
    });

  } catch (error) {
    console.error('Error uploading profile picture:', error);
    
    // Provide more specific error messages
    if (error.code === 404) {
      res.status(500).json({ 
        message: 'Firebase Storage bucket not found. Please check your Firebase project configuration.',
        error: 'Bucket does not exist',
        bucketName: 'bms-pro-e3125.firebasestorage.app',
        solution: 'Create the storage bucket in Firebase Console'
      });
    } else if (error.code === 403) {
      res.status(500).json({ 
        message: 'Permission denied. Please check your Firebase service account permissions.',
        error: 'Insufficient permissions',
        solution: 'Ensure service account has Storage Admin role'
      });
    } else {
      res.status(500).json({ 
        message: error.message || 'Error uploading profile picture',
        error: error.code || 'Unknown error'
      });
    }
  }
});

// DELETE /api/users/delete-profile-picture - Delete profile picture
router.delete('/delete-profile-picture', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Get current user data
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const currentProfilePicture = userData.profilePicture;

    if (!currentProfilePicture) {
      return res.status(400).json({ message: 'No profile picture to delete' });
    }

    // Extract filename from URL
    const urlParts = currentProfilePicture.split('/');
    const fileName = urlParts[urlParts.length - 1];
    const fullPath = `profile-pictures/${fileName}`;

    // Delete file from Firebase Storage
    try {
      const file = bucket.file(fullPath);
      await file.delete();
    } catch (storageError) {
      console.warn('Error deleting file from storage:', storageError);
      // Continue with database update even if file deletion fails
    }

    // Remove profile picture URL from user document
    await admin.firestore().collection('users').doc(userId).update({
      profilePicture: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log profile picture deletion
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logProfilePictureDeleted(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      ipAddress,
      hallId
    );

    res.json({ message: 'Profile picture deleted successfully' });

  } catch (error) {
    console.error('Error deleting profile picture:', error);
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
