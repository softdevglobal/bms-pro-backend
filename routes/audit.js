const express = require('express');
const admin = require('../firebaseAdmin');

const router = express.Router();

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Try to verify as JWT first, then Firebase token
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = decoded;
      next();
    } catch (jwtError) {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware to check if user has audit permission
const checkAuditPermission = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Super admins can see all audit logs
    if (userData.role === 'super_admin') {
      req.userRole = 'super_admin';
      req.userData = userData;
      return next();
    }
    
    // Hall owners can see their own audit logs
    if (userData.role === 'hall_owner') {
      req.userRole = 'hall_owner';
      req.userData = userData;
      return next();
    }
    
    // Sub-users can see audit logs if they have audit permission
    if (userData.role === 'sub_user' && userData.permissions?.includes('audit')) {
      req.userRole = 'sub_user';
      req.userData = userData;
      return next();
    }
    
    return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
  } catch (error) {
    console.error('Permission check error:', error);
    res.status(500).json({ message: 'Error checking permissions' });
  }
};

// GET /api/audit - Get audit logs with filtering and pagination
router.get('/', verifyToken, checkAuditPermission, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      action,
      userId,
      targetType,
      userRole,
      sortBy = 'timestamp',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build query - start with basic collection query
    let query = admin.firestore().collection('audit_logs');

    // For now, let's fetch all logs and filter in memory to avoid index issues
    // This is a temporary solution until the Firestore index is created
    const snapshot = await query.orderBy('timestamp', 'desc').get();
    
    let auditLogs = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp
      };
    });

    // Apply role-based filtering in memory
    if (req.userRole === 'super_admin') {
      // Super admins see logs from hall owners and system-wide activities
      auditLogs = auditLogs.filter(log => 
        log.userRole === 'hall_owner' || 
        log.userRole === 'super_admin' ||
        log.userRole === 'system'
      );
    } else if (req.userRole === 'hall_owner') {
      // Hall owners see their own logs AND their sub-users' logs
      const hallOwnerId = req.userData.id; // Hall owner's own UID
      
      // First, get all sub-users that belong to this hall owner
      const subUsersSnapshot = await admin.firestore()
        .collection('users')
        .where('parentUserId', '==', hallOwnerId)
        .get();
      
      const subUserIds = subUsersSnapshot.docs.map(doc => doc.id);
      
      // Filter audit logs to show hall owner's own activities AND sub-users' activities
      auditLogs = auditLogs.filter(log => 
        // Hall owner's own logs
        (log.userId === hallOwnerId && log.userRole === 'hall_owner') ||
        // Sub-users' logs
        (subUserIds.includes(log.userId) && log.userRole === 'sub_user')
      );
    } else if (req.userRole === 'sub_user') {
      // Sub-users see their own logs only
      auditLogs = auditLogs.filter(log => 
        log.userId === req.userData.id
      );
    }

    // Apply filters in memory
    if (startDate) {
      const startDateObj = new Date(startDate);
      auditLogs = auditLogs.filter(log => log.timestamp >= startDateObj);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      auditLogs = auditLogs.filter(log => log.timestamp <= endDateObj);
    }
    if (action) {
      auditLogs = auditLogs.filter(log => log.action === action);
    }
    if (userId) {
      auditLogs = auditLogs.filter(log => log.userId === userId);
    }
    if (targetType) {
      auditLogs = auditLogs.filter(log => log.targetType === targetType);
    }
    if (userRole) {
      auditLogs = auditLogs.filter(log => log.userRole === userRole);
    }

    // Apply sorting
    auditLogs.sort((a, b) => {
      if (sortBy === 'timestamp') {
        return sortOrder === 'desc' ? 
          new Date(b.timestamp) - new Date(a.timestamp) : 
          new Date(a.timestamp) - new Date(b.timestamp);
      }
      return 0;
    });

    // Get total count after filtering
    const totalCount = auditLogs.length;

    // Apply pagination
    auditLogs = auditLogs.slice(offset, offset + limitNum);

    res.json({
      auditLogs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Error fetching audit logs' });
  }
});

