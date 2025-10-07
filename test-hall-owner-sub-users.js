const admin = require('./firebaseAdmin');
const AuditService = require('./services/auditService');

async function testHallOwnerSubUsersAudit() {
  console.log('🧪 Testing Hall Owner - Sub Users Audit Visibility...\n');

  try {
    // First, let's create some test users and audit logs
    
    // 1. Create a hall owner
    const hallOwnerId = 'test_hall_owner_' + Date.now();
    const hallOwnerEmail = 'hallowner@test.com';
    
    console.log('1. Creating hall owner...');
    await admin.firestore().collection('users').doc(hallOwnerId).set({
      id: hallOwnerId,
      email: hallOwnerEmail,
      role: 'hall_owner',
      name: 'Test Hall Owner',
      hallId: hallOwnerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Hall owner created: ${hallOwnerId}`);

    // 2. Create sub-users under this hall owner
    const subUser1Id = 'test_sub_user_1_' + Date.now();
    const subUser1Email = 'subuser1@test.com';
    const subUser2Id = 'test_sub_user_2_' + Date.now();
    const subUser2Email = 'subuser2@test.com';
    
    console.log('\n2. Creating sub-users...');
    
    await admin.firestore().collection('users').doc(subUser1Id).set({
      id: subUser1Id,
      email: subUser1Email,
      role: 'sub_user',
      name: 'Test Sub User 1',
      parentUserId: hallOwnerId,
      hallId: hallOwnerId,
      permissions: ['audit', 'booking', 'customer'],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Sub-user 1 created: ${subUser1Id}`);

    await admin.firestore().collection('users').doc(subUser2Id).set({
      id: subUser2Id,
      email: subUser2Email,
      role: 'sub_user',
      name: 'Test Sub User 2',
      parentUserId: hallOwnerId,
      hallId: hallOwnerId,
      permissions: ['audit', 'booking'],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Sub-user 2 created: ${subUser2Id}`);

    // 3. Create audit logs for the hall owner (should NOT be visible to hall owner)
    console.log('\n3. Creating hall owner audit logs (should NOT be visible to hall owner)...');
    await AuditService.logUserLogin(hallOwnerId, hallOwnerEmail, 'hall_owner', '127.0.0.1', hallOwnerId);
    await AuditService.logEvent({
      userId: hallOwnerId,
      userEmail: hallOwnerEmail,
      userRole: 'hall_owner',
      action: 'hall_settings_updated',
      targetType: 'hall',
      target: 'Hall Settings',
      changes: { old: { name: 'Old Name' }, new: { name: 'New Name' } },
      ipAddress: '127.0.0.1',
      hallId: hallOwnerId,
      additionalInfo: 'Hall owner updated settings'
    });
    console.log('✅ Hall owner audit logs created');

    // 4. Create audit logs for sub-users (should be visible to hall owner)
    console.log('\n4. Creating sub-user audit logs (should be visible to hall owner)...');
    
    // Sub-user 1 activities
    await AuditService.logUserLogin(subUser1Id, subUser1Email, 'sub_user', '127.0.0.1', hallOwnerId);
    await AuditService.logEvent({
      userId: subUser1Id,
      userEmail: subUser1Email,
      userRole: 'sub_user',
      action: 'booking_created',
      targetType: 'booking',
      target: 'Booking ID: BOOK001',
      changes: { new: { customerName: 'John Doe', amount: 500 } },
      ipAddress: '127.0.0.1',
      hallId: hallOwnerId,
      additionalInfo: 'Sub-user 1 created a booking'
    });
    
    // Sub-user 2 activities
    await AuditService.logUserLogin(subUser2Id, subUser2Email, 'sub_user', '127.0.0.1', hallOwnerId);
    await AuditService.logEvent({
      userId: subUser2Id,
      userEmail: subUser2Email,
      userRole: 'sub_user',
      action: 'customer_created',
      targetType: 'customer',
      target: 'Customer: Jane Smith',
      changes: { new: { name: 'Jane Smith', email: 'jane@example.com' } },
      ipAddress: '127.0.0.1',
      hallId: hallOwnerId,
      additionalInfo: 'Sub-user 2 created a customer'
    });
    
    console.log('✅ Sub-user audit logs created');

    // 5. Create audit logs for another hall owner (should NOT be visible)
    console.log('\n5. Creating other hall owner audit logs (should NOT be visible)...');
    const otherHallOwnerId = 'other_hall_owner_' + Date.now();
    const otherHallOwnerEmail = 'other@test.com';
    
    await admin.firestore().collection('users').doc(otherHallOwnerId).set({
      id: otherHallOwnerId,
      email: otherHallOwnerEmail,
      role: 'hall_owner',
      name: 'Other Hall Owner',
      hallId: otherHallOwnerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    await AuditService.logUserLogin(otherHallOwnerId, otherHallOwnerEmail, 'hall_owner', '127.0.0.1', otherHallOwnerId);
    console.log('✅ Other hall owner audit logs created');

    // 6. Wait a moment for Firestore to process
    console.log('\n6. Waiting for Firestore to process...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 7. Test the audit API as hall owner
    console.log('\n7. Testing audit API as hall owner...');
    
    // Simulate the audit API call
    const auditLogsSnapshot = await admin.firestore().collection('audit_logs').orderBy('timestamp', 'desc').get();
    let auditLogs = auditLogsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp
      };
    });

    // Apply hall owner filtering (simulate the API logic)
    const hallOwnerId_test = hallOwnerId;
    const subUsersSnapshot = await admin.firestore()
      .collection('users')
      .where('parentUserId', '==', hallOwnerId_test)
      .get();
    
    const subUserIds = subUsersSnapshot.docs.map(doc => doc.id);
    console.log(`📋 Found ${subUserIds.length} sub-users for hall owner:`, subUserIds);
    
    const filteredLogs = auditLogs.filter(log => 
      subUserIds.includes(log.userId) && 
      log.userRole === 'sub_user'
    );

    console.log('\n📊 RESULTS:');
    console.log(`Total audit logs in system: ${auditLogs.length}`);
    console.log(`Filtered logs for hall owner: ${filteredLogs.length}`);
    
    console.log('\n📋 Audit logs visible to hall owner:');
    filteredLogs.forEach((log, index) => {
      console.log(`${index + 1}. ${log.action} by ${log.userEmail} (${log.userRole}) - ${log.target}`);
    });

    // 8. Verify the results
    console.log('\n✅ VERIFICATION:');
    
    const hallOwnerLogs = filteredLogs.filter(log => log.userId === hallOwnerId);
    const subUserLogs = filteredLogs.filter(log => subUserIds.includes(log.userId));
    const otherHallOwnerLogs = filteredLogs.filter(log => log.userId === otherHallOwnerId);
    
    console.log(`- Hall owner's own logs visible: ${hallOwnerLogs.length} (should be 0)`);
    console.log(`- Sub-users' logs visible: ${subUserLogs.length} (should be 4)`);
    console.log(`- Other hall owner's logs visible: ${otherHallOwnerLogs.length} (should be 0)`);
    
    if (hallOwnerLogs.length === 0 && subUserLogs.length === 4 && otherHallOwnerLogs.length === 0) {
      console.log('\n🎉 SUCCESS: Hall owner can see only their sub-users\' audit data!');
    } else {
      console.log('\n❌ FAILURE: Filtering logic needs adjustment');
    }

    // 9. Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await admin.firestore().collection('users').doc(hallOwnerId).delete();
    await admin.firestore().collection('users').doc(subUser1Id).delete();
    await admin.firestore().collection('users').doc(subUser2Id).delete();
    await admin.firestore().collection('users').doc(otherHallOwnerId).delete();
    
    // Delete audit logs
    const batch = admin.firestore().batch();
    const logsToDelete = await admin.firestore().collection('audit_logs')
      .where('userId', 'in', [hallOwnerId, subUser1Id, subUser2Id, otherHallOwnerId])
      .get();
    
    logsToDelete.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    
    console.log('✅ Test data cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testHallOwnerSubUsersAudit().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test error:', error);
  process.exit(1);
});
