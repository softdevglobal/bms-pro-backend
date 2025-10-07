const admin = require('./firebaseAdmin');

async function createTestAuditLogs() {
  console.log('Creating test audit logs...');

  try {
    const hallId = 'bLRLXrfr5pRBVcUntxUFlvXewaw1'; // The hall owner ID from the terminal output
    const now = new Date();

    // Create some test audit logs
    const testLogs = [
      {
        userId: hallId,
        userEmail: 'test@test.com',
        userRole: 'hall_owner',
        action: 'user_login',
        targetType: 'user',
        target: 'User: test@test.com',
        changes: {},
        ipAddress: '127.0.0.1',
        hallId: hallId,
        additionalInfo: 'User successfully logged in',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      },
      {
        userId: hallId,
        userEmail: 'test@test.com',
        userRole: 'hall_owner',
        action: 'hall_settings_updated',
        targetType: 'hall',
        target: 'Hall: Cranbourne Public Hall',
        changes: {
          hallName: {
            old: 'Old Hall Name',
            new: 'Cranbourne Public Hall'
          }
        },
        ipAddress: '127.0.0.1',
        hallId: hallId,
        additionalInfo: 'Updated hall settings',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      },
      {
        userId: hallId,
        userEmail: 'test@test.com',
        userRole: 'hall_owner',
        action: 'booking_confirmed',
        targetType: 'booking',
        target: 'Booking ID: TEST-001',
        changes: {
          status: {
            old: 'pending',
            new: 'confirmed'
          }
        },
        ipAddress: '127.0.0.1',
        hallId: hallId,
        additionalInfo: 'Confirmed booking for John Doe',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }
    ];

    // Add logs to Firestore
    for (const log of testLogs) {
      await admin.firestore().collection('audit_logs').add(log);
      console.log(`✅ Created audit log: ${log.action}`);
    }

    console.log('\n🎉 Test audit logs created successfully!');
    console.log('You can now refresh the audit page to see the logs.');

  } catch (error) {
    console.error('❌ Error creating test audit logs:', error);
  }
}

// Run the function
createTestAuditLogs().then(() => {
  console.log('\nScript completed. Exiting...');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
