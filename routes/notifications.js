const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// use shared auth middleware

// GET /api/notifications - Get all notifications for a user
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;
    const { limit = 50, offset = 0 } = req.query;

    console.log('Fetching notifications for user:', userId);

    // Get notifications for the user
    const notificationsSnapshot = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', userId)
      .get();

    // Sort by createdAt in descending order (newest first) and apply pagination
    const notifications = notificationsSnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        readAt: doc.data().readAt?.toDate?.() || null
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    // Get total count for pagination
    const totalSnapshot = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', userId)
      .get();

    const unreadCount = notifications.filter(n => !n.isRead).length;

    res.json({
      notifications,
      totalCount: totalSnapshot.size,
      unreadCount,
      hasMore: notifications.length === parseInt(limit)
    });

  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/notifications/:id/read - Mark notification as read
router.put('/:id/read', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get notification to verify ownership
    const notificationDoc = await admin.firestore().collection('notifications').doc(id).get();
    if (!notificationDoc.exists) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.userId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only update your own notifications.' });
    }

    // Mark as read
    await admin.firestore().collection('notifications').doc(id).update({
      isRead: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: 'Notification marked as read',
      notificationId: id
    });

  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/notifications/read-all - Mark all notifications as read for a user
router.put('/read-all', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;

    // Get all unread notifications for the user
    const unreadNotifications = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    // Update all unread notifications
    const updatePromises = unreadNotifications.docs.map(doc => 
      doc.ref.update({
        isRead: true,
        readAt: admin.firestore.FieldValue.serverTimestamp()
      })
    );

    await Promise.all(updatePromises);

    res.json({
      message: 'All notifications marked as read',
      updatedCount: unreadNotifications.size
    });

  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: error.message });
  }
});

// DELETE /api/notifications/:id - Delete a notification
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;

    // Get notification to verify ownership
    const notificationDoc = await admin.firestore().collection('notifications').doc(id).get();
    if (!notificationDoc.exists) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    const notificationData = notificationDoc.data();
    if (notificationData.userId !== userId) {
      return res.status(403).json({ message: 'Access denied. You can only delete your own notifications.' });
    }

    // Delete notification
    await admin.firestore().collection('notifications').doc(id).delete();

    res.json({
      message: 'Notification deleted',
      notificationId: id
    });

  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/notifications - Create a notification (for testing or admin use)
router.post('/', verifyToken, async (req, res) => {
  try {
    const { userId, type, title, message, data } = req.body;

    // Validate required fields
    if (!userId || !type || !title || !message) {
      return res.status(400).json({
        message: 'Missing required fields: userId, type, title, message'
      });
    }

    // Create notification
    const notificationData = {
      userId,
      type,
      title,
      message,
      data: data || null,
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore().collection('notifications').add(notificationData);

    res.status(201).json({
      message: 'Notification created successfully',
      notification: {
        id: docRef.id,
        ...notificationData,
        createdAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/notifications/unread-count - Get unread notification count for a user
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.user_id;

    const unreadSnapshot = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    res.json({
      unreadCount: unreadSnapshot.size
    });

  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