// GET /api/audit/actions - Get available audit actions for filtering
router.get('/actions', verifyToken, checkAuditPermission, async (req, res) => {
  try {
    const actions = [
      'user_created',
      'user_updated',
      'user_deleted',
      'user_login',
      'user_logout',
      'booking_created',
      'booking_updated',
      'booking_cancelled',
      'booking_confirmed',
      'hall_settings_updated',
      'pricing_updated',
      'resource_created',
      'resource_updated',
      'resource_deleted',
      'customer_created',
      'customer_updated',
      'invoice_created',
      'invoice_paid',
      'report_generated',
      'settings_updated',
      'role_assigned',
      'permission_granted',
      'permission_revoked',
      'system_config_changed'
    ];

    res.json({ actions });
  } catch (error) {
    console.error('Error fetching audit actions:', error);
    res.status(500).json({ message: 'Error fetching audit actions' });
  }
});

// GET /api/audit/target-types - Get available target types for filtering
router.get('/target-types', verifyToken, checkAuditPermission, async (req, res) => {
  try {
    const targetTypes = [
      'user',
      'booking',
      'hall',
      'resource',
      'customer',
      'invoice',
      'report',
      'settings',
      'pricing',
      'system'
    ];

    res.json({ targetTypes });
  } catch (error) {
    console.error('Error fetching target types:', error);
    res.status(500).json({ message: 'Error fetching target types' });
  }
});

// GET /api/audit/stats - Get audit log statistics
router.get('/stats', verifyToken, checkAuditPermission, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Fetch all logs and filter in memory to avoid index issues
    let query = admin.firestore().collection('audit_logs');
    const snapshot = await query.orderBy('timestamp', 'desc').get();
    
    let auditLogs = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : data.timestamp
      };
    });

    // Apply role-based filtering in memory
    if (req.userRole === 'super_admin') {
      // Super admins see logs from hall owners and system-wide activities
      auditLogs = auditLogs.filter(log => 
        log.userRole === 'hall_owner' || 
        log.userRole === 'super_admin' ||
        log.userRole === 'system'
      );
    } else if (req.userRole === 'hall_owner') {
      // Hall owners see their own logs AND their sub-users' logs
      const hallOwnerId = req.userData.id; // Hall owner's own UID
      
      // First, get all sub-users that belong to this hall owner
      const subUsersSnapshot = await admin.firestore()
        .collection('users')
        .where('parentUserId', '==', hallOwnerId)
        .get();
      
      const subUserIds = subUsersSnapshot.docs.map(doc => doc.id);
      
      // Filter audit logs to show hall owner's own activities AND sub-users' activities
      auditLogs = auditLogs.filter(log => 
        // Hall owner's own logs
        (log.userId === hallOwnerId && log.userRole === 'hall_owner') ||
        // Sub-users' logs
        (subUserIds.includes(log.userId) && log.userRole === 'sub_user')
      );
    } else if (req.userRole === 'sub_user') {
      // Sub-users see their own logs only
      auditLogs = auditLogs.filter(log => 
        log.userId === req.userData.id
      );
    }

    // Apply date filters in memory
    if (startDate) {
      const startDateObj = new Date(startDate);
      auditLogs = auditLogs.filter(log => log.timestamp >= startDateObj);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      auditLogs = auditLogs.filter(log => log.timestamp <= endDateObj);
    }
    
    const stats = {
      totalLogs: auditLogs.length,
      actionsCount: {},
      usersCount: {},
      targetTypesCount: {},
      recentActivity: []
    };

    // Process logs for statistics
    auditLogs.forEach(log => {
      // Count actions
      stats.actionsCount[log.action] = (stats.actionsCount[log.action] || 0) + 1;
      
      // Count users
      stats.usersCount[log.userEmail] = (stats.usersCount[log.userEmail] || 0) + 1;
      
      // Count target types
      stats.targetTypesCount[log.targetType] = (stats.targetTypesCount[log.targetType] || 0) + 1;
    });

    // Get recent activity (last 10 logs)
    stats.recentActivity = auditLogs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map(log => ({
        id: log.id,
        action: log.action,
        userEmail: log.userEmail,
        target: log.target,
        timestamp: log.timestamp
      }));

    res.json(stats);
  } catch (error) {
    console.error('Error fetching audit stats:', error);
    res.status(500).json({ message: 'Error fetching audit statistics' });
  }
});

module.exports = router;
