const AuditService = require('./services/auditService');

// Test audit logging functionality
async function testAuditLogging() {
  console.log('Testing Audit Logging Service...\n');

  try {
    // Test 1: Log user login
    console.log('1. Testing user login logging...');
    await AuditService.logUserLogin(
      'test-user-123',
      'test@example.com',
      'hall_owner',
      '192.168.1.100',
      'hall-123'
    );
    console.log('✅ User login logged successfully');

    // Test 2: Log user creation
    console.log('\n2. Testing user creation logging...');
    await AuditService.logUserCreated(
      'admin-123',
      'admin@example.com',
      'super_admin',
      {
        email: 'newuser@example.com',
        role: 'hall_owner',
        name: 'New User',
        hallName: 'Test Hall'
      },
      '192.168.1.100',
      null
    );
    console.log('✅ User creation logged successfully');

    // Test 3: Log booking creation
    console.log('\n3. Testing booking creation logging...');
    await AuditService.logBookingCreated(
      'customer-123',
      'customer@example.com',
      'customer',
      {
        id: 'booking-123',
        customerName: 'John Doe',
        eventDate: '2025-01-15',
        status: 'pending',
        totalAmount: 500
      },
      '192.168.1.100',
      'hall-123'
    );
    console.log('✅ Booking creation logged successfully');

    // Test 4: Log booking confirmation
    console.log('\n4. Testing booking confirmation logging...');
    await AuditService.logBookingConfirmed(
      'hall-owner-123',
      'owner@example.com',
      'hall_owner',
      {
        id: 'booking-123',
        customerName: 'John Doe',
        eventDate: '2025-01-15',
        status: 'pending',
        totalAmount: 500
      },
      '192.168.1.100',
      'hall-123'
    );
    console.log('✅ Booking confirmation logged successfully');

    // Test 5: Log hall settings update
    console.log('\n5. Testing hall settings update logging...');
    await AuditService.logHallSettingsUpdated(
      'hall-owner-123',
      'owner@example.com',
      'hall_owner',
      {
        hallName: 'Old Hall Name',
        contactNumber: '123-456-7890',
        address: { line1: 'Old Address', postcode: '12345', state: 'Old State' },
        status: 'active'
      },
      {
        hallName: 'New Hall Name',
        contactNumber: '123-456-7890',
        address: { line1: 'New Address', postcode: '54321', state: 'New State' },
        status: 'active'
      },
      '192.168.1.100',
      'hall-123'
    );
    console.log('✅ Hall settings update logged successfully');

    // Test 6: Log pricing update
    console.log('\n6. Testing pricing update logging...');
    await AuditService.logPricingUpdated(
      'hall-owner-123',
      'owner@example.com',
      'hall_owner',
      {
        baseRate: 100,
        peakRate: 150,
        weekendRate: 200,
        addonRates: { catering: 50, decoration: 75 }
      },
      {
        baseRate: 120,
        peakRate: 180,
        weekendRate: 240,
        addonRates: { catering: 60, decoration: 90 }
      },
      '192.168.1.100',
      'hall-123'
    );
    console.log('✅ Pricing update logged successfully');

    console.log('\n🎉 All audit logging tests completed successfully!');
    console.log('\nYou can now check the Firestore "audit_logs" collection to see the logged events.');

  } catch (error) {
    console.error('❌ Error during audit logging tests:', error);
  }
}

// Run the tests
testAuditLogging().then(() => {
  console.log('\nTest completed. Exiting...');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
