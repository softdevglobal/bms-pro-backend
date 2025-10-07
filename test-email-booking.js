const emailService = require('./services/emailService');

async function testBookingEmail() {
  console.log('🧪 Testing booking email notification...');
  
  try {
    const testNotificationData = {
      type: 'booking_submitted',
      title: 'Booking Request Submitted',
      message: 'Your booking request for Wedding on 2024-01-15 has been submitted successfully. Estimated cost: $350.00. We\'ll get back to you soon with confirmation.',
      data: {
        bookingId: 'TEST-BOOKING-123',
        eventType: 'Wedding',
        bookingDate: '2024-01-15',
        startTime: '14:00',
        endTime: '22:00',
        calculatedPrice: 350.00,
        hallName: 'Main Hall'
      }
    };

    const testEmail = 'test@example.com'; // Replace with a real email for testing
    
    console.log('📧 Sending test email to:', testEmail);
    const result = await emailService.sendNotificationEmail(testNotificationData, testEmail);
    
    console.log('✅ Test email sent successfully!');
    console.log('📧 Message ID:', result.messageId);
    
  } catch (error) {
    console.error('❌ Test email failed:', error);
  }
}

async function testCustomizedEmail() {
  console.log('🧪 Testing customized email...');
  
  try {
    const testEmailData = {
      to: 'test@example.com', // Replace with a real email for testing
      subject: 'Booking Request Submitted - Wedding',
      body: `Dear Test User,

Your booking request for Wedding on 2024-01-15 has been submitted successfully.

Booking Details:
- Event: Wedding
- Date: 2024-01-15
- Time: 14:00 - 22:00
- Resource: Main Hall
- Booking ID: TEST-BOOKING-123

We'll get back to you soon with confirmation.

Thank you for choosing Cranbourne Public Hall!`,
      recipientName: 'Test User',
      bookingId: 'TEST-BOOKING-123',
      templateName: 'booking_submitted_fallback',
      isCustom: true
    };

    console.log('📧 Sending test customized email...');
    const result = await emailService.sendCustomizedEmail(testEmailData);
    
    console.log('✅ Test customized email sent successfully!');
    console.log('📧 Message ID:', result.messageId);
    
  } catch (error) {
    console.error('❌ Test customized email failed:', error);
  }
}

async function runTests() {
  console.log('🚀 Starting email notification tests...\n');
  
  await testBookingEmail();
  console.log('\n' + '='.repeat(50) + '\n');
  await testCustomizedEmail();
  
  console.log('\n✅ All email tests completed!');
  process.exit(0);
}

runTests().catch(console.error);
