const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { verifyToken } = require('../middleware/authMiddleware');
const https = require('https');
const { createFinalCheckoutLink } = require('../services/stripeService');

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

// HTML-based PDF (Puppeteer) - build HTML string with artistic background
function buildInvoiceHTML(invoiceData) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toDate = (d) => d?.toDate?.() || (d instanceof Date ? d : null);
  const issue = (toDate(invoiceData.issueDate) || new Date()).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const due = (toDate(invoiceData.dueDate) || new Date()).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  const invoiceNo = invoiceData.invoiceNumber || '';
  const type = (invoiceData.invoiceType || 'INVOICE').toUpperCase();
  const heading = type === 'FINAL' ? 'FINAL INVOICE' : `${type} INVOICE`;
  const customerName = invoiceData.customer?.name || '';
  const customerEmail = invoiceData.customer?.email || '';
  const subtotal = Number(invoiceData.subtotal || 0);
  const gst = Number(invoiceData.gst || 0);
  const totalIncl = Number(invoiceData.total || 0);
  const depositPaid = Number(invoiceData.depositPaid || 0);
  const totalDue = Number((depositPaid > 0 && invoiceData.finalTotal) ? invoiceData.finalTotal : totalIncl);
  const taxRate = Number(invoiceData.taxRate ?? 10);
  const taxRateDisplay = Number.isInteger(taxRate) ? String(taxRate) : taxRate.toFixed(2).replace(/\.00$/, '');
  const bookingRef = invoiceData.bookingCode || invoiceData.bookingId || '';
  const companyName = invoiceData.hallOwnerName || 'Cranbourne Public Hall';
  const companyAddress = invoiceData.hallOwnerAddress || '';
  const logoUrl = invoiceData.hallOwnerLogoUrl || 'https://via.placeholder.com/300x90?text=Logo';

  const items = Array.isArray(invoiceData.lineItems) && invoiceData.lineItems.length > 0
    ? invoiceData.lineItems.map(li => ({
        description: li.description || 'Item',
        unit: li.unit || 'Service',
        qty: Number(li.quantity || 1),
        price: Number(li.unitPrice || 0),
        total: Number((li.quantity || 1) * (li.unitPrice || 0))
      }))
    : [{ description: invoiceData.description || `${invoiceData.resource || 'Service'} — ${type} Payment`, unit: 'Service', qty: 1, price: totalIncl, total: totalIncl }];

  const itemsRows = items.map(li => `
      <tr>
        <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;">${li.description}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;">${li.unit}</td>
        <td style="padding:12px 8px;text-align:right;border-bottom:1px solid #e2e8f0;">${Number.isInteger(li.qty) ? li.qty : fmt(li.qty)}</td>
        <td style="padding:12px 8px;text-align:right;border-bottom:1px solid #e2e8f0;">${fmt(li.price)}</td>
        <td style="padding:12px 8px;text-align:right;border-bottom:1px solid #e2e8f0;">${fmt(li.total)}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${heading} — ${companyName}</title>
<style>
  @page { size: A4; margin: 16mm 10mm; }
  body { margin:0; padding:0; font-family: Arial, Helvetica, sans-serif; color:#0f172a; -webkit-print-color-adjust:exact; background:#ffffff; }
  .container { max-width:820px; margin:100px auto; padding:0 40px 40px 40px; box-sizing:border-box; }
  .items { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:25px; }
  .items thead th { text-align:left; padding:10px 8px; color:#fff; background:linear-gradient(90deg,#1f8ea6,#0b6b8a); }
  .items tbody td { padding:12px 8px; border-bottom:1px solid #e2e8f0; }
  .totals { display:flex; justify-content:flex-end; margin-top:10px; }
  .totals .card { width:260px; font-size:13px; }
  .totals .row { display:flex; justify-content:space-between; padding:5px 0; }
  .totals .grand { display:flex; justify-content:space-between; padding:10px 0; border-top:1px solid #e2e8f0; margin-top:6px; font-weight:700; font-size:15px; }
  .hero { margin: 20px 0 26px 0; padding: 22px; border-radius: 14px; background: linear-gradient(90deg,#10b981,#0ea5e9); color:#fff; box-shadow: 0 10px 30px rgba(16,185,129,0.25); }
  .hero .t { text-transform: uppercase; font-size: 12px; letter-spacing: 1.5px; opacity: .9; font-weight: 700; }
  .hero .amt { font-size: 30px; font-weight: 800; margin-top: 6px; }
  .hero .sub { margin-top: 6px; font-size: 12px; opacity: .95; }
  .badges { display:flex; flex-wrap:wrap; gap:8px; margin: 8px 0 16px 0; }
  .chip { display:inline-block; padding:6px 10px; background:#f1f5f9; color:#0f172a; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; }
  .chip-blue { background:#dbeafe; color:#1e40af; border-color:#bfdbfe; }
  .chip-purple { background:#ede9fe; color:#5b21b6; border-color:#ddd6fe; }
</style>
</head>
<body>

<div style="position:fixed;inset:0;z-index:-2;pointer-events:none;">
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 900' preserveAspectRatio='none' style="width:100%;height:100%;">
    <defs>
      <radialGradient id='g1' cx='80%' cy='20%' r='70%'>
        <stop offset='0%' stop-color='#ffeac1' stop-opacity='0.9'/>
        <stop offset='50%' stop-color='#ffd7b2' stop-opacity='0.5'/>
        <stop offset='100%' stop-color='#ffffff' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='g2' cx='10%' cy='80%' r='80%'>
        <stop offset='0%' stop-color='#c8f3ff' stop-opacity='0.8'/>
        <stop offset='50%' stop-color='#b3e7f9' stop-opacity='0.45'/>
        <stop offset='100%' stop-color='#ffffff' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='1200' height='900' fill='url(#g1)'/>
    <rect width='1200' height='900' fill='url(#g2)'/>
    <g opacity='0.15'>
      <path d='M0,300 C200,180 400,120 620,180 C840,240 980,260 1200,200 L1200,900 L0,900 Z' fill='#ffd6b3'/>
      <path d='M0,100 C280,40 520,60 720,120 C860,160 980,180 1200,120 L1200,0 L0,0 Z' fill='#d6f0ff'/>
    </g>
  </svg>
</div>

<img src="https://via.placeholder.com/900x200?text=${encodeURIComponent(companyName)}+Watermark" alt="" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-8deg);opacity:0.05;width:70%;max-width:900px;z-index:-1;">

<div class="container">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:50px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <img src="${logoUrl}" alt="${companyName} Logo" style="width:160px;height:auto;">
      <div>
        <div style="font-weight:700;font-size:16px;">${companyName}</div>
        <div style="font-size:12px;color:#475569;">${companyAddress || ''}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:26px;font-weight:700;letter-spacing:0.5px;">${heading}</div>
      <div style="font-size:13px;margin-top:6px;">Invoice #: <strong>${invoiceNo}</strong></div>
      <div style="font-size:13px;">Date: <strong>${issue}</strong></div>
      <div style="font-size:13px;">Due: <strong>${due}</strong></div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;font-size:13px;color:#23303d;margin-bottom:25px;">
    <div>
      <div style="font-weight:700;">Bill To</div>
      <div>${customerName || 'Client'}</div>
      <div style="font-size:12px;color:#5b6b75;">${customerEmail || ''}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700;">Booking Reference</div>
      <div>${bookingRef}</div>
      <div style="height:8px"></div>
      <div style="font-weight:700;">Payment</div>
      <div>Bank Transfer</div>
      <div style="font-size:12px;color:#5b6b75;">Example Bank – IBAN: LK00 0000 0000 0000</div>
    </div>
  </div>

  <!-- Badges / quick context -->
  <div class="badges">
    <span class="chip">Invoice ${invoiceNo}</span>
    ${bookingRef ? `<span class="chip chip-blue">Booking ${bookingRef}</span>` : ''}
    <span class="chip chip-purple">${heading}</span>
  </div>

  <!-- Eye-catching hero amount -->
  <div class="hero">
    <div class="t">${depositPaid > 0 ? 'Final Payment Due' : 'Total Amount'}</div>
    <div class="amt">$${totalDue.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AUD</div>
    ${depositPaid > 0 ? `<div class="sub">Final Amount = ${totalIncl.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} - ${depositPaid.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} = ${totalDue.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>` : ''}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Description</th>
        <th>Unit</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:right;">Unit Price</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="card">
      <div class="row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
      <div class="row"><span>Tax (${taxRateDisplay}%)</span><span>${fmt(gst)}</span></div>
      ${depositPaid > 0 ? `<div class="row"><span>Deposit Paid</span><span>- ${fmt(depositPaid)}</span></div>` : ''}
      <div class="grand"><span>Total Due</span><span>${fmt(totalDue)}</span></div>
    </div>
  </div>

  ${invoiceData.stripePaymentUrl ? `
  <div style="text-align:center;margin:18px 0 6px;">
    <a href="${invoiceData.stripePaymentUrl}" style="background:#0ea5e9;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">
      Pay Final Amount Online
    </a>
  </div>
  ` : ''}

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:50px;font-size:12px;color:#475569;">
    <div>
      <div style="font-weight:700;margin-bottom:6px;">Notes & Terms</div>
      <div>${invoiceData.notes || 'Thank you for your business. Payment due within 14 days. Please include invoice number when paying.'}</div>
    </div>
    <div style="text-align:right;">
      <div>Authorized by</div>
      <div style="font-weight:700;margin-top:15px;color:#0f172a;">${invoiceData.authorizedBy || 'Authorized Officer'}</div>
      <div>${companyName}</div>
    </div>
  </div>

</div>

</body>
</html>`;
}

async function tryGenerateHtmlPDF(invoiceData) {
  try {
    const puppeteer = require('puppeteer');
    // Best-effort enrich with bookingCode for reference if not already present
    if (!invoiceData.bookingCode && invoiceData.bookingId) {
      try {
        const admin = require('../firebaseAdmin');
        const bookingDoc = await admin.firestore().collection('bookings').doc(invoiceData.bookingId).get();
        if (bookingDoc.exists) {
          const bookingData = bookingDoc.data();
          if (bookingData.bookingCode) invoiceData.bookingCode = bookingData.bookingCode;
        }
      } catch (_e) {
        // ignore enrichment errors; proceed without bookingCode
      }
    }
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const html = buildInvoiceHTML(invoiceData);
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '10mm', right: '10mm' } });
    await browser.close();
    return buffer;
  } catch (e) {
    throw e;
  }
}

