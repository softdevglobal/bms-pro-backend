const admin = require('./firebaseAdmin');

async function testSubUserCreation() {
  try {
    console.log('Testing sub-user creation...');
    
    // Test data
    const testSubUser = {
      email: 'test-subuser@example.com',
      password: 'TestPassword123!',
      role: 'sub_user',
      parentUserId: 'test-parent-id',
      permissions: ['dashboard', 'calendar', 'bookings']
    };

    // Create user in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email: testSubUser.email,
      password: testSubUser.password,
      emailVerified: false
    });

    console.log('✅ User created in Firebase Auth:', userRecord.uid);

    // Prepare user data for Firestore
    const userData = {
      id: userRecord.uid,
      email: testSubUser.email,
      role: testSubUser.role,
      parentUserId: testSubUser.parentUserId,
      permissions: testSubUser.permissions,
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save user data to Firestore
    await admin.firestore().collection('users').doc(userRecord.uid).set(userData);

    console.log('✅ User data saved to Firestore');

    // Test fetching sub-users
    const subUsersSnapshot = await admin.firestore()
      .collection('users')
      .where('parentUserId', '==', testSubUser.parentUserId)
      .where('role', '==', 'sub_user')
      .get();

    console.log('✅ Sub-users fetched:', subUsersSnapshot.docs.length);

    // Clean up - delete the test user
    await admin.auth().deleteUser(userRecord.uid);
    await admin.firestore().collection('users').doc(userRecord.uid).delete();

    console.log('✅ Test user cleaned up');
    console.log('🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSubUserCreation();
