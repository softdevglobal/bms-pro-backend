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

// GET /api/pricing - Get all pricing for the authenticated hall_owner
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
      return res.status(403).json({ message: 'Access denied. Only hall owners can manage pricing.' });
    }
    
    // Get all pricing for this hall_owner
    const pricingSnapshot = await admin.firestore()
      .collection('pricing')
      .where('hallOwnerId', '==', userId)
      .get();
    
    const pricing = pricingSnapshot.docs.map(doc => ({
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
      // If neither has createdAt, sort by resource name
      return a.resourceName.localeCompare(b.resourceName);
    });
    
    res.json(pricing);
  } catch (error) {
    console.error('Error fetching pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/pricing - Create new pricing for a resource
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { resourceId, resourceName, rateType, weekdayRate, weekendRate, description } = req.body;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can create pricing.' });
    }
    
    // Validate required fields
    if (!resourceId || !resourceName || !rateType || weekdayRate === undefined || weekendRate === undefined) {
      return res.status(400).json({ 
        message: 'Resource ID, resource name, rate type, weekday rate, and weekend rate are required' 
      });
    }
    
    // Validate rate type
    if (!['hourly', 'daily'].includes(rateType.toLowerCase())) {
      return res.status(400).json({ 
        message: 'Rate type must be either "hourly" or "daily"' 
      });
    }
    
    // Validate rates
    if (typeof weekdayRate !== 'number' || weekdayRate < 0 || 
        typeof weekendRate !== 'number' || weekendRate < 0) {
      return res.status(400).json({ 
        message: 'Weekday and weekend rates must be non-negative numbers' 
      });
    }
    
    // Check if resource exists and belongs to this hall_owner
    const resourceDoc = await admin.firestore().collection('resources').doc(resourceId).get();
    if (!resourceDoc.exists) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    const resourceData = resourceDoc.data();
    if (resourceData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only set pricing for your own resources.' });
    }
    
    // Check if pricing already exists for this resource
    const existingPricingSnapshot = await admin.firestore()
      .collection('pricing')
      .where('hallOwnerId', '==', userId)
      .where('resourceId', '==', resourceId)
      .get();
    
    if (!existingPricingSnapshot.empty) {
      return res.status(400).json({ 
        message: 'Pricing already exists for this resource. Use PUT to update existing pricing.' 
      });
    }
    
    // Create pricing data
    const pricingData = {
      resourceId: resourceId,
      resourceName: resourceName.trim(),
      rateType: rateType.toLowerCase(),
      weekdayRate: weekdayRate,
      weekendRate: weekendRate,
      description: description ? description.trim() : '',
      hallOwnerId: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Save to Firestore
    const docRef = await admin.firestore().collection('pricing').add(pricingData);
    
    res.status(201).json({ 
      message: 'Pricing created successfully',
      id: docRef.id,
      ...pricingData
    });
    
  } catch (error) {
    console.error('Error creating pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/pricing/:id - Update existing pricing
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { id } = req.params;
    const { rateType, weekdayRate, weekendRate, description } = req.body;
    
    // Get user data to verify they are a hall_owner
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners can update pricing.' });
    }
    
    // Check if pricing exists and belongs to this hall_owner
    const pricingDoc = await admin.firestore().collection('pricing').doc(id).get();
    if (!pricingDoc.exists) {
      return res.status(404).json({ message: 'Pricing not found' });
    }
    
    const pricingData = pricingDoc.data();
    if (pricingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own pricing.' });
    }
    
    // Validate rate type if provided
    if (rateType && !['hourly', 'daily'].includes(rateType.toLowerCase())) {
      return res.status(400).json({ 
        message: 'Rate type must be either "hourly" or "daily"' 
      });
    }
    
    // Validate rates if provided
    if ((weekdayRate !== undefined && (typeof weekdayRate !== 'number' || weekdayRate < 0)) ||
        (weekendRate !== undefined && (typeof weekendRate !== 'number' || weekendRate < 0))) {
      return res.status(400).json({ 
        message: 'Weekday and weekend rates must be non-negative numbers' 
      });
    }
    
    // Update pricing data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (rateType !== undefined) updateData.rateType = rateType.toLowerCase();
    if (weekdayRate !== undefined) updateData.weekdayRate = weekdayRate;
    if (weekendRate !== undefined) updateData.weekendRate = weekendRate;
    if (description !== undefined) updateData.description = description.trim();
    
    // Update in Firestore
    await admin.firestore().collection('pricing').doc(id).update(updateData);
    
    res.json({ 
      message: 'Pricing updated successfully',
      id: id,
      ...updateData
    });
    
  } catch (error) {
    console.error('Error updating pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/pricing/:id - Delete pricing
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
      return res.status(403).json({ message: 'Access denied. Only hall owners can delete pricing.' });
    }
    
    // Check if pricing exists and belongs to this hall_owner
    const pricingDoc = await admin.firestore().collection('pricing').doc(id).get();
    if (!pricingDoc.exists) {
      return res.status(404).json({ message: 'Pricing not found' });
    }
    
    const pricingData = pricingDoc.data();
    if (pricingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only delete your own pricing.' });
    }
    
    // Delete from Firestore
    await admin.firestore().collection('pricing').doc(id).delete();
    
    res.json({ message: 'Pricing deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/pricing/:id - Get specific pricing
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
      return res.status(403).json({ message: 'Access denied. Only hall owners can view pricing.' });
    }
    
    // Get pricing
    const pricingDoc = await admin.firestore().collection('pricing').doc(id).get();
    if (!pricingDoc.exists) {
      return res.status(404).json({ message: 'Pricing not found' });
    }
    
    const pricingData = pricingDoc.data();
    if (pricingData.hallOwnerId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only view your own pricing.' });
    }
    
    res.json({
      id: pricingDoc.id,
      ...pricingData,
      createdAt: pricingData.createdAt?.toDate?.() || null,
      updatedAt: pricingData.updatedAt?.toDate?.() || null
    });
    
  } catch (error) {
    console.error('Error fetching pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/pricing/public/:hallOwnerId - Get all pricing for a specific hall owner (public endpoint)
router.get('/public/:hallOwnerId', async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    
    // Get hall owner data to verify they exist
    const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    // Get all pricing for this hall_owner
    const pricingSnapshot = await admin.firestore()
      .collection('pricing')
      .where('hallOwnerId', '==', hallOwnerId)
      .get();

    const pricing = pricingSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    })).sort((a, b) => {
      // Sort by resource name
      return a.resourceName.localeCompare(b.resourceName);
    });

    res.json(pricing);

  } catch (error) {
    console.error('Error fetching public pricing:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
