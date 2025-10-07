const admin = require('./firebaseAdmin');

async function testNotifications() {
  try {
    console.log('Testing notification system...');

    // Test creating a notification
    const testNotification = {
      userId: 'test-user-id',
      type: 'booking_submitted',
      title: 'Test Notification',
      message: 'This is a test notification to verify the system is working.',
      data: {
        bookingId: 'test-booking-123',
        eventType: 'Test Event',
        date: '2024-01-15'
      },
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore().collection('notifications').add(testNotification);
    console.log('✅ Test notification created with ID:', docRef.id);

    // Test reading notifications
    const notificationsSnapshot = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', 'test-user-id')
      .orderBy('createdAt', 'desc')
      .get();

    console.log('✅ Found', notificationsSnapshot.docs.length, 'notifications for test user');

    // Test updating notification
    await admin.firestore().collection('notifications').doc(docRef.id).update({
      isRead: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Test notification marked as read');

    // Clean up test notification
    await admin.firestore().collection('notifications').doc(docRef.id).delete();
    console.log('✅ Test notification cleaned up');

    console.log('🎉 All notification tests passed!');

  } catch (error) {
    console.error('❌ Notification test failed:', error);
  } finally {
    process.exit(0);
  }
}

testNotifications();
