const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Helper function to generate quotation PDF
async function generateQuotationPDF(quotationData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40,
        size: 'A4',
        layout: 'portrait'
      });
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Define colors
      const primaryColor = '#2563eb'; // Blue
      const secondaryColor = '#64748b'; // Gray
      const accentColor = '#059669'; // Green
      const lightGray = '#f1f5f9';
      const darkGray = '#334155';

      // Header with gradient-like effect
      doc.rect(0, 0, 595, 120)
         .fill(primaryColor);
      
      // Company logo area (placeholder)
      doc.rect(40, 20, 60, 60)
         .fill('#ffffff')
         .stroke(primaryColor, 2);
      
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('Cranbourne', 120, 30)
         .fontSize(18)
         .text('Public Hall', 120, 55);
      
      // Quotation title
      doc.fillColor('#ffffff')
         .fontSize(28)
         .font('Helvetica-Bold')
         .text('QUOTATION', 50, 45, { width: 495, align: 'right' });

      // Quotation details box
      doc.rect(40, 140, 515, 80)
         .fill(lightGray)
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('QUOTATION DETAILS', 50, 150);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(`Quotation ID: ${quotationData.id}`, 50, 170)
         .text(`Date: ${quotationData.createdAt ? new Date(quotationData.createdAt).toLocaleDateString('en-AU') : new Date().toLocaleDateString('en-AU')}`, 50, 185)
         .text(`Valid Until: ${quotationData.validUntil ? new Date(quotationData.validUntil).toLocaleDateString('en-AU') : 'N/A'}`, 50, 200);

      // Customer details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('CUSTOMER INFORMATION', 50, 250);
      
      doc.rect(50, 260, 240, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(quotationData.customerName, 60, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(quotationData.customerEmail, 60, 295)
         .text(quotationData.customerPhone, 60, 310)
         .text('Customer', 60, 340, { width: 220, align: 'center' });

      // Event details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('EVENT INFORMATION', 310, 250);
      
      doc.rect(310, 260, 245, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(quotationData.eventType, 320, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(quotationData.resource, 320, 295)
         .text(quotationData.eventDate ? new Date(quotationData.eventDate).toLocaleDateString('en-AU') : 'N/A', 320, 310)
         .text(`${quotationData.startTime || 'N/A'} - ${quotationData.endTime || 'N/A'}`, 320, 325)
         .text(`Guests: ${quotationData.guestCount || 'N/A'}`, 320, 340);

      // Service details table
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('SERVICE DETAILS', 50, 380);
      
      // Table header
      doc.rect(50, 390, 505, 25)
         .fill(primaryColor);
      
      doc.fillColor('#ffffff')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Description', 60, 398)
         .text('Details', 200, 398)
         .text('Amount', 450, 398, { width: 95, align: 'right' });

      // Table row
      doc.rect(50, 415, 505, 30)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica')
         .text('Venue Rental', 60, 425)
         .text(`${quotationData.resource} - ${quotationData.eventType}`, 200, 425, { width: 240 })
         .text(`$${quotationData.totalAmount.toFixed(2)}`, 450, 425, { width: 95, align: 'right' });

      // Deposit section (if applicable)
      let currentY = 460;
      if (quotationData.depositType && quotationData.depositType !== 'None') {
        doc.rect(350, currentY, 205, 30)
           .fill('#ffffff')
           .stroke(secondaryColor, 1);
        
        doc.fillColor(darkGray)
           .fontSize(11)
           .font('Helvetica')
           .text('Deposit:', 360, currentY + 10)
           .text(`$${quotationData.depositAmount.toFixed(2)}`, 500, currentY + 10, { width: 45, align: 'right' });
        
        currentY += 35;
      }

      // Total section
      doc.rect(350, currentY, 205, 40)
         .fill(accentColor);
      
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text('TOTAL AMOUNT', 360, currentY + 10)
         .fontSize(20)
         .text(`$${quotationData.totalAmount.toFixed(2)} AUD`, 360, currentY + 25, { width: 185, align: 'right' });

      // Notes section
      if (quotationData.notes) {
        doc.fillColor(primaryColor)
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('ADDITIONAL NOTES', 50, 520);
        
        doc.rect(50, 530, 505, 60)
           .fill('#ffffff')
           .stroke(secondaryColor, 1);
        
        doc.fillColor(secondaryColor)
           .fontSize(10)
           .font('Helvetica')
           .text(quotationData.notes, 60, 540, { width: 485 });
      }

      // Terms and conditions
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('TERMS & CONDITIONS', 50, 610);
      
      doc.fillColor(secondaryColor)
         .fontSize(9)
         .font('Helvetica')
         .text('• This quotation is valid until the date specified above.', 50, 630);
      
      // Add deposit terms based on deposit type
      if (quotationData.depositType && quotationData.depositType !== 'None') {
        if (quotationData.depositType === 'Fixed') {
          doc.text(`• Payment terms: $${quotationData.depositAmount.toFixed(2)} deposit required to confirm booking.`, 50, 645);
        } else if (quotationData.depositType === 'Percentage') {
          doc.text(`• Payment terms: ${quotationData.depositValue}% ($${quotationData.depositAmount.toFixed(2)}) deposit required to confirm booking.`, 50, 645);
        }
      } else {
        doc.text('• Payment terms: 50% deposit required to confirm booking.', 50, 645);
      }
      
      doc.text('• Cancellation policy applies as per venue terms.', 50, 660)
         .text('• Prices are subject to change without notice.', 50, 675)
         .text('• All bookings are subject to venue availability and approval.', 50, 690);

      // Footer
      doc.rect(0, 750, 595, 50)
         .fill(lightGray);
      
      doc.fillColor(secondaryColor)
         .fontSize(8)
         .font('Helvetica')
         .text('Cranbourne Public Hall • Professional Event Management', 50, 760, { width: 495, align: 'center' })
         .text('Contact: info@cranbournehall.com.au • Phone: (03) 1234 5678', 50, 775, { width: 495, align: 'center' })
         .text('Generated on ' + new Date().toLocaleDateString('en-AU'), 50, 790, { width: 495, align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

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

// POST /api/quotations - Create a new quotation
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      resource,
      eventDate,
      startTime,
      endTime,
      guestCount,
      totalAmount,
      validUntil,
      notes,
      depositType,
      depositValue
    } = req.body;

    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !eventType || !resource || !eventDate || !startTime || !endTime || !totalAmount) {
      return res.status(400).json({
        message: 'Missing required fields'
      });
    }

    // Validate deposit fields
    if (depositType && !['None', 'Fixed', 'Percentage'].includes(depositType)) {
      return res.status(400).json({
        message: 'Invalid deposit type. Must be one of: None, Fixed, Percentage'
      });
    }

    if (depositType === 'Fixed' && (!depositValue || depositValue <= 0)) {
      return res.status(400).json({
        message: 'Deposit value is required and must be greater than 0 for Fixed deposit type'
      });
    }

    if (depositType === 'Percentage' && (!depositValue || depositValue <= 0 || depositValue > 100)) {
      return res.status(400).json({
        message: 'Deposit percentage must be between 1 and 100'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can create quotations.' });
    }

    // Generate quotation ID
    const quotationId = `QUO-${Date.now().toString().slice(-6)}`;

    // Calculate deposit amount
    let depositAmount = 0;
    if (depositType === 'Fixed') {
      depositAmount = parseFloat(depositValue);
    } else if (depositType === 'Percentage') {
      depositAmount = (parseFloat(totalAmount) * parseFloat(depositValue)) / 100;
    }

    // Create quotation data
    const quotationData = {
      id: quotationId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      eventType: eventType.trim(),
      resource: resource,
      eventDate: eventDate,
      startTime: startTime,
      endTime: endTime,
      guestCount: guestCount ? parseInt(guestCount) : null,
      totalAmount: parseFloat(totalAmount),
      depositType: depositType || 'None',
      depositValue: depositValue ? parseFloat(depositValue) : 0,
      depositAmount: depositAmount,
      validUntil: validUntil || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
      status: 'Draft',
      notes: notes || '',
      hallOwnerId: actualHallOwnerId,
      createdBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('quotations').add(quotationData);

    console.log('Quotation created successfully:', {
      quotationId: docRef.id,
      customerName: customerName,
      customerEmail: customerEmail,
      hallOwnerId: actualHallOwnerId,
      createdBy: userId
    });

    // Log quotation creation
    const AuditService = require('../services/auditService');
    await AuditService.logQuotationCreated(
      userId,
      req.user.email,
      userData.role,
      {
        id: docRef.id,
        quotationId: quotationId,
        customerName: customerName,
        eventType: eventType,
        totalAmount: totalAmount
      },
      req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
      actualHallOwnerId
    );

    res.status(201).json({
      message: 'Quotation created successfully',
      quotation: {
        id: docRef.id,
        ...quotationData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/my-quotations - Get all quotations for the current user
router.get('/my-quotations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role === 'hall_owner') {
      actualHallOwnerId = userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Get all quotations for this hall owner
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const quotations = quotationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort quotations by createdAt in descending order (newest first)
    quotations.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(quotations);

  } catch (error) {
    console.error('Error fetching quotations:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/hall-owner/:hallOwnerId - Get all quotations for a hall owner (legacy endpoint)
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role === 'hall_owner') {
      actualHallOwnerId = userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Get all quotations for this hall owner
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const quotations = quotationsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort quotations by createdAt in descending order (newest first)
    quotations.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(quotations);

  } catch (error) {
    console.error('Error fetching quotations:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/quotations/:id/status - Update quotation status
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid || req.user.user_id;

    // Validate status
    if (!['Draft', 'Sent', 'Accepted', 'Declined', 'Expired'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: Draft, Sent, Accepted, Declined, Expired'
      });
    }

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update quotation status.' });
    }

    // Update quotation status
    await quotationDoc.ref.update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // If status is 'Sent', send email with PDF
    if (status === 'Sent') {
      try {
        const pdfBuffer = await generateQuotationPDF(quotationData);
        
        // Send email with PDF attachment
        await emailService.sendQuotationEmail(quotationData, pdfBuffer);
        console.log('Quotation email sent successfully to:', quotationData.customerEmail);
      } catch (emailError) {
        console.error('Failed to send quotation email:', emailError);
        // Don't fail the status update if email fails
      }
    }

      // If status is 'Declined', send decline notification email
      if (status === 'Declined') {
        try {
          await emailService.sendQuotationDeclineEmail({
          customerName: quotationData.customerName,
          customerEmail: quotationData.customerEmail,
          eventType: quotationData.eventType,
          resource: quotationData.resource,
          eventDate: quotationData.eventDate,
          quotationId: quotationData.id
        });
        
        console.log('Quotation decline email sent successfully to:', quotationData.customerEmail);
      } catch (emailError) {
        console.error('Failed to send quotation decline email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // If status is 'Accepted', convert to booking
    if (status === 'Accepted') {
      try {
        // Create booking from quotation
        const bookingData = {
          customerId: null,
          customerName: quotationData.customerName,
          customerEmail: quotationData.customerEmail,
          customerPhone: quotationData.customerPhone,
          customerAvatar: null,
          eventType: quotationData.eventType,
          selectedHall: quotationData.resource,
          hallName: quotationData.resource, // You might want to get the actual hall name
          bookingDate: quotationData.eventDate,
          startTime: quotationData.startTime,
          endTime: quotationData.endTime,
          additionalDescription: quotationData.notes || '',
          guestCount: quotationData.guestCount,
          hallOwnerId: actualHallOwnerId,
          status: 'confirmed', // Accepted quotations become confirmed bookings
          calculatedPrice: quotationData.totalAmount,
          priceDetails: {
            quotationId: quotationData.id,
            source: 'quotation_accepted'
          },
          bookingSource: 'quotation',
          quotationId: quotationData.id,
          // Deposit information from quotation
          depositType: quotationData.depositType || 'None',
          depositValue: quotationData.depositValue || 0,
          depositAmount: quotationData.depositAmount || 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const bookingDocRef = await admin.firestore().collection('bookings').add(bookingData);
        
        // Update quotation with booking reference
        await quotationDoc.ref.update({
          bookingId: bookingDocRef.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('Quotation converted to booking:', {
          quotationId: id,
          bookingId: bookingDocRef.id,
          customerName: quotationData.customerName
        });

        // Send booking confirmation email
        try {
          console.log('Sending booking confirmation email to:', quotationData.customerEmail);
          const emailResult = await emailService.sendBookingConfirmationEmail({
            customerName: quotationData.customerName,
            customerEmail: quotationData.customerEmail,
            eventType: quotationData.eventType,
            resource: quotationData.resource,
            eventDate: quotationData.eventDate,
            startTime: quotationData.startTime,
            endTime: quotationData.endTime,
            guestCount: quotationData.guestCount,
            totalAmount: quotationData.totalAmount,
            bookingId: bookingDocRef.id,
            quotationId: quotationData.id,
            notes: quotationData.notes
          });
          
          console.log('✅ Booking confirmation email sent successfully to:', quotationData.customerEmail);
        } catch (emailError) {
          console.error('❌ Failed to send booking confirmation email:', emailError.message);
          // Don't fail the booking creation if email fails
        }

        // Log booking creation from quotation
        const AuditService = require('../services/auditService');
        await AuditService.logBookingCreated(
          userId,
          req.user.email,
          userData.role,
          {
            id: bookingDocRef.id,
            customerName: quotationData.customerName,
            eventDate: quotationData.eventDate,
            status: 'confirmed',
            totalAmount: quotationData.totalAmount,
            source: 'quotation_accepted'
          },
          req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
          actualHallOwnerId
        );

      } catch (conversionError) {
        console.error('Error converting quotation to booking:', conversionError);
        // Don't fail the status update if conversion fails
      }
    }

    res.json({
      message: 'Quotation status updated successfully',
      quotationId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating quotation status:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/:id - Get a specific quotation
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    res.json({
      id: quotationDoc.id,
      ...quotationData,
      createdAt: quotationData.createdAt?.toDate?.() || null,
      updatedAt: quotationData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/quotations/:id - Update a quotation
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update quotations.' });
    }

    // Prepare update data
    const finalUpdateData = {
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Update quotation
    await quotationDoc.ref.update(finalUpdateData);

    res.json({
      message: 'Quotation updated successfully',
      quotationId: id
    });

  } catch (error) {
    console.error('Error updating quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/quotations/:id - Delete a quotation
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only delete your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can delete quotations.' });
    }

    // Delete quotation
    await quotationDoc.ref.delete();

    res.json({
      message: 'Quotation deleted successfully',
      quotationId: id
    });

  } catch (error) {
    console.error('Error deleting quotation:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/quotations/:id/pdf - Generate and download quotation PDF
router.get('/:id/pdf', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get quotation by custom ID field
    const quotationsSnapshot = await admin.firestore()
      .collection('quotations')
      .where('id', '==', id)
      .limit(1)
      .get();
    
    if (quotationsSnapshot.empty) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    const quotationDoc = quotationsSnapshot.docs[0];
    const quotationData = quotationDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = quotationData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== quotationData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s quotations.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (quotationData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own quotations.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view quotations.' });
    }

    // Generate PDF
    const pdfBuffer = await generateQuotationPDF(quotationData);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quotation-${quotationData.id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating quotation PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