// Helper function to generate invoice PDF with PDFKit (fallback)
async function generateInvoicePDF_PDFKit(invoiceData) {
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
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const margin = 40;

      // Helper: page background gradient
      const drawPageBackground = () => {
        const bg = doc.linearGradient(0, 0, pageWidth, pageHeight);
        bg.stop(0, '#f8fafc');
        bg.stop(1, '#eef2ff');
        doc.rect(0, 0, pageWidth, pageHeight).fill(bg);
      };
      drawPageBackground();
      doc.on('pageAdded', drawPageBackground);

      // (Background handled above in HTML version; here minimal background is drawn via gradient header only)

      // Header gradient strip
      const headerGradient = doc.linearGradient(0, 0, 595, 120);
      headerGradient.stop(0, primaryColor);
      headerGradient.stop(1, '#4338ca');
      doc.rect(0, 0, 595, 120).fill(headerGradient);
      
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

      // Invoice banner card
      doc.roundedRect(40, 140, 515, 80, 8)
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
           , 50, 200)
         .text(`Booking Reference: ${invoiceData.bookingCode || invoiceData.bookingId || ''}`, 320, 170); // added booking reference

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

      // Invoice summary cells
      const summaryY = invoiceData.bookingSource === 'quotation' ? 440 : 370;
      const cellWidth = Math.floor(505 / 4);
      const cellLabels = ['Full Amount (incl. GST)', 'Deposit Paid', 'Final Due', 'Tax'];
      const fullAmount = (invoiceData.fullAmountWithGST || invoiceData.total) || 0;
      const depositAmount = Number(invoiceData.depositPaid || 0);
      const finalDue = Number((invoiceData.depositPaid > 0 ? invoiceData.finalTotal : invoiceData.total) || 0);
      const taxDisplay = `${invoiceData.taxType || 'Inclusive'} (${invoiceData.taxRate ?? 10}%)`;
      const cellValues = [
        `$${fullAmount.toFixed(2)} AUD`,
        `$${depositAmount.toFixed(2)} AUD`,
        `$${finalDue.toFixed(2)} AUD`,
        taxDisplay
      ];
      for (let i = 0; i < 4; i++) {
        const x = 50 + i * cellWidth;
        doc.roundedRect(x, summaryY, cellWidth - (i === 3 ? 0 : 6), 60, 8)
           .fill('#ffffff')
           .stroke('#e2e8f0', 1);
        doc.fillColor('#64748b').font('Helvetica').fontSize(8).text(cellLabels[i], x + 10, summaryY + 10, { width: cellWidth - 20, align: 'left' });
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text(cellValues[i], x + 10, summaryY + 26, { width: cellWidth - 20, align: 'left' });
      }

      // Line items table
      const itemsTitleY = summaryY + 80;
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('INVOICE ITEMS', 50, itemsTitleY);
      
      // Table header
      const tableStartY = itemsTitleY + 10;
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
      doc.roundedRect(50, tableStartY + 25, 505, 30, 6)
         .fill('#ffffff')
         .stroke('#cbd5e1', 1);
      
      doc.fillColor(darkGray)
         .fontSize(10)
         .font('Helvetica')
         .text(invoiceData.description, 60, tableStartY + 35, { width: 280 })
         .text('1', 350, tableStartY + 35)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 400, tableStartY + 35)
         .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, tableStartY + 35, { width: 45, align: 'right' });

      // Totals section card
      let currentY = tableStartY + 70; // Position after table
      const totalsHeight = invoiceData.depositPaid > 0 ? 130 : 100; // Extra space for tax details
      
      doc.roundedRect(350, currentY, 205, totalsHeight, 8)
         .fill('#ffffff')
         .stroke('#e2e8f0', 1);
      
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

        // Tax details
        doc.fillColor(darkGray)
           .fontSize(10)
           .font('Helvetica')
           .text(`Tax Type: ${invoiceData.taxType || 'Inclusive'}`, 360, currentY + 55)
           .text(`GST (${(invoiceData.taxRate ?? 10)}%):`, 360, currentY + 70)
           .text(`$${(invoiceData.gst ?? 0).toFixed(2)}`, 500, currentY + 70, { width: 45, align: 'right' });

        currentY += 50; // Extra space for deposit line, calculation, and tax details
      } else {
        // For invoices without deposits, show normal breakdown
        doc.fillColor(darkGray)
           .fontSize(11)
           .font('Helvetica')
           .text('Subtotal:', 360, currentY + 10)
           .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, currentY + 10, { width: 45, align: 'right' })
           .text(`GST (${(invoiceData.taxRate ?? 10)}%):`, 360, currentY + 25)
           .text(`$${invoiceData.gst.toFixed(2)}`, 500, currentY + 25, { width: 45, align: 'right' })
           .fontSize(10)
           .text(`Tax Type: ${invoiceData.taxType || 'Inclusive'}`, 360, currentY + 40);
      }
      
      doc.roundedRect(350, currentY + 40, 205, 40, 8)
         .fill(accentColor);
      
      doc.fillColor('#ffffff')
         .fontSize(16)
         .font('Helvetica-Bold')
         .text(invoiceData.depositPaid > 0 ? 'FINAL PAYMENT DUE' : 'FINAL AMOUNT', 360, currentY + 50)
         .fontSize(20)
         .text(`$${invoiceData.finalTotal.toFixed(2)} AUD`, 360, currentY + 65, { width: 185, align: 'right' });

      // Large FINAL DUE banner centered (ensure it stays on current page)
      let bannerY = currentY + (invoiceData.depositPaid > 0 ? 90 : 70);
      if (bannerY + 150 > pageHeight - margin) {
        doc.addPage();
        // new page background auto-drawn via pageAdded handler
        bannerY = margin + 40;
      }
      const bannerGradient = doc.linearGradient(50, bannerY, 555, bannerY);
      bannerGradient.stop(0, '#16a34a');
      bannerGradient.stop(1, '#0ea5e9');
      doc.roundedRect(50, bannerY, 505, 60, 12).fill(bannerGradient);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(14)
         .text(invoiceData.depositPaid > 0 ? 'FINAL PAYMENT DUE' : 'TOTAL DUE', 60, bannerY + 10, { width: 485, align: 'center' });
      doc.fontSize(24)
         .text(`$${(invoiceData.finalTotal || invoiceData.total).toFixed(2)} AUD`, 60, bannerY + 28, { width: 485, align: 'center' });

      // Calculation summary below banner (if deposit exists)
      if (invoiceData.depositPaid > 0) {
        doc.roundedRect(50, bannerY + 70, 505, 34, 8)
           .fill('#f8fafc')
           .stroke('#e2e8f0', 1);
        doc.fillColor('#64748b').font('Helvetica').fontSize(9)
           .text(
             invoiceData.calculationBreakdown?.formula || `Final Payment = $${(invoiceData.fullAmountWithGST || invoiceData.total).toFixed(2)} - $${invoiceData.depositPaid.toFixed(2)} = $${invoiceData.finalTotal.toFixed(2)}`,
             60,
             bannerY + 82,
             { width: 485, align: 'center' }
           );
      }

      // Deposit information section (if applicable)
      let paymentSectionY = (invoiceData.depositPaid > 0 ? (bannerY + 115) : (bannerY + 30));
      if (paymentSectionY + 180 > pageHeight - margin) {
        doc.addPage();
        paymentSectionY = margin + 10;
      }
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
        
        paymentSectionY += 80; // Move payment section down
      }

      // Payment information
      doc.fillColor(primaryColor)
         .fontSize(14)
         .font('Helvetica-Bold')
         .text('PAYMENT INFORMATION', 50, paymentSectionY);
      
      doc.roundedRect(50, paymentSectionY + 10, 505, 60, 8)
         .fill('#ffffff')
         .stroke('#e2e8f0', 1);
      
  doc.fillColor(secondaryColor)
     .fontSize(10)
     .font('Helvetica')
     .text('Payment Method: Bank Transfer', 60, paymentSectionY + 20)
     .text('Account Name: Cranbourne Public Hall', 60, paymentSectionY + 35)
     .text('BSB: 123-456', 60, paymentSectionY + 50)
     .text('Account Number: 12345678', 60, paymentSectionY + 65);

  if (invoiceData.stripePaymentUrl) {
    const btnX = 60;
    const btnY = paymentSectionY + 85;
    const btnW = 220;
    const btnH = 26;
    // Button background
    const btnGrad = doc.linearGradient(btnX, btnY, btnX + btnW, btnY);
    btnGrad.stop(0, '#0ea5e9');
    btnGrad.stop(1, '#10b981');
    doc.roundedRect(btnX, btnY, btnW, btnH, 6).fill(btnGrad);
    // Button label
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold')
       .fontSize(10)
       .text('Pay Final Amount Online', btnX, btnY + 8, { width: btnW, align: 'center' });
    // Clickable area
    doc.link(btnX, btnY, btnW, btnH, invoiceData.stripePaymentUrl);
  }

      // Notes section (if exists, make it more compact)
      let notesSectionY = paymentSectionY + (invoiceData.stripePaymentUrl ? 120 : 80);
      if (invoiceData.notes) {
        doc.fillColor(primaryColor)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text('ADDITIONAL NOTES', 50, notesSectionY);
        
        doc.roundedRect(50, notesSectionY + 10, 505, 30, 8)
           .fill('#ffffff')
           .stroke('#e2e8f0', 1);
        
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

// Wrapper: try HTML-based first, then fallback
async function generateInvoicePDF(invoiceData) {
  try {
    return await tryGenerateHtmlPDF(invoiceData);
  } catch (e) {
    console.warn('HTML renderer unavailable, falling back to PDFKit:', e?.message || e);
    return await generateInvoicePDF_PDFKit(invoiceData);
  }
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
    // Resolve tax metadata for display
    let taxType = 'Inclusive';
    let taxRatePct = 10;
    try {
      const hoDoc = await admin.firestore().collection('users').doc(actualHallOwnerId).get();
      const hallSettings = hoDoc?.data?.() ? hoDoc.data().settings : null;
      if (hallSettings) {
        if (typeof hallSettings.taxType === 'string' && ['Inclusive', 'Exclusive'].includes(hallSettings.taxType)) {
          taxType = hallSettings.taxType;
        }
        if (Number.isFinite(Number(hallSettings.taxRate))) {
          taxRatePct = Number(hallSettings.taxRate);
        }
      }
    } catch (_) {
      // best-effort
    }
    // Prefer explicit booking payment_details.tax if present
    if (bookingData?.payment_details?.tax) {
      const taxObj = bookingData.payment_details.tax;
      if (typeof taxObj.tax_type === 'string') taxType = String(taxObj.tax_type);
      if (Number.isFinite(Number(taxObj.gst))) gst = Number(taxObj.gst);
    }
    
    console.log('Invoice creation - checking deposit info:', {
      invoiceType,
      bookingSource: bookingData.bookingSource,
      depositType: bookingData.depositType,
      depositAmount: bookingData.depositAmount,
      depositValue: bookingData.depositValue
    });
    
    // Apply deposit deduction on FINAL invoices whenever booking has a deposit (either legacy fields or unified payment_details)
    if (invoiceType === 'FINAL' && ((bookingData.depositType && bookingData.depositType !== 'None') || (bookingData.payment_details && Number(bookingData.payment_details.deposit_amount) > 0))) {
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
      
      // Prefer unified payment_details.deposit_amount when present
      depositPaid = req.body.depositAmount !== undefined
        ? parseFloat(req.body.depositAmount)
        : (Number(bookingData.payment_details?.deposit_amount) || bookingData.depositAmount || 0);
      finalTotal = total - depositPaid;
      
      // Ensure no undefined values are saved to Firestore (use null instead)
      const resolvedDepositType = req.body.depositType || bookingData.payment_details?.deposit_type || bookingData.depositType || 'Fixed';
      const resolvedDepositValue = (req.body.depositValue !== undefined)
        ? req.body.depositValue
        : (bookingData.depositValue !== undefined ? bookingData.depositValue : null);

      depositInfo = {
        type: resolvedDepositType,
        value: resolvedDepositValue,
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
      const baseAmount = subtotal / (1 + (taxRatePct / 100)); // Remove GST to get base amount
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
      const baseAmount = subtotal / (1 + (taxRatePct / 100)); // Remove GST to get base amount
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
      bookingCode: bookingData.bookingCode || null,
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
      taxType: taxType,
      taxRate: taxRatePct,
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
      let bookingCode = data.bookingCode;
      
      if (data.bookingId && (!bookingSource || !bookingCode)) {
        try {
          const bookingDoc = await admin.firestore().collection('bookings').doc(data.bookingId).get();
          if (bookingDoc.exists) {
            const bookingData = bookingDoc.data();
            bookingSource = bookingData.bookingSource;
            quotationId = bookingData.quotationId;
            bookingCode = bookingData.bookingCode || bookingCode;
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
        bookingCode: bookingCode || null,
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
      // Create Stripe FINAL payment link when enabled
      let stripePaymentUrl = invoiceData.stripePaymentUrl || null;
      try {
        const ownerSnap = await admin.firestore().collection('users').doc(actualHallOwnerId).get();
        const pm = ownerSnap.exists ? (ownerSnap.data().paymentMethods || {}) : {};
        const stripeEnabled = Boolean(pm.stripe);
        const amountToPay = Number(invoiceData.depositPaid > 0 ? (invoiceData.finalTotal ?? 0) : (invoiceData.total ?? 0));
        if (stripeEnabled && amountToPay > 0) {
          const url = await createFinalCheckoutLink({
            hallOwnerId: actualHallOwnerId,
            bookingId: invoiceData.bookingId,
            invoiceId: id,
            invoiceNumber: invoiceData.invoiceNumber,
            bookingCode: invoiceData.bookingCode,
            customerName: invoiceData.customer?.name,
            hallName: invoiceData.resource,
            finalAmount: amountToPay,
            stripeAccountId: ownerSnap.exists ? ownerSnap.data().stripeAccountId : undefined
          });
          if (url) {
            stripePaymentUrl = url;
            await admin.firestore().collection('invoices').doc(id).update({
              stripePaymentUrl: url,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            // Also attach to booking.payment_details
            if (invoiceData.bookingId) {
              try {
                const bookingRef = admin.firestore().collection('bookings').doc(invoiceData.bookingId);
                const snap = await bookingRef.get();
                if (snap.exists) {
                  const pd = Object.assign({}, snap.data().payment_details || {});
                  pd.stripe_payment_url_final = url;
                  await bookingRef.update({ 
                    payment_details: pd, 
                    stripePaymentUrlFinal: url,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp() 
                  });
                }
              } catch (e) {
                console.warn('Failed to save final Stripe link on booking (non-blocking):', e?.message || e);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Stripe FINAL link generation skipped:', e?.message || e);
      }

      const processed = {
        ...invoiceData,
        stripePaymentUrl,
        issueDate: invoiceData.issueDate?.toDate?.() || new Date(),
        dueDate: invoiceData.dueDate?.toDate?.() || new Date(),
        createdAt: invoiceData.createdAt?.toDate?.() || new Date(),
        updatedAt: new Date()
      };
      const pdfBuffer = await generateInvoicePDF(processed);
      
      // Send email with PDF attachment
      await emailService.sendInvoiceEmail(processed, pdfBuffer);
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
      bookingCode: invoiceData.bookingCode || (await (async () => {
        try {
          if (invoiceData.bookingId) {
            const bookingDoc = await admin.firestore().collection('bookings').doc(invoiceData.bookingId).get();
            return bookingDoc.exists ? (bookingDoc.data().bookingCode || null) : null;
          }
          return null;
        } catch (_) {
          return null;
        }
      })()),
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
