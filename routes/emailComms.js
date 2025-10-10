const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const multer = require('multer');
const upload = multer();

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

// POST /api/email-comms/send - Send a customized email
router.post('/send', verifyToken, upload.any(), async (req, res) => {
  try {
    // Support both JSON and multipart/form-data payloads
    let bodySource = req.body || {};
    if (typeof req.body.payload === 'string') {
      try {
        bodySource = JSON.parse(req.body.payload);
      } catch (e) {
        console.warn('Invalid JSON in payload string');
        bodySource = {};
      }
    }

    const { 
      templateId, 
      recipientEmail, 
      recipientName, 
      bookingId, 
      customSubject, 
      customBody, 
      variables = {} 
    } = bodySource;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    // Validate required fields
    if (!recipientEmail || (!templateId && !customSubject && !customBody)) {
      return res.status(400).json({
        message: 'Missing required fields: recipientEmail and either templateId or customSubject/customBody'
      });
    }

    let emailData = {
      to: recipientEmail,
      recipientName: recipientName || 'Valued Customer',
      hallOwnerId,
      sentBy: req.user.uid,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Handle file attachments (multipart)
    const attachments = (req.files || []).map(f => ({
      filename: f.originalname,
      content: f.buffer,
      contentType: f.mimetype
    }));

    // If using a template
    if (templateId) {
      const templateDoc = await admin.firestore().collection('emailTemplates').doc(templateId).get();
      
      if (!templateDoc.exists) {
        return res.status(404).json({ message: 'Email template not found' });
      }

      const template = templateDoc.data();
      
      // Verify template ownership
      if (template.hallOwnerId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only use your own templates.' });
      }

      // Get booking data if bookingId is provided
      let bookingData = null;
      if (bookingId) {
        const bookingDoc = await admin.firestore().collection('bookings').doc(bookingId).get();
        if (bookingDoc.exists) {
          bookingData = bookingDoc.data();
        }
      }

      // Merge template variables with provided variables
      const allVariables = {
        ...variables,
        customerName: recipientName || 'Valued Customer',
        customerEmail: recipientEmail,
        ...(bookingData && {
          bookingId: bookingData.id,
          eventType: bookingData.eventType,
          bookingDate: bookingData.bookingDate,
          startTime: bookingData.startTime,
          endTime: bookingData.endTime,
          hallName: bookingData.hallName || bookingData.selectedHall,
          calculatedPrice: bookingData.calculatedPrice,
          guestCount: bookingData.guestCount,
          status: bookingData.status
        })
      };

      // Process template with variables
      emailData.subject = processTemplate(template.subject, allVariables);
      emailData.body = processTemplate(template.body, allVariables);
      emailData.templateId = templateId;
      emailData.templateName = template.name;
    } else {
      // Custom email
      emailData.subject = customSubject;
      emailData.body = customBody;
      emailData.isCustom = true;
    }

    // Add booking reference if provided
    if (bookingId) {
      emailData.bookingId = bookingId;
    }

    // Send email using the enhanced email service
    if (attachments.length > 0) {
      emailData.attachments = attachments;
    }

    const emailResult = await emailService.sendCustomizedEmail(emailData);

    // Store email record in database
    const emailRecord = {
      ...emailData,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'sent',
      messageId: emailResult.messageId
    };

    const emailDocRef = await admin.firestore().collection('emailHistory').add(emailRecord);

    res.json({
      message: 'Email sent successfully',
      emailId: emailDocRef.id,
      messageId: emailResult.messageId
    });

  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/email-comms/history - Get email history for a hall owner
router.get('/history', verifyToken, async (req, res) => {
  try {
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;
    const { limit = 50, offset = 0, status, recipientEmail } = req.query;

    console.log('Fetching email history for hall owner:', hallOwnerId);

    // Get all emails for the hall owner first
    let query = admin.firestore()
      .collection('emailHistory')
      .where('hallOwnerId', '==', hallOwnerId);

    const emailsSnapshot = await query.get();

    let emails = emailsSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        sentAt: doc.data().sentAt?.toDate?.() || null
      }));

    // Apply filters in memory
    if (status) {
      emails = emails.filter(email => email.status === status);
    }

    if (recipientEmail) {
      emails = emails.filter(email => email.to === recipientEmail);
    }

    // Sort by sentAt in descending order (newest first)
    emails = emails.sort((a, b) => {
      const aTime = a.sentAt ? a.sentAt.getTime() : 0;
      const bTime = b.sentAt ? b.sentAt.getTime() : 0;
      return bTime - aTime;
    });

    // Apply pagination
    emails = emails.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    res.json({
      emails,
      totalCount: emailsSnapshot.size,
      hasMore: emails.length === parseInt(limit)
    });

  } catch (error) {
    console.error('Error fetching email history:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/email-comms/customers - Get customers for email sending
router.get('/customers', verifyToken, async (req, res) => {
  try {
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;
    const { search } = req.query;

    console.log('Fetching customers for email sending for hall owner:', hallOwnerId);

    // Get bookings to extract customer information
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId)
      .get();

    // Group by customer email to get unique customers
    const customerMap = new Map();
    
    bookingsSnapshot.docs.forEach(doc => {
      const booking = doc.data();
      const email = booking.customerEmail?.toLowerCase();
      
      if (email && !customerMap.has(email)) {
        customerMap.set(email, {
          email: booking.customerEmail,
          name: booking.customerName,
          phone: booking.customerPhone,
          lastBookingDate: booking.bookingDate,
          totalBookings: 1,
          totalSpent: booking.calculatedPrice || 0
        });
      } else if (email && customerMap.has(email)) {
        const customer = customerMap.get(email);
        customer.totalBookings += 1;
        customer.totalSpent += (booking.calculatedPrice || 0);
        if (new Date(booking.bookingDate) > new Date(customer.lastBookingDate)) {
          customer.lastBookingDate = booking.bookingDate;
        }
      }
    });

    let customers = Array.from(customerMap.values());

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      customers = customers.filter(customer => 
        customer.name?.toLowerCase().includes(searchLower) ||
        customer.email?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by last booking date (most recent first)
    customers.sort((a, b) => new Date(b.lastBookingDate) - new Date(a.lastBookingDate));

    res.json({
      customers,
      totalCount: customers.length
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/email-comms/bookings/:customerEmail - Get bookings for a specific customer
router.get('/bookings/:customerEmail', verifyToken, async (req, res) => {
  try {
    const { customerEmail } = req.params;
    const hallOwnerId = req.user.hallOwnerId || req.user.uid;

    console.log('Fetching bookings for customer:', customerEmail);

    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId)
      .where('customerEmail', '==', customerEmail)
      .get();

    const bookings = bookingsSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        updatedAt: doc.data().updatedAt?.toDate?.() || null
      }))
      .sort((a, b) => {
        // Sort by bookingDate in descending order (newest first)
        const aDate = new Date(a.bookingDate);
        const bDate = new Date(b.bookingDate);
        return bDate - aDate;
      });

    res.json({
      bookings,
      totalCount: bookings.length
    });

  } catch (error) {
    console.error('Error fetching customer bookings:', error);
    res.status(500).json({ message: error.message });
  }
});

// Helper function to process template with variables
function processTemplate(template, variables) {
  if (!template) return '';
  
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
}

module.exports = router;
