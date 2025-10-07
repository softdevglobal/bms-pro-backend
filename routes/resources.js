const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('Authorization header:', authHeader);
    
    const token = authHeader?.split(' ')[1];
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ message: 'No token provided' });
    }

    console.log('Token received:', token.substring(0, 20) + '...');
    
    // Try to verify as JWT first, then Firebase token
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      console.log('JWT decoded:', decoded);
      req.user = decoded;
      next();
    } catch (jwtError) {
      console.log('JWT verification failed, trying Firebase token:', jwtError.message);
      const decodedToken = await admin.auth().verifyIdToken(token);
      console.log('Firebase token decoded:', decodedToken);
      req.user = decodedToken;
      next();
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
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
      businessName: userData.businessName || userData.name || 'Business Name'
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
