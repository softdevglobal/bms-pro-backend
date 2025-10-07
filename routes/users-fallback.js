// Fallback profile picture upload using base64 storage in Firestore
// This can be used as an alternative if Firebase Storage is not available

const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');
const multer = require('multer');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit for base64 storage
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// POST /api/users/upload-profile-picture-base64 - Upload profile picture as base64
router.post('/upload-profile-picture-base64', verifyToken, upload.single('profilePicture'), async (req, res) => {
  try {
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Convert file to base64
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    
    // Update user document in Firestore with base64 profile picture
    await admin.firestore().collection('users').doc(userId).update({
      profilePicture: base64Image,
      profilePictureType: 'base64',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log profile picture upload
    const AuditService = require('../services/auditService');
    const hallId = req.user?.hallId || 
                   (req.user?.role === 'hall_owner' ? req.user?.uid : null) ||
                   (req.user?.role === 'sub_user' && req.user?.parentUserId ? req.user?.parentUserId : null);
    
    await AuditService.logProfilePictureUpdated(
      req.user?.uid || 'system',
      req.user?.email || 'system',
      req.user?.role || 'system',
      'base64_image_uploaded',
      ipAddress,
      hallId
    );

    res.json({ 
      message: 'Profile picture uploaded successfully (base64 storage)',
      profilePicture: base64Image
    });

  } catch (error) {
    console.error('Error uploading profile picture (base64):', error);
    res.status(500).json({ message: error.message || 'Error uploading profile picture' });
  }
});

module.exports = router;
