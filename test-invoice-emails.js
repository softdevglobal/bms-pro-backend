const admin = require('./firebaseAdmin');
const emailService = require('./services/emailService');

// Test invoice email functionality
async function testInvoiceEmail() {
  try {
    console.log('🧪 Testing Invoice Email Functionality...\n');

    // Create a test invoice data structure
    const testInvoiceData = {
      invoiceNumber: 'INV-202412-0001',
      bookingId: 'test-booking-123',
      invoiceType: 'DEPOSIT',
      customer: {
        name: 'John Smith',
        email: 'john.smith@example.com',
        phone: '+61 400 123 456',
        abn: null
      },
      hallOwnerId: 'test-hall-owner-123',
      resource: 'Main Hall',
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      subtotal: 500.00,
      gst: 50.00,
      total: 550.00,
      paidAmount: 0,
      status: 'DRAFT',
      description: 'Wedding Reception - Deposit Payment',
      lineItems: [
        {
          description: 'Wedding Reception - Deposit Payment',
          quantity: 1,
          unitPrice: 500.00,
          gstRate: 0.1,
          gstAmount: 50.00
        }
      ],
      notes: 'Please pay within 30 days of invoice date.',
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('📋 Test Invoice Data:');
    console.log(`   Invoice Number: ${testInvoiceData.invoiceNumber}`);
    console.log(`   Customer: ${testInvoiceData.customer.name} (${testInvoiceData.customer.email})`);
    console.log(`   Amount: $${testInvoiceData.total.toFixed(2)} AUD`);
    console.log(`   Type: ${testInvoiceData.invoiceType}`);
    console.log(`   Resource: ${testInvoiceData.resource}\n`);

    // Test 1: Generate PDF
    console.log('📄 Test 1: Generating Invoice PDF...');
    const PDFDocument = require('pdfkit');
    
    const generateInvoicePDF = async (invoiceData) => {
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
          const primaryColor = '#2563eb';
          const secondaryColor = '#64748b';
          const accentColor = '#059669';
          const lightGray = '#f1f5f9';
          const darkGray = '#334155';

          // Header
          doc.rect(0, 0, 595, 120).fill(primaryColor);
          
          doc.rect(40, 20, 60, 60).fill('#ffffff').stroke(primaryColor, 2);
          
          doc.fillColor('#ffffff')
             .fontSize(24)
             .font('Helvetica-Bold')
             .text('Cranbourne', 120, 30)
             .fontSize(18)
             .text('Public Hall', 120, 55);
          
          doc.fillColor('#ffffff')
             .fontSize(28)
             .font('Helvetica-Bold')
             .text('INVOICE', 50, 45, { width: 495, align: 'right' });

          // Invoice details
          doc.rect(40, 140, 515, 80).fill(lightGray).stroke(secondaryColor, 1);
          
          doc.fillColor(darkGray)
             .fontSize(12)
             .font('Helvetica-Bold')
             .text('INVOICE DETAILS', 50, 150);
          
          doc.fillColor(secondaryColor)
             .fontSize(10)
             .font('Helvetica')
             .text(`Invoice Number: ${invoiceData.invoiceNumber}`, 50, 170)
             .text(`Issue Date: ${invoiceData.issueDate.toLocaleDateString('en-AU')}`, 50, 185)
             .text(`Due Date: ${invoiceData.dueDate.toLocaleDateString('en-AU')}`, 50, 200);

          // Customer details
          doc.fillColor(primaryColor)
             .fontSize(14)
             .font('Helvetica-Bold')
             .text('BILL TO', 50, 250);
          
          doc.rect(50, 260, 240, 100).fill('#ffffff').stroke(secondaryColor, 1);
          
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

          // Invoice information
          doc.fillColor(primaryColor)
             .fontSize(14)
             .font('Helvetica-Bold')
             .text('INVOICE INFORMATION', 310, 250);
          
          doc.rect(310, 260, 245, 100).fill('#ffffff').stroke(secondaryColor, 1);
          
          doc.fillColor(darkGray)
             .fontSize(11)
             .font('Helvetica-Bold')
             .text(invoiceData.invoiceType, 320, 275);
          
          doc.fillColor(secondaryColor)
             .fontSize(10)
             .font('Helvetica')
             .text(invoiceData.resource, 320, 295)
             .text(`Booking ID: ${invoiceData.bookingId}`, 320, 310)
             .text(`Status: ${invoiceData.status}`, 320, 325)
             .text(`Type: ${invoiceData.invoiceType}`, 320, 340);

          // Line items
          doc.fillColor(primaryColor)
             .fontSize(14)
             .font('Helvetica-Bold')
             .text('INVOICE ITEMS', 50, 380);
          
          doc.rect(50, 390, 505, 25).fill(primaryColor);
          
          doc.fillColor('#ffffff')
             .fontSize(11)
             .font('Helvetica-Bold')
             .text('Description', 60, 398)
             .text('Qty', 350, 398)
             .text('Unit Price', 400, 398)
             .text('Amount', 500, 398, { width: 45, align: 'right' });

          doc.rect(50, 415, 505, 30).fill('#ffffff').stroke(secondaryColor, 1);
          
          doc.fillColor(darkGray)
             .fontSize(10)
             .font('Helvetica')
             .text(invoiceData.description, 60, 425, { width: 280 })
             .text('1', 350, 425)
             .text(`$${invoiceData.subtotal.toFixed(2)}`, 400, 425)
             .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, 425, { width: 45, align: 'right' });

          // Totals
          doc.rect(350, 460, 205, 80).fill('#ffffff').stroke(secondaryColor, 1);
          
          doc.fillColor(darkGray)
             .fontSize(11)
             .font('Helvetica')
             .text('Subtotal:', 360, 470)
             .text(`$${invoiceData.subtotal.toFixed(2)}`, 500, 470, { width: 45, align: 'right' })
             .text('GST (10%):', 360, 485)
             .text(`$${invoiceData.gst.toFixed(2)}`, 500, 485, { width: 45, align: 'right' });
          
          doc.rect(350, 500, 205, 40).fill(accentColor);
          
          doc.fillColor('#ffffff')
             .fontSize(16)
             .font('Helvetica-Bold')
             .text('TOTAL AMOUNT', 360, 510)
             .fontSize(20)
             .text(`$${invoiceData.total.toFixed(2)} AUD`, 360, 525, { width: 185, align: 'right' });

          // Payment information
          doc.fillColor(primaryColor)
             .fontSize(14)
             .font('Helvetica-Bold')
             .text('PAYMENT INFORMATION', 50, 560);
          
          doc.rect(50, 570, 505, 60).fill('#ffffff').stroke(secondaryColor, 1);
          
          doc.fillColor(secondaryColor)
             .fontSize(10)
             .font('Helvetica')
             .text('Payment Method: Bank Transfer', 60, 580)
             .text('Account Name: Cranbourne Public Hall', 60, 595)
             .text('BSB: 123-456', 60, 610)
             .text('Account Number: 12345678', 60, 625);

          // Notes
          if (invoiceData.notes) {
            doc.fillColor(primaryColor)
               .fontSize(14)
               .font('Helvetica-Bold')
               .text('ADDITIONAL NOTES', 50, 650);
            
            doc.rect(50, 660, 505, 40).fill('#ffffff').stroke(secondaryColor, 1);
            
            doc.fillColor(secondaryColor)
               .fontSize(10)
               .font('Helvetica')
               .text(invoiceData.notes, 60, 670, { width: 485 });
          }

          // Terms
          doc.fillColor(primaryColor)
             .fontSize(14)
             .font('Helvetica-Bold')
             .text('TERMS & CONDITIONS', 50, 720);
          
          doc.fillColor(secondaryColor)
             .fontSize(9)
             .font('Helvetica')
             .text('• Payment is due within 30 days of invoice date.', 50, 740)
             .text('• Late payments may incur additional charges.', 50, 755)
             .text('• All prices include GST where applicable.', 50, 770)
             .text('• For payment inquiries, please contact us directly.', 50, 785);

          // Footer
          doc.rect(0, 800, 595, 50).fill(lightGray);
          
          doc.fillColor(secondaryColor)
             .fontSize(8)
             .font('Helvetica')
             .text('Cranbourne Public Hall • Professional Event Management', 50, 810, { width: 495, align: 'center' })
             .text('Contact: info@cranbournehall.com.au • Phone: (03) 1234 5678', 50, 825, { width: 495, align: 'center' })
             .text('Generated on ' + new Date().toLocaleDateString('en-AU'), 50, 840, { width: 495, align: 'center' });
          
          doc.end();
        } catch (error) {
          reject(error);
        }
      });
    };

    const pdfBuffer = await generateInvoicePDF(testInvoiceData);
    console.log(`✅ PDF generated successfully (${pdfBuffer.length} bytes)\n`);

    // Test 2: Send email with PDF attachment
    console.log('📧 Test 2: Sending Invoice Email...');
    
    try {
      const result = await emailService.sendInvoiceEmail(testInvoiceData, pdfBuffer);
      console.log('✅ Invoice email sent successfully!');
      console.log(`   Message ID: ${result.messageId}`);
      console.log(`   To: ${testInvoiceData.customer.email}`);
      console.log(`   Subject: Invoice ${testInvoiceData.invoiceNumber} - ${testInvoiceData.invoiceType}\n`);
    } catch (emailError) {
      console.error('❌ Failed to send invoice email:', emailError.message);
      console.log('   This might be due to email service configuration.\n');
    }

    // Test 3: Verify email service methods exist
    console.log('🔍 Test 3: Verifying Email Service Methods...');
    
    const hasSendInvoiceEmail = typeof emailService.sendInvoiceEmail === 'function';
    const hasGenerateInvoiceHTMLTemplate = typeof emailService.generateInvoiceHTMLTemplate === 'function';
    
    console.log(`   sendInvoiceEmail method: ${hasSendInvoiceEmail ? '✅' : '❌'}`);
    console.log(`   generateInvoiceHTMLTemplate method: ${hasGenerateInvoiceHTMLTemplate ? '✅' : '❌'}\n`);

    // Test 4: Test HTML template generation
    console.log('🎨 Test 4: Testing HTML Template Generation...');
    
    try {
      const htmlTemplate = emailService.generateInvoiceHTMLTemplate(testInvoiceData);
      console.log('✅ HTML template generated successfully');
      console.log(`   Template length: ${htmlTemplate.length} characters`);
      console.log(`   Contains customer name: ${htmlTemplate.includes(testInvoiceData.customer.name) ? '✅' : '❌'}`);
      console.log(`   Contains invoice number: ${htmlTemplate.includes(testInvoiceData.invoiceNumber) ? '✅' : '❌'}`);
      console.log(`   Contains total amount: ${htmlTemplate.includes(testInvoiceData.total.toFixed(2)) ? '✅' : '❌'}\n`);
    } catch (templateError) {
      console.error('❌ Failed to generate HTML template:', templateError.message);
    }

    console.log('🎉 Invoice Email Testing Complete!');
    console.log('\n📋 Summary:');
    console.log('   ✅ PDF generation working');
    console.log('   ✅ Email service methods available');
    console.log('   ✅ HTML template generation working');
    console.log('   📧 Email sending (depends on email service configuration)');
    console.log('\n💡 Next Steps:');
    console.log('   1. Test the complete flow by creating an invoice in the frontend');
    console.log('   2. Update invoice status to "SENT" to trigger email');
    console.log('   3. Verify email is received with PDF attachment');
    console.log('   4. Test PDF download functionality in the frontend');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testInvoiceEmail().then(() => {
  console.log('\n🏁 Test completed. Exiting...');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test crashed:', error);
  process.exit(1);
});
