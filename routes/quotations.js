const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const https = require('https');

const router = express.Router();

// Generate a human-readable, unique booking code like: BK-YYYYMMDD-ABC12
function formatDateForCode(bookingDate) {
  try {
    if (!bookingDate) return '';
    if (typeof bookingDate === 'string') return bookingDate.replace(/-/g, '');
    const d = new Date(bookingDate);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  } catch (_) {
    return '';
  }
}

function generateCandidateBookingCode(bookingDate) {
  const ymd = formatDateForCode(bookingDate);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return `BK-${ymd}-${suffix}`;
}

async function generateUniqueBookingCode(firestore, bookingDate, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateCandidateBookingCode(bookingDate);
    const snap = await firestore.collection('bookings').where('bookingCode', '==', code).limit(1).get();
    if (snap.empty) return code;
  }
  return null;
}

// Helper: download a remote image into a Buffer (HTTPS only)
function downloadImageBuffer(url) {
  return new Promise((resolve, reject) => {
    try {
      https
        .get(url, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} fetching image`));
          }
          const chunks = [];
          res.on('data', (d) => chunks.push(d));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        })
        .on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// Helper: try to fetch hall owner's profile picture as Buffer
async function getHallOwnerLogoBuffer(hallOwnerId) {
  try {
    if (!hallOwnerId) return null;
    const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!userDoc.exists) return null;
    const userData = userDoc.data();
    const url = userData.profilePicture;
    if (!url || typeof url !== 'string') return null;
    const buffer = await downloadImageBuffer(url);
    return buffer;
  } catch (e) {
    console.warn('Quotation PDF: unable to fetch hall owner logo:', e.message);
    return null;
  }
}

// Helper: resolve a resource's display name from its ID; fall back to the provided value
async function getResourceDisplayName(resourceIdOrName) {
  try {
    if (!resourceIdOrName) return resourceIdOrName;
    const resourceDoc = await admin.firestore().collection('resources').doc(resourceIdOrName).get();
    if (resourceDoc.exists) {
      const data = resourceDoc.data();
      if (data && data.name) return data.name;
    }
  } catch (e) {
    // best-effort only; ignore errors and fall back to original value
  }
  return resourceIdOrName;
}

// Helper function to generate quotation PDF
async function generateQuotationPDF(quotationData) {
  // Fetch logo buffer best-effort
  const logoBuffer = await getHallOwnerLogoBuffer(quotationData.hallOwnerId);
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
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 40, 20, { width: 60, height: 60 });
        } catch (imgErr) {
          console.warn('Quotation PDF: failed to draw logo image:', imgErr.message);
        }
      }
      
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

      // Compute normalized amounts with graceful fallback for legacy data
      const ratePct = Number.isFinite(Number(quotationData.taxRate)) ? Number(quotationData.taxRate) : 10;
      const rate = ratePct / 100;
      const isInclusive = quotationData.taxType === 'Exclusive' ? false : true;
      const rawTotal = Number(quotationData.totalAmount || 0);
      const subtotal = Number.isFinite(Number(quotationData.subtotal))
        ? Number(quotationData.subtotal)
        : (isInclusive ? Math.round((rawTotal / (1 + rate)) * 100) / 100 : Math.round(rawTotal * 100) / 100);
      const gst = Number.isFinite(Number(quotationData.gst))
        ? Number(quotationData.gst)
        : (isInclusive ? Math.round((rawTotal - subtotal) * 100) / 100 : Math.round((subtotal * rate) * 100) / 100);
      const totalInclGst = Number.isFinite(Number(quotationData.totalInclGst))
        ? Number(quotationData.totalInclGst)
        : (isInclusive ? Math.round(rawTotal * 100) / 100 : Math.round((subtotal + gst) * 100) / 100);
      const depositAmount = Number(quotationData.depositAmount || 0);
      const finalAmount = Number.isFinite(Number(quotationData.finalAmount))
        ? Number(quotationData.finalAmount)
        : Math.max(0, Math.round((totalInclGst - depositAmount) * 100) / 100);

      // Totals box showing Subtotal, GST, Total (incl), Deposit (if any), and Final
      let currentY = 460;
      const totalsBoxHeight = (quotationData.depositType && quotationData.depositType !== 'None') ? 105 : 90;
      doc.rect(350, currentY, 205, totalsBoxHeight)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);

      // Subtotal line
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Subtotal:', 360, currentY + 10)
         .font('Helvetica')
         .text(`$${subtotal.toFixed(2)} AUD`, 360, currentY + 10, { width: 185, align: 'right' });

      // GST line
      doc.fillColor(darkGray)
         .font('Helvetica-Bold')
         .text(`GST (${ratePct}%)`, 360, currentY + 25)
         .font('Helvetica')
         .text(`$${gst.toFixed(2)} AUD`, 360, currentY + 25, { width: 185, align: 'right' });

      // Total incl. GST line
      doc.fillColor(darkGray)
         .font('Helvetica-Bold')
         .text('Total (incl. GST):', 360, currentY + 40)
         .font('Helvetica')
         .text(`$${totalInclGst.toFixed(2)} AUD`, 360, currentY + 40, { width: 185, align: 'right' });

      // Deposit line if applicable
      if (quotationData.depositType && quotationData.depositType !== 'None') {
        // Highlight deposit as primary action (blue color, bold)
        doc.fillColor('#1e40af')
           .font('Helvetica-Bold')
           .text('Deposit (pay first):', 360, currentY + 55)
           .font('Helvetica-Bold')
           .text(`-$${depositAmount.toFixed(2)} AUD`, 360, currentY + 55, { width: 185, align: 'right' })
           .fillColor(darkGray);
      }

      // Final line
      const finalY = quotationData.depositType && quotationData.depositType !== 'None' ? currentY + 70 : currentY + 55;
      doc.fillColor(accentColor)
         .font('Helvetica-Bold')
         .text('Final:', 360, finalY)
         .text(`$${finalAmount.toFixed(2)} AUD`, 360, finalY, { width: 185, align: 'right' });

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
          doc.text(`• Payment terms: $${depositAmount.toFixed(2)} deposit required to confirm booking.`, 50, 645);
        } else if (quotationData.depositType === 'Percentage') {
          doc.text(`• Payment terms: ${quotationData.depositValue}% ($${depositAmount.toFixed(2)}) deposit required to confirm booking.`, 50, 645);
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
      depositValue,
      taxType,
      taxRate,
      status: requestedStatus
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

    // Resolve taxRate from DB settings if not provided; default 10
    let ratePct = Number.isFinite(Number(taxRate)) ? Number(taxRate) : undefined;
    if (!Number.isFinite(ratePct)) {
      try {
        const hallDoc = await admin.firestore().collection('users').doc(actualHallOwnerId).get();
        const hallSettings = hallDoc?.data?.() ? hallDoc.data().settings : null;
        if (hallSettings && Number.isFinite(Number(hallSettings.taxRate))) {
          ratePct = Number(hallSettings.taxRate);
        }
      } catch (e) {
        // ignore; will fallback to 10
      }
    }
    ratePct = Number.isFinite(Number(ratePct)) ? Number(ratePct) : 10;
    const rate = ratePct / 100;
    const isInclusive = taxType === 'Inclusive';
    const rawTotal = parseFloat(totalAmount);
    const subtotal = isInclusive
      ? Math.round((rawTotal / (1 + rate)) * 100) / 100
      : Math.round(rawTotal * 100) / 100;
    const gst = isInclusive
      ? Math.round((rawTotal - subtotal) * 100) / 100
      : Math.round((subtotal * rate) * 100) / 100;
    const totalInclGst = isInclusive
      ? Math.round(rawTotal * 100) / 100
      : Math.round((subtotal + gst) * 100) / 100;

    // Calculate deposit amount (ALWAYS GST-inclusive base for calculation)
    let depositAmount = 0;
    if (depositType === 'Fixed') {
      // Fixed deposits are entered as GST-inclusive
      depositAmount = Math.max(0, Math.round((parseFloat(depositValue) || 0) * 100) / 100);
    } else if (depositType === 'Percentage') {
      const pct = Math.max(0, Math.min(100, parseFloat(depositValue) || 0));
      depositAmount = Math.round(((totalInclGst * pct) / 100) * 100) / 100;
    }
    const finalAmount = Math.max(0, Math.round((totalInclGst - depositAmount) * 100) / 100);

    // Build unified payment_details block (prefer client-provided if valid)
    let paymentDetailsInput = req.body.payment_details || req.body.paymentDetails;
    let paymentDetails = null;
    if (paymentDetailsInput && typeof paymentDetailsInput === 'object') {
      try {
        const totalAmountNum = Number(paymentDetailsInput.total_amount);
        const finalDueNum = Number(paymentDetailsInput.final_due);
        const depositAmountNum = Number(paymentDetailsInput.deposit_amount);
        const taxObj = paymentDetailsInput.tax || {};
        const taxTypeStr = String(taxObj.tax_type ?? taxType ?? 'Inclusive');
        const taxAmountNum = Number(taxObj.tax_amount);
        const gstNum = Number(taxObj.gst);
        paymentDetails = {
          total_amount: Number.isFinite(totalAmountNum) ? totalAmountNum : totalInclGst,
          final_due: Number.isFinite(finalDueNum) ? finalDueNum : finalAmount,
          deposit_amount: Number.isFinite(depositAmountNum) ? depositAmountNum : depositAmount,
          tax: {
            tax_type: taxTypeStr,
            tax_amount: Number.isFinite(taxAmountNum) ? taxAmountNum : gst,
            gst: Number.isFinite(gstNum) ? gstNum : gst
          },
          deposit_paid: Boolean(paymentDetailsInput.deposit_paid) || false,
          paid_at: paymentDetailsInput.paid_at || null,
          savedAt: admin.firestore.FieldValue.serverTimestamp()
        };
      } catch (_) {
        paymentDetails = null;
      }
    }

    if (!paymentDetails) {
      // Server-computed fallback to ensure consistency
      paymentDetails = {
        total_amount: totalInclGst,
        final_due: finalAmount,
        deposit_amount: depositAmount,
        tax: {
          tax_type: isInclusive ? 'Inclusive' : 'Exclusive',
          tax_amount: gst,
          gst: gst
        },
        deposit_paid: false,
        paid_at: null,
        savedAt: admin.firestore.FieldValue.serverTimestamp()
      };
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
      taxType: taxType || 'Inclusive',
      taxRate: ratePct,
      subtotal: subtotal,
      gst: gst,
      totalInclGst: totalInclGst,
      depositType: depositType || 'None',
      depositValue: depositValue ? parseFloat(depositValue) : 0,
      depositAmount: depositAmount,
      finalAmount: finalAmount,
      payment_details: paymentDetails,
      validUntil: validUntil || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days from now
      status: requestedStatus === 'Sent' ? 'Sent' : 'Draft',
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

    // If created with status Sent, send email with PDF attachment
    if (quotationData.status === 'Sent') {
      try {
        const resourceDisplayName = await getResourceDisplayName(quotationData.resource);
        const pdfBuffer = await generateQuotationPDF({ ...quotationData, resource: resourceDisplayName });
        await emailService.sendQuotationEmail({ ...quotationData, resource: resourceDisplayName }, pdfBuffer);
        console.log('Quotation email sent successfully (on create) to:', quotationData.customerEmail);
      } catch (emailErr) {
        console.error('Failed to send quotation email on create:', emailErr);
        // Do not fail the create response if email fails
      }
    }

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

    // Resolve display name for resource to use in all communications
    const resourceDisplayName = await getResourceDisplayName(quotationData.resource);

    // Update quotation status (and persist a friendly resourceName for convenience)
    await quotationDoc.ref.update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      resourceName: resourceDisplayName
    });

    // If status is 'Sent', send email with PDF
    if (status === 'Sent') {
      try {
        const pdfBuffer = await generateQuotationPDF({ ...quotationData, resource: resourceDisplayName });
        
        // Send email with PDF attachment
        await emailService.sendQuotationEmail({ ...quotationData, resource: resourceDisplayName }, pdfBuffer);
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
          resource: resourceDisplayName,
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
        let bookingCode = await generateUniqueBookingCode(admin.firestore(), quotationData.eventDate);
        const ymd = (quotationData.eventDate || '').toString().replace(/-/g, '');
        const bookingData = {
          customerId: null,
          customerName: quotationData.customerName,
          customerEmail: quotationData.customerEmail,
          customerPhone: quotationData.customerPhone,
          customerAvatar: null,
          eventType: quotationData.eventType,
          selectedHall: quotationData.resource, // keep ID for booking linkage
          hallName: resourceDisplayName,
          bookingDate: quotationData.eventDate,
          startTime: quotationData.startTime,
          endTime: quotationData.endTime,
          additionalDescription: quotationData.notes || '',
          guestCount: quotationData.guestCount,
          hallOwnerId: actualHallOwnerId,
          status: 'confirmed', // Accepted quotations become confirmed bookings
          bookingCode: bookingCode || null,
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
        // Enforce bookingCode if generation failed or was null
        if (!bookingCode) {
          try {
            const fallback = `BK-${ymd}-${bookingDocRef.id.slice(-6).toUpperCase()}`;
            await bookingDocRef.update({ bookingCode: fallback });
            bookingCode = fallback;
          } catch (e) {
            console.warn('Failed to set fallback bookingCode for quotation booking:', e?.message || e);
          }
        }
        
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
            resource: resourceDisplayName,
            eventDate: quotationData.eventDate,
            startTime: quotationData.startTime,
            endTime: quotationData.endTime,
            guestCount: quotationData.guestCount,
            totalAmount: quotationData.totalAmount,
            bookingId: bookingDocRef.id,
            bookingCode: bookingCode,
            quotationId: quotationData.id,
            notes: quotationData.notes,
            hallOwnerId: actualHallOwnerId
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

    // If monetary or tax fields are being updated, normalize and recalc amounts
    let finalUpdateData = { ...updateData };
    const shouldRecalc = (
      Object.prototype.hasOwnProperty.call(updateData, 'totalAmount') ||
      Object.prototype.hasOwnProperty.call(updateData, 'taxType') ||
      Object.prototype.hasOwnProperty.call(updateData, 'taxRate') ||
      Object.prototype.hasOwnProperty.call(updateData, 'depositType') ||
      Object.prototype.hasOwnProperty.call(updateData, 'depositValue')
    );

    if (shouldRecalc) {
      const taxType = finalUpdateData.taxType ?? quotationData.taxType ?? 'Inclusive';
      const ratePct = Number.isFinite(Number(finalUpdateData.taxRate)) ? Number(finalUpdateData.taxRate) : (Number.isFinite(Number(quotationData.taxRate)) ? Number(quotationData.taxRate) : 10);
      const rate = ratePct / 100;
      const isInclusive = taxType === 'Exclusive' ? false : true;
      const rawTotal = Number(finalUpdateData.totalAmount ?? quotationData.totalAmount ?? 0);
      const subtotal = isInclusive
        ? Math.round((rawTotal / (1 + rate)) * 100) / 100
        : Math.round(rawTotal * 100) / 100;
      const gst = isInclusive
        ? Math.round((rawTotal - subtotal) * 100) / 100
        : Math.round((subtotal * rate) * 100) / 100;
      const totalInclGst = isInclusive ? Math.round(rawTotal * 100) / 100 : Math.round((subtotal + gst) * 100) / 100;

      const depositType = finalUpdateData.depositType ?? quotationData.depositType ?? 'None';
      const depositValue = Number(finalUpdateData.depositValue ?? quotationData.depositValue ?? 0);
      let depositAmount = 0;
      if (depositType === 'Fixed') {
        depositAmount = Math.max(0, Math.round(depositValue * 100) / 100);
      } else if (depositType === 'Percentage') {
        const pct = Math.max(0, Math.min(100, depositValue));
        depositAmount = Math.round(((totalInclGst * pct) / 100) * 100) / 100;
      }
      const finalAmount = Math.max(0, Math.round((totalInclGst - depositAmount) * 100) / 100);

      finalUpdateData = {
        ...finalUpdateData,
        taxType,
        taxRate: ratePct,
        subtotal,
        gst,
        totalInclGst,
        depositType,
        depositValue,
        depositAmount,
        finalAmount
      };

      // Sync a unified payment_details block (prefer provided shape if valid, else compute)
      let paymentDetailsInput = updateData.payment_details || updateData.paymentDetails;
      let paymentDetails = null;
      if (paymentDetailsInput && typeof paymentDetailsInput === 'object') {
        try {
          const totalAmountNum = Number(paymentDetailsInput.total_amount);
          const finalDueNum = Number(paymentDetailsInput.final_due);
          const depositAmountNum = Number(paymentDetailsInput.deposit_amount);
          const taxObj = paymentDetailsInput.tax || {};
          const taxTypeStr = String(taxObj.tax_type ?? taxType);
          const taxAmountNum = Number(taxObj.tax_amount);
          const gstNum = Number(taxObj.gst);
          paymentDetails = {
            total_amount: Number.isFinite(totalAmountNum) ? totalAmountNum : totalInclGst,
            final_due: Number.isFinite(finalDueNum) ? finalDueNum : finalAmount,
            deposit_amount: Number.isFinite(depositAmountNum) ? depositAmountNum : depositAmount,
            tax: {
              tax_type: taxTypeStr,
              tax_amount: Number.isFinite(taxAmountNum) ? taxAmountNum : gst,
              gst: Number.isFinite(gstNum) ? gstNum : gst
            },
            deposit_paid: Boolean(paymentDetailsInput.deposit_paid) || false,
            paid_at: paymentDetailsInput.paid_at || null,
            savedAt: admin.firestore.FieldValue.serverTimestamp()
          };
        } catch (_) {
          paymentDetails = null;
        }
      }

      if (!paymentDetails) {
        paymentDetails = {
          total_amount: totalInclGst,
          final_due: finalAmount,
          deposit_amount: depositAmount,
          tax: {
            tax_type: taxType,
            tax_amount: gst,
            gst: gst
          },
          deposit_paid: false,
          paid_at: null,
          savedAt: admin.firestore.FieldValue.serverTimestamp()
        };
      }

      finalUpdateData.payment_details = paymentDetails;
    }

    finalUpdateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    // Update quotation
    await quotationDoc.ref.update(finalUpdateData);

    // If status is updated to 'Sent', send quotation email with PDF
    if (finalUpdateData.status === 'Sent' && quotationData.status !== 'Sent') {
      try {
        // Fetch latest quotation data for email/pdf
        const updatedSnap = await quotationDoc.ref.get();
        const latest = updatedSnap.data();
        const resourceDisplayName = await getResourceDisplayName(latest.resource);
        const pdfBuffer = await generateQuotationPDF({ ...latest, resource: resourceDisplayName });
        await emailService.sendQuotationEmail({ ...latest, resource: resourceDisplayName }, pdfBuffer);
        console.log('Quotation email sent successfully (on update) to:', latest.customerEmail);
      } catch (emailErr) {
        console.error('Failed to send quotation email on update:', emailErr);
      }
    }

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
