const admin = require('./firebaseAdmin');

async function cleanupDuplicateNotifications() {
  try {
    console.log('🧹 Starting cleanup of duplicate notifications...');

    // Get all notifications
    const notificationsSnapshot = await admin.firestore()
      .collection('notifications')
      .get();

    const notifications = notificationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`📊 Found ${notifications.length} total notifications`);

    // Group notifications by userId, type, and bookingId
    const groupedNotifications = {};
    const duplicates = [];

    notifications.forEach(notification => {
      if (notification.type === 'booking_submitted' && notification.data?.bookingId) {
        const key = `${notification.userId}_${notification.type}_${notification.data.bookingId}`;
        
        if (!groupedNotifications[key]) {
          groupedNotifications[key] = [];
        }
        
        groupedNotifications[key].push(notification);
      }
    });

    // Find duplicates (more than one notification with same key)
    Object.values(groupedNotifications).forEach(group => {
      if (group.length > 1) {
        // Keep the first one, mark others for deletion
        const toKeep = group[0];
        const toDelete = group.slice(1);
        
        console.log(`🔍 Found ${group.length} duplicate notifications for booking ${toKeep.data.bookingId}`);
        console.log(`   Keeping: ${toKeep.id} (created: ${toKeep.createdAt?.toDate?.() || 'unknown'})`);
        
        toDelete.forEach(duplicate => {
          console.log(`   Deleting: ${duplicate.id} (created: ${duplicate.createdAt?.toDate?.() || 'unknown'})`);
          duplicates.push(duplicate);
        });
      }
    });

    if (duplicates.length === 0) {
      console.log('✅ No duplicate notifications found!');
      return;
    }

    console.log(`\n🗑️ Deleting ${duplicates.length} duplicate notifications...`);

    // Delete duplicates in batches
    const batch = admin.firestore().batch();
    let deleteCount = 0;

    for (const duplicate of duplicates) {
      const docRef = admin.firestore().collection('notifications').doc(duplicate.id);
      batch.delete(docRef);
      deleteCount++;

      // Commit batch every 500 operations (Firestore limit)
      if (deleteCount % 500 === 0) {
        await batch.commit();
        console.log(`   Deleted ${deleteCount} notifications...`);
      }
    }

    // Commit remaining operations
    if (deleteCount % 500 !== 0) {
      await batch.commit();
    }

    console.log(`✅ Successfully deleted ${deleteCount} duplicate notifications`);
    console.log('🎉 Cleanup completed!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    process.exit(0);
  }
}

// Run cleanup
cleanupDuplicateNotifications();
