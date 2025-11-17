const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');
const multer = require('multer');

const router = express.Router();

// use shared auth middleware

// Initialize Firebase Storage bucket for resource images
let bucket;
try {
  bucket = admin.storage().bucket('bms-pro-e3125.firebasestorage.app');
  console.log('Firebase Storage bucket initialized for resources:', bucket.name);
} catch (error) {
  console.error('Error initializing Firebase Storage bucket for resources:', error);
  bucket = null;
}

// Configure multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Multer error handler
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

// Generate unique resource code
const generateResourceCode = async (hallOwnerId) => {
  const resourcesSnapshot = await admin.firestore()
    .collection('resources')
    .where('hallOwnerId', '==', hallOwnerId)
    .get();
  
  const existingCodes = resourcesSnapshot.docs.map(doc => doc.data().code).filter(code => code);
  console.log('Existing codes for hall owner:', existingCodes);
  
  // Generate a simple incremental code
  let counter = 1;
  let code;
  let attempts = 0;
  const maxAttempts = 1000; // Prevent infinite loop
  
  do {
    code = `R${counter.toString().padStart(3, '0')}`;
    counter++;
    attempts++;
    
    if (attempts > maxAttempts) {
      // Fallback: use timestamp-based code if we can't find a simple incremental one
      code = `R${Date.now().toString().slice(-6)}`;
      console.log('Using timestamp-based code as fallback:', code);
      break;
    }
  } while (existingCodes.includes(code));
  
  console.log('Generated unique code:', code);
  return code;
};

