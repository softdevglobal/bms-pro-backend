const AuditService = require('./services/auditService');

// Test audit logging for hall owner and sub-user relationship
async function testHallOwnerAuditLogging() {
  console.log('Testing Hall Owner and Sub-User Audit Logging...\n');

  const hallOwnerId = 'hall-owner-123';
  const subUserId = 'sub-user-456';
  const hallId = hallOwnerId; // For hall owners, their ID is the hall ID

  try {
    // Test 1: Hall owner performs an action
    console.log('1. Testing hall owner action logging...');
    await AuditService.logHallSettingsUpdated(
      hallOwnerId,
      'owner@example.com',
      'hall_owner',
      {
        hallName: 'Test Hall',
        contactNumber: '123-456-7890',
        address: { line1: '123 Main St', postcode: '12345', state: 'Test State' },
        status: 'active'
      },
      {
        hallName: 'Test Hall Updated',
        contactNumber: '123-456-7890',
        address: { line1: '123 Main St Updated', postcode: '12345', state: 'Test State' },
        status: 'active'
      },
      '192.168.1.100',
      hallId
    );
    console.log('✅ Hall owner action logged successfully');

    // Test 2: Sub-user performs an action (should be associated with hall owner's hall)
    console.log('\n2. Testing sub-user action logging...');
    await AuditService.logBookingConfirmed(
      subUserId,
      'subuser@example.com',
      'sub_user',
      {
        id: 'booking-789',
        customerName: 'Jane Doe',
        eventDate: '2025-01-20',
        status: 'pending',
        totalAmount: 750
      },
      '192.168.1.101',
      hallId // This should be the hall owner's ID
    );
    console.log('✅ Sub-user action logged successfully');

    // Test 3: Another sub-user performs an action
    console.log('\n3. Testing another sub-user action logging...');
    await AuditService.logBookingCreated(
      'sub-user-789',
      'subuser2@example.com',
      'sub_user',
      {
        id: 'booking-999',
        customerName: 'Bob Smith',
        eventDate: '2025-01-25',
        status: 'pending',
        totalAmount: 600
      },
      '192.168.1.102',
      hallId // This should be the hall owner's ID
    );
    console.log('✅ Second sub-user action logged successfully');

    // Test 4: Hall owner creates a sub-user
    console.log('\n4. Testing hall owner creating sub-user...');
    await AuditService.logUserCreated(
      hallOwnerId,
      'owner@example.com',
      'hall_owner',
      {
        email: 'newsubuser@example.com',
        role: 'sub_user',
        name: 'New Sub User',
        hallName: 'Test Hall'
      },
      '192.168.1.100',
      hallId
    );
    console.log('✅ Sub-user creation logged successfully');

    // Test 5: Sub-user updates booking
    console.log('\n5. Testing sub-user updating booking...');
    await AuditService.logBookingUpdated(
      subUserId,
      'subuser@example.com',
      'sub_user',
      {
        id: 'booking-789',
        customerName: 'Jane Doe',
        eventDate: '2025-01-20',
        status: 'pending',
        totalAmount: 750
      },
      {
        id: 'booking-789',
        customerName: 'Jane Doe Updated',
        eventDate: '2025-01-20',
        status: 'confirmed',
        totalAmount: 800
      },
      '192.168.1.101',
      hallId
    );
    console.log('✅ Sub-user booking update logged successfully');

    console.log('\n🎉 All hall owner and sub-user audit logging tests completed!');
    console.log('\n📋 Summary:');
    console.log(`   - Hall Owner ID: ${hallOwnerId}`);
    console.log(`   - Hall ID: ${hallId}`);
    console.log(`   - Sub-User 1 ID: ${subUserId}`);
    console.log(`   - Sub-User 2 ID: sub-user-789`);
    console.log('\n🔍 When the hall owner views the audit log, they should see:');
    console.log('   - Their own actions (hall settings update, user creation)');
    console.log('   - All sub-user actions (booking confirmations, updates)');
    console.log('   - All actions should have the same hallId for filtering');

  } catch (error) {
    console.error('❌ Error during hall owner audit logging tests:', error);
  }
}

// Run the tests
testHallOwnerAuditLogging().then(() => {
  console.log('\nTest completed. Exiting...');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
