const emailService = require('./services/emailService');

async function testEmailNotifications() {
  try {
    console.log('🧪 Testing email notification system...\n');

    // Test 1: Basic email service connection
    console.log('1️⃣ Testing email service connection...');
    await emailService.verifyConnection();
    console.log('✅ Email service connection verified\n');

    // Test 2: Send test email
    console.log('2️⃣ Sending test email...');
    const testEmail = 'pawankanchana34741@gmail.com'; // Using the same email as sender for testing
    await emailService.sendTestEmail(testEmail);
    console.log('✅ Test email sent successfully\n');

    // Test 3: Send booking submission notification
    console.log('3️⃣ Testing booking submission notification...');
    const bookingSubmissionNotification = {
      type: 'booking_submitted',
      title: 'Booking Request Submitted',
      message: 'Your booking request for Wedding Reception on 2024-02-14 has been submitted successfully. Estimated cost: $450.00. We\'ll get back to you soon with confirmation.',
      data: {
        bookingId: 'TEST-BOOKING-001',
        eventType: 'Wedding Reception',
        bookingDate: '2024-02-14',
        startTime: '6:00 PM',
        endTime: '11:00 PM',
        calculatedPrice: 450.00,
        hallName: 'Main Hall'
      }
    };
    
    await emailService.sendNotificationEmail(bookingSubmissionNotification, testEmail);
    console.log('✅ Booking submission notification sent\n');

    // Test 4: Send booking confirmation notification
    console.log('4️⃣ Testing booking confirmation notification...');
    const bookingConfirmationNotification = {
      type: 'booking_confirmed',
      title: 'Booking Confirmed!',
      message: 'Great news! Your booking for Wedding Reception on 2024-02-14 has been confirmed. We look forward to hosting your event!',
      data: {
        bookingId: 'TEST-BOOKING-001',
        eventType: 'Wedding Reception',
        bookingDate: '2024-02-14',
        startTime: '6:00 PM',
        endTime: '11:00 PM',
        calculatedPrice: 450.00,
        hallName: 'Main Hall'
      }
    };
    
    await emailService.sendNotificationEmail(bookingConfirmationNotification, testEmail);
    console.log('✅ Booking confirmation notification sent\n');

    // Test 5: Send booking cancellation notification
    console.log('5️⃣ Testing booking cancellation notification...');
    const bookingCancellationNotification = {
      type: 'booking_cancelled',
      title: 'Booking Cancelled',
      message: 'Your booking for Wedding Reception on 2024-02-14 has been cancelled. Please contact us if you have any questions.',
      data: {
        bookingId: 'TEST-BOOKING-001',
        eventType: 'Wedding Reception',
        bookingDate: '2024-02-14',
        startTime: '6:00 PM',
        endTime: '11:00 PM',
        calculatedPrice: 450.00,
        hallName: 'Main Hall'
      }
    };
    
    await emailService.sendNotificationEmail(bookingCancellationNotification, testEmail);
    console.log('✅ Booking cancellation notification sent\n');

    // Test 6: Send price update notification
    console.log('6️⃣ Testing price update notification...');
    const priceUpdateNotification = {
      type: 'booking_price_updated',
      title: 'Booking Price Updated',
      message: 'The price for your Wedding Reception booking on 2024-02-14 has been updated to $500.00. Please review the updated pricing details.',
      data: {
        bookingId: 'TEST-BOOKING-001',
        eventType: 'Wedding Reception',
        bookingDate: '2024-02-14',
        startTime: '6:00 PM',
        endTime: '11:00 PM',
        calculatedPrice: 500.00,
        previousPrice: 450.00,
        hallName: 'Main Hall'
      }
    };
    
    await emailService.sendNotificationEmail(priceUpdateNotification, testEmail);
    console.log('✅ Price update notification sent\n');

    console.log('🎉 All email notification tests completed successfully!');
    console.log('\n📧 Check your email inbox for the test emails.');
    console.log('📝 Each email should have:');
    console.log('   - Professional HTML formatting');
    console.log('   - Cranbourne Public Hall branding');
    console.log('   - Booking details table');
    console.log('   - Appropriate action button');
    console.log('   - Responsive design');

  } catch (error) {
    console.error('❌ Email notification test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testEmailNotifications();
