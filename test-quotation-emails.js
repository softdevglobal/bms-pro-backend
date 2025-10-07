const EmailService = require('./services/emailService');

async function testQuotationEmails() {
  console.log('🧪 Testing Quotation Email Notifications...\n');

  try {
    // Test booking confirmation email
    console.log('1. Testing Booking Confirmation Email...');
    await EmailService.sendBookingConfirmationEmail({
      customerName: 'John Smith',
      customerEmail: 'pawankanchana99@gmail.com', // Use your email for testing
      eventType: 'Birthday Party',
      resource: 'Main Hall',
      eventDate: '2025-02-15',
      startTime: '10:00',
      endTime: '14:00',
      guestCount: 50,
      totalAmount: 600.00,
      bookingId: 'BOOK-123456',
      quotationId: 'QUO-789012',
      notes: 'Please ensure the hall is decorated with birthday theme.'
    });
    console.log('✅ Booking confirmation email sent successfully!\n');

    // Test quotation decline email
    console.log('2. Testing Quotation Decline Email...');
    await EmailService.sendQuotationDeclineEmail({
      customerName: 'Jane Doe',
      customerEmail: 'pawankanchana99@gmail.com', // Use your email for testing
      eventType: 'Wedding Reception',
      resource: 'Main Hall',
      eventDate: '2025-03-20',
      quotationId: 'QUO-345678'
    });
    console.log('✅ Quotation decline email sent successfully!\n');

    console.log('🎉 All email tests completed successfully!');
    console.log('📧 Check your email inbox for the test emails.');

  } catch (error) {
    console.error('❌ Email test failed:', error);
  }
}

// Run the test
testQuotationEmails();
