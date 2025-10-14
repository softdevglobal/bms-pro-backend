const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { verifyToken } = require('../middleware/authMiddleware');
const https = require('https');

const router = express.Router();

// Helper function to generate invoice number
const generateInvoiceNumber = () => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `INV-${year}${month}-${random}`;
};

// Helper function to calculate GST
const calculateGST = (amount) => {
  const gstRate = 0.1; // 10% GST
  const gst = Math.round(amount * gstRate * 100) / 100;
  return gst;
};

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
    // Best-effort download; swallow errors to allow invoice generation to proceed
    const buffer = await downloadImageBuffer(url);
    return buffer;
  } catch (e) {
    console.warn('Invoice PDF: unable to fetch hall owner logo:', e.message);
    return null;
  }
}

// Helper function to generate invoice PDF
async function generateInvoicePDF(invoiceData) {
  // Fetch logo buffer before PDF generation (non-blocking if fails)
  const logoBuffer = await getHallOwnerLogoBuffer(invoiceData.hallOwnerId);
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
      // Draw hall owner profile picture if available
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, 40, 20, { width: 60, height: 60 });
        } catch (imgErr) {
          console.warn('Invoice PDF: failed to draw logo image:', imgErr.message);
        }
      }
      
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text('Cranbourne', 120, 30)
         .fontSize(18)
         .text('Public Hall', 120, 55);
      
      // Invoice title
      doc.fillColor('#ffffff')
         .fontSize(28)
         .font('Helvetica-Bold')
         .text('INVOICE', 50, 45, { width: 495, align: 'right' });

      // Invoice details box
      doc.rect(40, 140, 515, 80)
         .fill(lightGray)
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('INVOICE DETAILS', 50, 150);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(`Invoice Number: ${invoiceData.invoiceNumber}`, 50, 170)
         .text(`Issue Date: ${(invoiceData.issueDate?.toDate?.() || (invoiceData.issueDate instanceof Date ? invoiceData.issueDate : new Date())).toLocaleDateString('en-AU')}`
           , 50, 185)
         .text(`Due Date: ${(() => { const d = invoiceData.dueDate?.toDate?.() || (invoiceData.dueDate instanceof Date ? invoiceData.dueDate : null); return d ? d.toLocaleDateString('en-AU') : 'N/A'; })()}`
           , 50, 200);

      // Customer details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('BILL TO', 50, 250);
      
      doc.rect(50, 260, 240, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(invoiceData.customer.name, 60, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.customer.email, 60, 295)
         .text(invoiceData.customer.phone, 60, 310)
         .text('Customer', 60, 340, { width: 220, align: 'center' });

      // Invoice details section
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INVOICE INFORMATION', 310, 250);
      
      doc.rect(310, 260, 245, 100)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(11)
         .font('Helvetica-Bold')
         .text(invoiceData.invoiceType, 320, 275);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.resource, 320, 295)
         .text(`Booking ID: ${invoiceData.bookingId}`, 320, 310);
      
      // Add booking source and quotation info if applicable
      if (invoiceData.bookingSource === 'quotation' && invoiceData.quotationId) {
        doc.text(`Booking Source: Quotation`, 320, 325)
           .text(`Quotation ID: ${invoiceData.quotationId}`, 320, 340);
      } else {
        doc.text(`Booking Source: ${invoiceData.bookingSource || 'Direct'}`, 320, 325);
      }

      // Quotation information section (if applicable)
      if (invoiceData.bookingSource === 'quotation' && invoiceData.quotationId) {
        doc.fillColor(primaryColor)
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('QUOTATION INFORMATION', 50, 380);
        
        doc.rect(50, 390, 505, 40)
           .fill('#fef3c7')
           .stroke('#f59e0b', 1);
        
        doc.fillColor('#92400e')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('This invoice is based on an accepted quotation:', 60, 400);
        
        doc.fillColor('#b45309')
           .fontSize(9)
           .font('Helvetica')
           .text(`Quotation ID: ${invoiceData.quotationId}`, 60, 415)
           .text(`Original Quotation Amount: $${invoiceData.calculationBreakdown?.quotationTotal?.toFixed(2) || '0.00'} AUD`, 60, 425);
        
        if (invoiceData.depositPaid > 0) {
          doc.text(`Deposit Already Paid: $${invoiceData.depositPaid.toFixed(2)} AUD`, 300, 415)
             .text(`Final Amount Due: $${invoiceData.finalTotal.toFixed(2)} AUD`, 300, 425);
        }
      }

      // Line items table
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INVOICE ITEMS', 50, invoiceData.bookingSource === 'quotation' ? 450 : 380);
      
      // Table header
      const tableStartY = invoiceData.bookingSource === 'quotation' ? 460 : 390;
      doc.rect(50, tableStartY, 505, 25)
         .fill(primaryColor);
      
      doc.fillColor('#ffffff')
         .fontSize(11)
         .font('Helvetica-Bold')
         .text('Description', 60, tableStartY + 8)
         .text('Qty', 350, tableStartY + 8)
         .text('Unit Price', 400, tableStartY + 8)
         .text('Amount', 500, tableStartY + 8, { width: 45, align: 'right' });

      // Table row
      doc.rect(50, tableStartY + 25, 505, 30)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.description, 60, tableStartY + 35, { width: 280 })
         .text('1', 350, tableStartY + 35)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 400, tableStartY + 35)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, tableStartY + 35, { width: 45, align: 'right' });

      // Totals section
      let currentY = tableStartY + 70; // Position after table
      const totalsHeight = invoiceData.depositPaid > 0 ? 100 : 80; // Extra space for deposit info
      
      doc.rect(350, currentY, 205, totalsHeight)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      // Show different breakdown based on whether there's a deposit
      if (invoiceData.depositPaid > 0) {
        // For invoices with deposits, show full amount with GST, deposit, and final payment
        const fullAmount = invoiceData.fullAmountWithGST || invoiceData.total;
        doc.fillColor(darkGray)
           .fontSize(11)
           .font('Helvetica')
           .text('Full Amount (with GST):', 360, currentY + 10)
           .text(`$${fullAmount.toFixed(2)}`, 500, currentY + 10, { width: 45, align: 'right' })
           .text('Deposit Paid:', 360, currentY + 25)
           .text(`-$${invoiceData.depositPaid.toFixed(2)}`, 500, currentY + 25, { width: 45, align: 'right' });
        
        // Add calculation explanation
        doc.fillColor(secondaryColor)
           .fontSize(8)
           .font('Helvetica')
           .text(`Calculation: $${fullAmount.toFixed(2)} - $${invoiceData.depositPaid.toFixed(2)} = $${invoiceData.finalTotal.toFixed(2)}`, 360, currentY + 40, { width: 185, align: 'center' });
        
        currentY += 30; // Extra space for deposit line and calculation
      } else {
        // For invoices without deposits, show normal breakdown
        doc.fillColor(darkGray)
           .fontSize(11)
           .font('Helvetica')
           .text('Subtotal:', 360, currentY + 10)
           .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, currentY + 10, { width: 45, align: 'right' })
           .text('GST (10%):', 360, currentY + 25)
           .text(`$${invoiceData.gst.toFixed(2)}`, 500, currentY + 25, { width: 45, align: 'right' });
      }
      
      doc.rect(350, currentY + 40, 205, 40)
         .fill(accentColor);
      
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text(invoiceData.depositPaid > 0 ? 'FINAL PAYMENT DUE' : 'FINAL AMOUNT', 360, currentY + 50)
         .fontSize(20)
         .text(`$${invoiceData.finalTotal.toFixed(2)} AUD`, 360, currentY + 65, { width: 185, align: 'right' });

      // Add calculation summary box
      if (invoiceData.depositPaid > 0) {
        doc.rect(50, currentY + 100, 505, 40)
           .fill('#f8fafc')
           .stroke('#e2e8f0', 1);
        
        doc.fillColor('#1e293b')
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('CALCULATION SUMMARY', 60, currentY + 115);
        
        doc.fillColor('#475569')
           .fontSize(10)
           .font('Helvetica')
           .text(invoiceData.calculationBreakdown?.formula || `Final Payment = $${(invoiceData.fullAmountWithGST || invoiceData.total).toFixed(2)} - $${invoiceData.depositPaid.toFixed(2)} = $${invoiceData.finalTotal.toFixed(2)}`, 60, currentY + 130, { width: 485 });
      }

      // Deposit information section (if applicable)
      let paymentSectionY = invoiceData.depositPaid > 0 ? 600 : 560; // Adjust based on calculation summary
      if (invoiceData.depositPaid > 0) {
        doc.fillColor(primaryColor)
           .fontSize(14)
           .font('Helvetica-Bold')
           .text('DEPOSIT INFORMATION', 50, paymentSectionY);
        
        doc.rect(50, paymentSectionY + 10, 505, 50)
           .fill('#f0f9ff')
           .stroke('#0ea5e9', 1);
        
        doc.fillColor('#0c4a6e')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text('Deposit Details:', 60, paymentSectionY + 20);
        
        doc.fillColor('#0369a1')
           .fontSize(9)
           .font('Helvetica')
           .text(`Type: ${invoiceData.depositInfo?.type || 'Fixed'}`, 60, paymentSectionY + 35)
           .text(`Amount Paid: $${invoiceData.depositPaid.toFixed(2)} AUD`, 60, paymentSectionY + 48);
        
        if (invoiceData.depositInfo?.type === 'Percentage') {
          doc.text(`Percentage: ${invoiceData.depositInfo?.value}%`, 300, paymentSectionY + 35);
        }
        
        paymentSectionY += 70; // Move payment section down
      }

      // Payment information
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('PAYMENT INFORMATION', 50, paymentSectionY);
      
      doc.rect(50, paymentSectionY + 10, 505, 60)
         .fill('#ffffff')
         .stroke(secondaryColor, 1);
      
      doc.fillColor(secondaryColor)
         .fontSize(10)
         .font('Helvetica')
         .text('Payment Method: Bank Transfer', 60, paymentSectionY + 20)
         .text('Account Name: Cranbourne Public Hall', 60, paymentSectionY + 35)
         .text('BSB: 123-456', 60, paymentSectionY + 50)
         .text('Account Number: 12345678', 60, paymentSectionY + 65);

      // Notes section (if exists, make it more compact)
      let notesSectionY = paymentSectionY + 80;
      if (invoiceData.notes) {
        doc.fillColor(primaryColor)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('ADDITIONAL NOTES', 50, notesSectionY);
        
        doc.rect(50, notesSectionY + 10, 505, 30)
           .fill('#ffffff')
           .stroke(secondaryColor, 1);
        
        doc.fillColor(secondaryColor)
           .fontSize(9)
           .font('Helvetica')
           .text(invoiceData.notes, 60, notesSectionY + 20, { width: 485 });
        
        notesSectionY += 50;
      }

      // Terms and conditions (more compact)
      doc.fillColor(primaryColor)
         .fontSize(12)
         .font('Helvetica-Bold')
         .text('TERMS & CONDITIONS', 50, notesSectionY);
      
      doc.fillColor(secondaryColor)
         .fontSize(8)
         .font('Helvetica')
         .text('• Payment is due within 30 days of invoice date.', 50, notesSectionY + 15)
         .text('• Late payments may incur additional charges.', 50, notesSectionY + 27)
         .text('• All prices include GST where applicable.', 50, notesSectionY + 39)
         .text('• For payment inquiries, please contact us directly.', 50, notesSectionY + 51);

      // Footer (more compact)
      const footerY = notesSectionY + 80;
      doc.rect(0, footerY, 595, 30)
         .fill(lightGray);
      
      doc.fillColor(secondaryColor)
         .fontSize(7)
         .font('Helvetica')
         .text('Cranbourne Public Hall • Professional Event Management', 50, footerY + 8, { width: 495, align: 'center' })
         .text('Contact: info@cranbournehall.com.au • Phone: (03) 1234 5678', 50, footerY + 18, { width: 495, align: 'center' });
      
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// POST /api/invoices - Create a new invoice from booking
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      bookingId,
      invoiceType, // 'DEPOSIT', 'FINAL', 'BOND', 'ADD-ONS'
      amount,
      description,
      dueDate,
      notes
    } = req.body;

    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!bookingId || !invoiceType || !amount) {
      return res.status(400).json({
        message: 'Missing required fields: bookingId, invoiceType, amount'
      });
    }

    // Validate invoice type
    if (!['DEPOSIT', 'FINAL', 'BOND', 'ADD-ONS'].includes(invoiceType)) {
      return res.status(400).json({
        message: 'Invalid invoice type. Must be one of: DEPOSIT, FINAL, BOND, ADD-ONS'
      });
    }

    // Get booking details
    const bookingDoc = await admin.firestore().collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = bookingData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== bookingData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only create invoices for your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (bookingData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only create invoices for your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can create invoices.' });
    }

    // Check if invoice already exists for this booking and type
    const existingInvoice = await admin.firestore()
      .collection('invoices')
      .where('bookingId', '==', bookingId)
      .where('invoiceType', '==', invoiceType)
      .where('status', 'in', ['DRAFT', 'SENT', 'PARTIAL', 'PAID'])
      .get();

    if (!existingInvoice.empty) {
      return res.status(409).json({
        message: `Invoice of type ${invoiceType} already exists for this booking`
      });
    }

    // Calculate amounts - GST is already included in booking amounts, so we don't add it again
    const subtotal = parseFloat(amount);
    
    // For invoices, the amounts already include GST from booking creation
    // We need to show the breakdown: full amount with GST, deposit amount, and final payment
    let gst = 0;
    let total = subtotal; // Total already includes GST
    let finalTotal = total;
    let depositPaid = 0;
    let depositInfo = null;
    let fullAmountWithGST = subtotal; // This is the full booking amount with GST already included
    
    console.log('Invoice creation - checking deposit info:', {
      invoiceType,
      bookingSource: bookingData.bookingSource,
      depositType: bookingData.depositType,
      depositAmount: bookingData.depositAmount,
      depositValue: bookingData.depositValue
    });
    
    // Apply deposit deduction on FINAL invoices whenever booking has a deposit, regardless of source
    if (invoiceType === 'FINAL' && bookingData.depositType && bookingData.depositType !== 'None') {
      // Get the full quoted total (already includes GST)
      const fullQuotedTotal = req.body.fullQuotedTotal || bookingData.calculatedPrice || bookingData.totalAmount;
      if (fullQuotedTotal && !Number.isNaN(Number(fullQuotedTotal))) {
        fullAmountWithGST = parseFloat(fullQuotedTotal);
        total = fullAmountWithGST;
      }
      
      // Calculate GST from the full amount (reverse calculation)
      // If fullAmountWithGST = subtotal + GST, then GST = fullAmountWithGST - subtotal
      // But since we know GST is 10%, we can calculate: GST = fullAmountWithGST / 1.1 * 0.1
      const baseAmount = fullAmountWithGST / 1.1; // Remove GST to get base amount
      gst = fullAmountWithGST - baseAmount; // Calculate GST amount
      
      depositPaid = req.body.depositAmount !== undefined ? parseFloat(req.body.depositAmount) : (bookingData.depositAmount || 0);
      finalTotal = total - depositPaid;
      
      depositInfo = {
        type: req.body.depositType || bookingData.depositType,
        value: req.body.depositValue !== undefined ? req.body.depositValue : bookingData.depositValue,
        amount: depositPaid
      };
      
      console.log('Final invoice with deposit:', {
        fullAmountWithGST: fullAmountWithGST,
        baseAmount: baseAmount,
        gst: gst,
        depositPaid: depositPaid,
        finalTotal: finalTotal,
        depositInfo: depositInfo
      });
    } else if (invoiceType === 'DEPOSIT' && bookingData.depositType && bookingData.depositType !== 'None') {
      // For deposit invoices, the amount already includes GST
      // Calculate GST from the deposit amount
      const baseAmount = subtotal / 1.1; // Remove GST to get base amount
      gst = subtotal - baseAmount; // Calculate GST amount
      
      const expectedDepositAmount = bookingData.depositAmount || 0;
      if (Math.abs(parseFloat(amount) - expectedDepositAmount) > 0.01) {
        console.log('Warning: Deposit invoice amount does not match expected deposit amount:', {
          invoiceAmount: parseFloat(amount),
          expectedDepositAmount: expectedDepositAmount
        });
      }
      
      console.log('Deposit invoice:', {
        subtotal: subtotal,
        baseAmount: baseAmount,
        gst: gst,
        total: total
      });
    } else {
      // For other invoice types, calculate GST normally
      const baseAmount = subtotal / 1.1; // Remove GST to get base amount
      gst = subtotal - baseAmount; // Calculate GST amount
      total = subtotal;
      
      console.log('Other invoice type:', {
        subtotal: subtotal,
        baseAmount: baseAmount,
        gst: gst,
        total: total
      });
    }

    // Create invoice data
    const invoiceData = {
      invoiceNumber: generateInvoiceNumber(),
      bookingId: bookingId,
      invoiceType: invoiceType,
      customer: {
        name: bookingData.customerName,
        email: bookingData.customerEmail,
        phone: bookingData.customerPhone,
        abn: null // Could be added to customer data later
      },
      hallOwnerId: actualHallOwnerId,
      resource: bookingData.hallName || bookingData.selectedHall,
      bookingSource: bookingData.bookingSource || 'direct', // Store booking source
      quotationId: bookingData.quotationId || null, // Store quotation ID if applicable
      issueDate: new Date(),
      dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      subtotal: subtotal,
      gst: gst,
      total: total,
      fullAmountWithGST: fullAmountWithGST, // Full booking amount with GST included
      finalTotal: finalTotal, // Final amount after deposit deduction
      depositPaid: depositPaid, // Amount already paid as deposit
      depositInfo: depositInfo, // Deposit details
      calculationBreakdown: {
        quotationTotal: subtotal,
        gstAmount: gst,
        totalWithGST: total,
        fullAmountWithGST: fullAmountWithGST,
        depositDeduction: depositPaid,
        finalAmount: finalTotal,
        formula: depositPaid > 0 ? `Final Amount = ${fullAmountWithGST} - ${depositPaid} = ${finalTotal}` : `Final Amount = ${total}`
      },
      paidAmount: 0,
      status: 'DRAFT',
      description: description || `${bookingData.eventType} - ${invoiceType} Payment`,
      lineItems: [
        {
          description: description || `${bookingData.eventType} - ${invoiceType.toLowerCase()} payment`,
          quantity: 1,
          unitPrice: subtotal,
          gstRate: 0.1,
          gstAmount: gst
        }
      ],
      notes: notes || '',
      sentAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('invoices').add(invoiceData);

    console.log('Invoice created successfully:', {
      invoiceId: docRef.id,
      invoiceNumber: invoiceData.invoiceNumber,
      bookingId: bookingId,
      invoiceType: invoiceType,
      total: total
    });

    // Log invoice creation
    const AuditService = require('../services/auditService');
    await AuditService.logInvoiceCreated(
      userId,
      req.user.email,
      userData.role,
      {
        id: docRef.id,
        invoiceNumber: invoiceData.invoiceNumber,
        bookingId: bookingId,
        invoiceType: invoiceType,
        total: total
      },
      ipAddress,
      actualHallOwnerId
    );

    res.status(201).json({
      message: 'Invoice created successfully',
      invoice: {
        id: docRef.id,
        ...invoiceData,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/hall-owner/:hallOwnerId - Get all invoices for a hall owner
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const userId = req.user.uid;

    console.log('Invoice GET - Request params:', { hallOwnerId, userId });
    console.log('Invoice GET - User from token:', req.user);

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    console.log('Invoice GET - User data from Firestore:', userData);
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (userId !== hallOwnerId) {
        console.log('Invoice GET - Access denied: userId !== hallOwnerId', { userId, hallOwnerId });
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }
    
    console.log('Invoice GET - Access granted, actualHallOwnerId:', actualHallOwnerId);

    // Get all invoices for this hall owner
    const invoicesSnapshot = await admin.firestore()
      .collection('invoices')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .get();

    const invoices = await Promise.all(invoicesSnapshot.docs.map(async (doc) => {
      const data = doc.data();
      
      // Fetch booking source from associated booking if bookingId exists
      let bookingSource = data.bookingSource;
      let quotationId = data.quotationId;
      
      if (data.bookingId && !bookingSource) {
        try {
          const bookingDoc = await admin.firestore().collection('bookings').doc(data.bookingId).get();
          if (bookingDoc.exists) {
            const bookingData = bookingDoc.data();
            bookingSource = bookingData.bookingSource;
            quotationId = bookingData.quotationId;
          }
        } catch (error) {
          console.error('Error fetching booking data for invoice:', error);
        }
      }
      
      return {
        id: doc.id,
        ...data,
        bookingSource: bookingSource || 'direct',
        quotationId: quotationId,
        issueDate: data.issueDate?.toDate?.() || null,
        dueDate: data.dueDate?.toDate?.() || null,
        sentAt: data.sentAt?.toDate?.() || null,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    }));

    // Sort invoices by createdAt in descending order (newest first)
    invoices.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    res.json(invoices);

  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/invoices/:id/status - Update invoice status
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate status
    if (!['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID', 'REFUNDED'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: DRAFT, SENT, PARTIAL, PAID, OVERDUE, VOID, REFUNDED'
      });
    }

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    const oldInvoiceData = { ...invoiceData };
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update invoice status.' });
    }

    // Update invoice status
    const updateData = {
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // If marking as sent, set sentAt timestamp
    if (status === 'SENT' && invoiceData.status !== 'SENT') {
      updateData.sentAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await admin.firestore().collection('invoices').doc(id).update(updateData);

    // If status is 'SENT', send email with PDF
    if (status === 'SENT' && invoiceData.status !== 'SENT') {
      try {
        const pdfBuffer = await generateInvoicePDF(invoiceData);
        
        // Send email with PDF attachment
        await emailService.sendInvoiceEmail(invoiceData, pdfBuffer);
        console.log('Invoice email sent successfully to:', invoiceData.customer.email);
      } catch (emailError) {
        console.error('Failed to send invoice email:', emailError);
        // Don't fail the status update if email fails
      }
    }

    // If status changed to PAID, send thank-you email (best-effort)
    if (status === 'PAID' && oldInvoiceData.status !== 'PAID') {
      try {
        const processedInvoiceData = {
          ...oldInvoiceData,
          status: 'PAID',
          issueDate: oldInvoiceData.issueDate?.toDate?.() || new Date(),
          dueDate: oldInvoiceData.dueDate?.toDate?.() || new Date(),
          createdAt: oldInvoiceData.createdAt?.toDate?.() || new Date(),
          updatedAt: new Date()
        };
        await emailService.sendPaymentThankYouEmail(processedInvoiceData);
      } catch (emailError) {
        console.error('Failed to send payment thank-you email:', emailError);
      }
    }

    // Log invoice status update
    const AuditService = require('../services/auditService');
    const newInvoiceData = { ...oldInvoiceData, status: status };
    
    await AuditService.logInvoiceUpdated(
      userId,
      req.user.email,
      userData.role,
      oldInvoiceData,
      newInvoiceData,
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Invoice status updated successfully',
      invoiceId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/invoices/:id/payment - Record payment for invoice
router.put('/:id/payment', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, reference, notes } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate payment amount
    if (!amount || amount <= 0) {
      return res.status(400).json({
        message: 'Payment amount must be greater than 0'
      });
    }

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only record payments for your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only record payments for your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can record payments.' });
    }

    // Calculate new paid amount
    const newPaidAmount = invoiceData.paidAmount + parseFloat(amount);
    const newStatus = newPaidAmount >= invoiceData.total ? 'PAID' : 
                     newPaidAmount > 0 ? 'PARTIAL' : invoiceData.status;

    // Update invoice
    await admin.firestore().collection('invoices').doc(id).update({
      paidAmount: newPaidAmount,
      status: newStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create payment record
    const paymentData = {
      invoiceId: id,
      invoiceNumber: invoiceData.invoiceNumber,
      bookingId: invoiceData.bookingId,
      hallOwnerId: actualHallOwnerId,
      amount: parseFloat(amount),
      paymentMethod: paymentMethod || 'Bank Transfer',
      reference: reference || '',
      notes: notes || '',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const paymentDoc = await admin.firestore().collection('payments').add(paymentData);

    // Log payment recording
    const AuditService = require('../services/auditService');
    await AuditService.logPaymentRecorded(
      userId,
      req.user.email,
      userData.role,
      {
        id: paymentDoc.id,
        invoiceId: id,
        invoiceNumber: invoiceData.invoiceNumber,
        amount: parseFloat(amount),
        paymentMethod: paymentMethod || 'Bank Transfer'
      },
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: 'Payment recorded successfully',
      paymentId: paymentDoc.id,
      invoiceId: id,
      newPaidAmount: newPaidAmount,
      newStatus: newStatus
    });

  } catch (error) {
    console.error('Error recording payment:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/:id - Get a specific invoice
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }

    // Fetch booking source from associated booking if bookingId exists
    let bookingSource = invoiceData.bookingSource;
    let quotationId = invoiceData.quotationId;
    
    if (invoiceData.bookingId && !bookingSource) {
      try {
        const bookingDoc = await admin.firestore().collection('bookings').doc(invoiceData.bookingId).get();
        if (bookingDoc.exists) {
          const bookingData = bookingDoc.data();
          bookingSource = bookingData.bookingSource;
          quotationId = bookingData.quotationId;
        }
      } catch (error) {
        console.error('Error fetching booking data for invoice:', error);
      }
    }

    res.json({
      id: invoiceDoc.id,
      ...invoiceData,
      bookingSource: bookingSource || 'direct',
      quotationId: quotationId,
      issueDate: invoiceData.issueDate?.toDate?.() || null,
      dueDate: invoiceData.dueDate?.toDate?.() || null,
      sentAt: invoiceData.sentAt?.toDate?.() || null,
      createdAt: invoiceData.createdAt?.toDate?.() || null,
      updatedAt: invoiceData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/invoices/send-reminders - Send payment reminders for multiple invoices
router.post('/send-reminders', verifyToken, async (req, res) => {
  try {
    const { invoiceIds, hallOwnerId } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate required fields
    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({
        message: 'invoiceIds array is required and must not be empty'
      });
    }

    if (!hallOwnerId) {
      return res.status(400).json({
        message: 'hallOwnerId is required'
      });
    }

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only send reminders for your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (userId !== hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only send reminders for your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can send reminders.' });
    }

    console.log('Send reminders - Processing invoices:', { invoiceIds, actualHallOwnerId, userId });

    // Fetch all invoices
    const invoicePromises = invoiceIds.map(async (invoiceId) => {
      const invoiceDoc = await admin.firestore().collection('invoices').doc(invoiceId).get();
      if (!invoiceDoc.exists) {
        return { id: invoiceId, error: 'Invoice not found' };
      }
      
      const invoiceData = invoiceDoc.data();
      
      // Verify invoice belongs to the hall owner
      if (invoiceData.hallOwnerId !== actualHallOwnerId) {
        return { id: invoiceId, error: 'Access denied' };
      }
      
      // Check if invoice is eligible for reminders
      if (!['SENT', 'OVERDUE', 'PARTIAL'].includes(invoiceData.status)) {
        return { id: invoiceId, error: `Invoice status '${invoiceData.status}' is not eligible for reminders` };
      }
      
      return { id: invoiceId, data: invoiceData };
    });

    const invoiceResults = await Promise.all(invoicePromises);
    
    // Separate successful and failed invoices
    const validInvoices = invoiceResults.filter(result => !result.error);
    const failedInvoices = invoiceResults.filter(result => result.error);
    
    console.log('Send reminders - Valid invoices:', validInvoices.length);
    console.log('Send reminders - Failed invoices:', failedInvoices.length);

    if (validInvoices.length === 0) {
      return res.status(400).json({
        message: 'No valid invoices found for reminders',
        errors: failedInvoices.map(inv => ({ id: inv.id, error: inv.error }))
      });
    }

    // Send reminder emails
    const emailPromises = validInvoices.map(async (invoiceResult) => {
      try {
        const invoiceData = invoiceResult.data;
        
        // Convert Firestore timestamps to Date objects
        const processedInvoiceData = {
          ...invoiceData,
          issueDate: invoiceData.issueDate?.toDate?.() || new Date(),
          dueDate: invoiceData.dueDate?.toDate?.() || new Date(),
          sentAt: invoiceData.sentAt?.toDate?.() || null,
          createdAt: invoiceData.createdAt?.toDate?.() || new Date(),
          updatedAt: invoiceData.updatedAt?.toDate?.() || new Date()
        };
        
        await emailService.sendInvoiceReminderEmail(processedInvoiceData);
        
        // Update invoice with reminder sent timestamp
        await admin.firestore().collection('invoices').doc(invoiceResult.id).update({
          lastReminderSent: admin.firestore.FieldValue.serverTimestamp(),
          reminderCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Reminder sent successfully for invoice ${invoiceData.invoiceNumber}`);
        return { id: invoiceResult.id, success: true };
      } catch (error) {
        console.error(`❌ Failed to send reminder for invoice ${invoiceResult.id}:`, error);
        return { id: invoiceResult.id, error: error.message };
      }
    });

    const emailResults = await Promise.all(emailPromises);
    
    // Count successful and failed emails
    const sentCount = emailResults.filter(result => result.success).length;
    const failedCount = emailResults.filter(result => result.error).length;
    
    console.log(`Send reminders completed - Sent: ${sentCount}, Failed: ${failedCount}`);

    // Log the reminder sending activity
    const AuditService = require('../services/auditService');
    await AuditService.logInvoiceRemindersSent(
      userId,
      req.user.email,
      userData.role,
      {
        invoiceIds: validInvoices.map(inv => inv.id),
        sentCount: sentCount,
        failedCount: failedCount,
        totalRequested: invoiceIds.length
      },
      ipAddress,
      actualHallOwnerId
    );

    res.json({
      message: `Reminders processed successfully`,
      sentCount: sentCount,
      failedCount: failedCount,
      totalRequested: invoiceIds.length,
      errors: [
        ...failedInvoices.map(inv => ({ id: inv.id, error: inv.error })),
        ...emailResults.filter(result => result.error).map(result => ({ id: result.id, error: result.error }))
      ]
    });

  } catch (error) {
    console.error('Error sending invoice reminders:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/invoices/:id/pdf - Generate and download invoice PDF
router.get('/:id/pdf', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get invoice
    const invoiceDoc = await admin.firestore().collection('invoices').doc(id).get();
    if (!invoiceDoc.exists) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const invoiceData = invoiceDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = invoiceData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      if (actualHallOwnerId !== invoiceData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s invoices.' });
      }
    } else if (userData.role === 'hall_owner') {
      if (invoiceData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own invoices.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view invoices.' });
    }

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(invoiceData);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceData.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating invoice PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
