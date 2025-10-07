const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Middleware to verify token (for authenticated users)
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Try to verify as JWT first, then Firebase token
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = decoded;
      next();
    } catch (jwtError) {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// GET /api/email-templates - Get all email templates for a hall owner
router.get('/', verifyToken, async (req, res) => {
  try {
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;
    const { limit = 50, offset = 0 } = req.query;

    console.log('Fetching email templates for hall owner:', hallOwnerId);

    // Get templates for the hall owner
    const templatesSnapshot = await admin.firestore()
      .collection('emailTemplates')
      .where('hallOwnerId', '==', hallOwnerId)
      .get();

    const templates = templatesSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        updatedAt: doc.data().updatedAt?.toDate?.() || null
      }))
      .sort((a, b) => {
        // Sort by createdAt in descending order (newest first)
        const aTime = a.createdAt ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      })
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      templates,
      totalCount: templatesSnapshot.size,
      hasMore: templates.length === parseInt(limit)
    });

  } catch (error) {
    console.error('Error fetching email templates:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/email-templates/:id - Get a specific email template
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    const templateDoc = await admin.firestore().collection('emailTemplates').doc(id).get();
    
    if (!templateDoc.exists) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const templateData = templateDoc.data();
    
    // Verify ownership
    if (templateData.hallOwnerId !== hallOwnerId) {
      return res.status(403).json({ message: 'Access denied. You can only access your own templates.' });
    }

    res.json({
      id: templateDoc.id,
      ...templateData,
      createdAt: templateData.createdAt?.toDate?.() || null,
      updatedAt: templateData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/email-templates - Create a new email template
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, subject, body, type = 'email', variables = [] } = req.body;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    // Validate required fields
    if (!name || !subject || !body) {
      return res.status(400).json({
        message: 'Missing required fields: name, subject, body'
      });
    }

    // Create template
    const templateData = {
      hallOwnerId,
      name,
      subject,
      body,
      type,
      variables,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore().collection('emailTemplates').add(templateData);

    res.status(201).json({
      message: 'Email template created successfully',
      template: {
        id: docRef.id,
        ...templateData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/email-templates/:id - Update an email template
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, subject, body, type, variables, isActive } = req.body;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    // Get template to verify ownership
    const templateDoc = await admin.firestore().collection('emailTemplates').doc(id).get();
    if (!templateDoc.exists) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const templateData = templateDoc.data();
    if (templateData.hallOwnerId !== hallOwnerId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own templates.' });
    }

    // Update template
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (name !== undefined) updateData.name = name;
    if (subject !== undefined) updateData.subject = subject;
    if (body !== undefined) updateData.body = body;
    if (type !== undefined) updateData.type = type;
    if (variables !== undefined) updateData.variables = variables;
    if (isActive !== undefined) updateData.isActive = isActive;

    await admin.firestore().collection('emailTemplates').doc(id).update(updateData);

    res.json({
      message: 'Email template updated successfully',
      templateId: id
    });

  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/email-templates/:id - Delete an email template
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    // Get template to verify ownership
    const templateDoc = await admin.firestore().collection('emailTemplates').doc(id).get();
    if (!templateDoc.exists) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const templateData = templateDoc.data();
    if (templateData.hallOwnerId !== hallOwnerId) {
      return res.status(403).json({ message: 'Access denied. You can only delete your own templates.' });
    }

    // Delete template
    await admin.firestore().collection('emailTemplates').doc(id).delete();

    res.json({
      message: 'Email template deleted successfully',
      templateId: id
    });

  } catch (error) {
    console.error('Error deleting email template:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