// GET /api/resources - Get all resources for the authenticated hall_owner
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can manage resources.' });
    }
    
    // Get all resources for this hall_owner
    const resourcesSnapshot = await admin.firestore()
      .collection('resources')
      .where('hallOwnerId', '==', userId)
      .get();
    
    const resources = resourcesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    })).sort((a, b) => {
      // Sort by createdAt descending (newest first)
      if (a.createdAt && b.createdAt) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      // If one doesn't have createdAt, put it at the end
      if (a.createdAt && !b.createdAt) return -1;
      if (!a.createdAt && b.createdAt) return 1;
      // If neither has createdAt, sort by name
      return a.name.localeCompare(b.name);
    });
    
    res.json(resources);
  } catch (error) {
    console.error('Error fetching resources:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/resources - Create a new resource
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { name, type, capacity } = req.body;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can create resources.' });
    }
    
    // Validate required fields
    if (!name || !type || capacity === undefined) {
      return res.status(400).json({ 
        message: 'Name, type, and capacity are required' 
      });
    }
    
    // Validate type
    if (!['hall', 'outdoor', 'room'].includes(type.toLowerCase())) {
      return res.status(400).json({ 
        message: 'Type must be one of: hall, outdoor, room' 
      });
    }
    
    // Validate capacity
    if (typeof capacity !== 'number' || capacity < 0) {
      return res.status(400).json({ 
        message: 'Capacity must be a non-negative number' 
      });
    }
    
    // Generate unique code
    let code = await generateResourceCode(userId);
    
    // Double-check code uniqueness before saving (race condition protection)
    const existingResourceWithCode = await admin.firestore()
      .collection('resources')
      .where('hallOwnerId', '==', userId)
      .where('code', '==', code)
      .get();
    
    if (!existingResourceWithCode.empty) {
      // If code already exists, generate a new one with timestamp
      code = `R${Date.now().toString().slice(-6)}`;
      console.log('Code collision detected, using timestamp code:', code);
    }
    
    // Create resource data
    const resourceData = {
      name: name.trim(),
      code: code,
      type: type.toLowerCase(),
      capacity: capacity,
      hallOwnerId: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Save to Firestore
    const docRef = await admin.firestore().collection('resources').add(resourceData);
    
    res.status(201).json({ 
      message: 'Resource created successfully',
      id: docRef.id,
      ...resourceData
    });
    
  } catch (error) {
    console.error('Error creating resource:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/resources/:id - Update a resource
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;
    const { name, type, capacity } = req.body;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can update resources.' });
    }
    
    // Check if resource exists and belongs to this hall_owner
    const resourceDoc = await admin.firestore().collection('resources').doc(id).get();
    if (!resourceDoc.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    const resourceData = resourceDoc.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own resources.' });
    }
    
    // Validate required fields
    if (!name || !type || capacity === undefined) {
      return res.status(400).json({ 
        message: 'Name, type, and capacity are required' 
      });
    }
    
    // Validate type
    if (!['hall', 'outdoor', 'room'].includes(type.toLowerCase())) {
      return res.status(400).json({ 
        message: 'Type must be one of: hall, outdoor, room' 
      });
    }
    
    // Validate capacity
    if (typeof capacity !== 'number' || capacity < 0) {
      return res.status(400).json({ 
        message: 'Capacity must be a non-negative number' 
      });
    }
    
    // Update resource data (code cannot be changed)
    const updateData = {
      name: name.trim(),
      type: type.toLowerCase(),
      capacity: capacity,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Update in Firestore
    await admin.firestore().collection('resources').doc(id).update(updateData);
    
    res.json({ 
      message: 'Resource updated successfully',
      id: id,
      ...updateData
    });
    
  } catch (error) {
    console.error('Error updating resource:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/resources/:id/event-types - Update event types for a hall resource
router.put('/:id/event-types', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;
    const { eventTypes } = req.body;

    // Validate payload
    if (!Array.isArray(eventTypes)) {
      return res.status(400).json({ message: 'eventTypes must be an array of strings' });
    }
    const cleaned = eventTypes
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can update event types.' });
    }

    // Check if resource exists and belongs to this hall_owner
    const resourceDoc = await admin.firestore().collection('resources').doc(id).get();
    if (!resourceDoc.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    const resourceData = resourceDoc.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own resources.' });
    }

    // Only allow adding event types to halls (type === 'hall')
    if ((resourceData.type || '').toLowerCase() !== 'hall') {
      return res.status(400).json({ message: 'Event types can only be set for resources of type hall' });
    }

    await admin.firestore().collection('resources').doc(id).update({
      eventTypes: cleaned,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: 'Event types updated successfully',
      id,
      eventTypes: cleaned
    });
  } catch (error) {
    console.error('Error updating event types:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/resources/:id - Delete a resource
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can delete resources.' });
    }
    
    // Check if resource exists and belongs to this hall_owner
    const resourceDoc = await admin.firestore().collection('resources').doc(id).get();
    if (!resourceDoc.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    const resourceData = resourceDoc.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only delete your own resources.' });
    }
    
    // Delete from Firestore
    await admin.firestore().collection('resources').doc(id).delete();
    
    res.json({ message: 'Resource deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting resource:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/resources/public/:hallOwnerId - Get all resources for a specific hall owner (public endpoint)
router.get('/public/:hallOwnerId', async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    
    // Get hall owner data to include address information
    const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(404).json({ message: 'Hall owner not found' });
    }
    
    // Get all resources for this hall_owner
    const resourcesSnapshot = await admin.firestore()
      .collection('resources')
      .where('hallOwnerId', '==', hallOwnerId)
      .get();
    
    const resources = resourcesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    })).sort((a, b) => {
      // Sort by createdAt descending (newest first)
      if (a.createdAt && b.createdAt) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      // If one doesn't have createdAt, put it at the end
      if (a.createdAt && !b.createdAt) return -1;
      if (!a.createdAt && b.createdAt) return 1;
      // If neither has createdAt, sort by name
      return a.name.localeCompare(b.name);
    });
    
    // Include hall owner information (address, contact details)
    const hallOwnerInfo = {
      name: userData.name || userData.businessName || 'Hall Owner',
      address: userData.address || 'Address not provided',
      phone: userData.phone || userData.contactNumber || 'Phone not provided',
      email: userData.email || 'Email not provided',
      businessName: userData.businessName || userData.name || 'Business Name',
      eventTypes: Array.isArray(userData.eventTypes) ? userData.eventTypes : []
    };
    
    res.json({
      resources,
      hallOwner: hallOwnerInfo
    });
    
  } catch (error) {
    console.error('Error fetching public resources:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/resources/:id/image - Upload or replace a resource image
router.post('/:id/image', verifyToken, upload.single('image'), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Ensure bucket availability
    if (!bucket) {
      return res.status(500).json({
        message: 'Firebase Storage is not available. Please check your Firebase configuration.',
        bucketName: 'bms-pro-e3125.firebasestorage.app'
      });
    }
    const [exists] = await bucket.exists();
    if (!exists) {
      return res.status(500).json({
        message: 'Firebase Storage bucket does not exist. Please create it in Firebase Console.',
        bucketName: bucket.name
      });
    }

    // Verify resource ownership
    const resourceRef = admin.firestore().collection('resources').doc(id);
    const resourceSnap = await resourceRef.get();
    if (!resourceSnap.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    const resourceData = resourceSnap.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own resources.' });
    }

    // Generate filename and upload
    const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `resource-images/${userId}/${id}-${Date.now()}.${ext}`;
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: userId,
          resourceId: id,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    // Make public and get URL
    await file.makePublic();
    const imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Save on resource document
    await resourceRef.update({
      imageUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ message: 'Image uploaded successfully', imageUrl });
  } catch (error) {
    console.error('Error uploading resource image:', error);
    res.status(500).json({ message: error.message || 'Error uploading resource image' });
  }
});

// DELETE /api/resources/:id/image - Remove resource image
router.delete('/:id/image', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;

    // Verify resource ownership
    const resourceRef = admin.firestore().collection('resources').doc(id);
    const resourceSnap = await resourceRef.get();
    if (!resourceSnap.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    const resourceData = resourceSnap.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own resources.' });
    }

    const currentUrl = resourceData.imageUrl;
    if (!currentUrl) {
      return res.status(400).json({ message: 'No image to delete' });
    }

    // Best-effort delete from storage
    try {
      const pathStart = currentUrl.indexOf(`${bucket?.name}/`);
      if (bucket && pathStart !== -1) {
        const storagePath = currentUrl.substring(pathStart + bucket.name.length + 1);
        await bucket.file(storagePath).delete({ ignoreNotFound: true });
      }
    } catch (storageErr) {
      console.warn('Failed to delete resource image from storage:', storageErr?.message);
    }

    // Remove from Firestore
    await resourceRef.update({
      imageUrl: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting resource image:', error);
    res.status(500).json({ message: error.message || 'Error deleting resource image' });
  }
});

// GET /api/resources/:id - Get a specific resource
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can view resources.' });
    }
    
    // Get resource
    const resourceDoc = await admin.firestore().collection('resources').doc(id).get();
    if (!resourceDoc.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    const resourceData = resourceDoc.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only view your own resources.' });
    }
    
    res.json({
      id: resourceDoc.id,
      ...resourceData,
      createdAt: resourceData.createdAt?.toDate?.() || null,
      updatedAt: resourceData.updatedAt?.toDate?.() || null
    });
    
  } catch (error) {
    console.error('Error fetching resource:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
