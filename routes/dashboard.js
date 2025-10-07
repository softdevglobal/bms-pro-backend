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

// Helper function to calculate date ranges
const getDateRanges = () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Monday
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
  
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  
  const oneWeekAgo = new Date(today);
  oneWeekAgo.setDate(today.getDate() - 7);
  
  return {
    today,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    thirtyDaysAgo,
    oneWeekAgo,
    now
  };
};

// Helper function to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD'
  }).format(amount);
};

// Helper function to calculate occupancy percentage
const calculateOccupancy = (bookings, totalHours = 12) => {
  if (!bookings || bookings.length === 0) return 0;
  
  const totalBookedHours = bookings.reduce((total, booking) => {
    const start = new Date(`2000-01-01T${booking.startTime}:00`);
    const end = new Date(`2000-01-01T${booking.endTime}:00`);
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return total + hours;
  }, 0);
  
  return Math.round((totalBookedHours / totalHours) * 100);
};

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { resourceId, hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view dashboard stats.' });
    }

    const dateRanges = getDateRanges();
    
    // Get all bookings for this hall owner
    let bookingsQuery = admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId);
    
    // Filter by resource if specified
    if (resourceId && resourceId !== 'all') {
      bookingsQuery = bookingsQuery.where('selectedHall', '==', resourceId);
    }
    
    const bookingsSnapshot = await bookingsQuery.get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Filter bookings by date ranges
    const todayBookings = allBookings.filter(booking => 
      booking.bookingDate === dateRanges.today.toISOString().split('T')[0] &&
      ['confirmed', 'pending'].includes(booking.status)
    );

    const thisWeekBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startOfWeek && 
             bookingDate <= dateRanges.endOfWeek &&
             booking.status === 'confirmed';
    });

    const lastWeekBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      const lastWeekStart = new Date(dateRanges.startOfWeek);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekEnd = new Date(dateRanges.endOfWeek);
      lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);
      return bookingDate >= lastWeekStart && 
             bookingDate <= lastWeekEnd &&
             booking.status === 'confirmed';
    });

    const monthToDateBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startOfMonth && 
             bookingDate <= dateRanges.endOfMonth &&
             booking.status === 'confirmed';
    });

    const last30DaysBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.thirtyDaysAgo && 
             bookingDate <= dateRanges.now &&
             booking.status === 'cancelled';
    });

    const lastMonthBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      const lastMonthStart = new Date(dateRanges.startOfMonth);
      lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
      const lastMonthEnd = new Date(dateRanges.endOfMonth);
      lastMonthEnd.setMonth(lastMonthEnd.getMonth() - 1);
      return bookingDate >= lastMonthStart && 
             bookingDate <= lastMonthEnd &&
             booking.status === 'cancelled';
    });

    // Calculate KPIs
    const occupancyToday = calculateOccupancy(todayBookings);
    const bookingsThisWeek = thisWeekBookings.length;
    const bookingsLastWeek = lastWeekBookings.length;
    
    // Calculate holds expiring (pending bookings created more than 2 days ago)
    const twoDaysAgo = new Date(dateRanges.now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const holdsExpiring = allBookings.filter(booking => 
      booking.status === 'pending' && 
      booking.createdAt && 
      booking.createdAt < twoDaysAgo
    ).length;

    const holdsExpiringYesterday = allBookings.filter(booking => {
      const yesterday = new Date(dateRanges.now);
      yesterday.setDate(yesterday.getDate() - 1);
      return booking.status === 'pending' && 
             booking.createdAt && 
             booking.createdAt < yesterday;
    }).length;

    // Calculate payments due (confirmed bookings with calculated price)
    const paymentsDue = allBookings.filter(booking => 
      booking.status === 'confirmed' && 
      booking.calculatedPrice > 0
    ).reduce((total, booking) => total + (booking.calculatedPrice || 0), 0);

    const paymentsDueYesterday = allBookings.filter(booking => {
      const yesterday = new Date(dateRanges.now);
      yesterday.setDate(yesterday.getDate() - 1);
      return booking.status === 'confirmed' && 
             booking.calculatedPrice > 0 &&
             booking.updatedAt && 
             booking.updatedAt < yesterday;
    }).reduce((total, booking) => total + (booking.calculatedPrice || 0), 0);

    const cancellations30d = last30DaysBookings.length;
    const cancellationsLastMonth = lastMonthBookings.length;

    const revenueMTD = monthToDateBookings.reduce((total, booking) => 
      total + (booking.calculatedPrice || 0), 0
    );

    const revenueLastWeek = lastWeekBookings.reduce((total, booking) => 
      total + (booking.calculatedPrice || 0), 0
    );

    // Calculate deltas
    const occupancyDelta = bookingsLastWeek > 0 ? 
      Math.round(((occupancyToday - calculateOccupancy(lastWeekBookings)) / calculateOccupancy(lastWeekBookings)) * 100) : 0;
    
    const bookingsDelta = bookingsLastWeek > 0 ? 
      bookingsThisWeek - bookingsLastWeek : 0;
    
    const holdsDelta = holdsExpiring - holdsExpiringYesterday;
    const paymentsDelta = paymentsDue - paymentsDueYesterday;
    const cancellationsDelta = cancellations30d - cancellationsLastMonth;
    const revenueDelta = revenueMTD - revenueLastWeek;

    // Generate sparkline data (last 7 days for most metrics)
    const generateSparkline = (bookings, metric) => {
      const sparkline = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(dateRanges.today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const dayBookings = bookings.filter(booking => booking.bookingDate === dateStr);
        let value = 0;
        
        switch (metric) {
          case 'occupancy':
            value = calculateOccupancy(dayBookings);
            break;
          case 'bookings':
            value = dayBookings.length;
            break;
          case 'holds':
            value = dayBookings.filter(b => b.status === 'pending').length;
            break;
          case 'payments':
            value = dayBookings.reduce((sum, b) => sum + (b.calculatedPrice || 0), 0);
            break;
          case 'cancellations':
            value = dayBookings.filter(b => b.status === 'cancelled').length;
            break;
          case 'revenue':
            value = dayBookings.reduce((sum, b) => sum + (b.calculatedPrice || 0), 0);
            break;
        }
        
        sparkline.push(value);
      }
      return sparkline;
    };

    const stats = {
      kpis: {
        occupancyToday: {
          value: `${occupancyToday}%`,
          delta: `${occupancyDelta >= 0 ? '+' : ''}${occupancyDelta}% WoW`,
          deltaType: occupancyDelta >= 0 ? 'increase' : 'decrease',
          note: '% of bookable hours filled',
          sparkline: generateSparkline(allBookings, 'occupancy')
        },
        bookingsThisWeek: {
          value: bookingsThisWeek.toString(),
          delta: `${bookingsDelta >= 0 ? '+' : ''}${bookingsDelta} WoW`,
          deltaType: bookingsDelta >= 0 ? 'increase' : 'decrease',
          note: 'Confirmed in current week',
          sparkline: generateSparkline(allBookings, 'bookings')
        },
        holdsExpiring: {
          value: holdsExpiring.toString(),
          delta: `${holdsDelta >= 0 ? '+' : ''}${holdsDelta} DoD`,
          deltaType: holdsDelta >= 0 ? 'increase' : 'decrease',
          note: 'Tentative holds <48h left',
          sparkline: generateSparkline(allBookings, 'holds')
        },
        paymentsDue: {
          value: formatCurrency(paymentsDue),
          delta: `${paymentsDelta >= 0 ? '+' : ''}${formatCurrency(paymentsDelta)} DoD`,
          deltaType: paymentsDelta >= 0 ? 'increase' : 'decrease',
          note: 'Due today + overdue',
          sparkline: generateSparkline(allBookings, 'payments')
        },
        cancellations30d: {
          value: cancellations30d.toString(),
          delta: `${cancellationsDelta >= 0 ? '+' : ''}${cancellationsDelta} MoM`,
          deltaType: cancellationsDelta === 0 ? 'neutral' : (cancellationsDelta > 0 ? 'increase' : 'decrease'),
          note: 'Count',
          sparkline: generateSparkline(allBookings, 'cancellations')
        },
        revenueMtd: {
          value: formatCurrency(revenueMTD),
          delta: `${revenueDelta >= 0 ? '+' : ''}${formatCurrency(revenueDelta)} WTD`,
          deltaType: revenueDelta >= 0 ? 'increase' : 'decrease',
          note: 'Incl. GST line item',
          sparkline: generateSparkline(allBookings, 'revenue')
        }
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/dashboard/schedule - Get today's schedule
router.get('/schedule', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { resourceId, hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view schedule.' });
    }

    const dateRanges = getDateRanges();
    const todayStr = dateRanges.today.toISOString().split('T')[0];
    
    // Get today's bookings
    let bookingsQuery = admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .where('bookingDate', '==', todayStr);
    
    // Filter by resource if specified
    if (resourceId && resourceId !== 'all') {
      bookingsQuery = bookingsQuery.where('selectedHall', '==', resourceId);
    }
    
    const bookingsSnapshot = await bookingsQuery.get();

    const todayBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Transform to schedule format
    const schedule = todayBookings
      .filter(booking => ['confirmed', 'pending', 'block-out'].includes(booking.status))
      .map(booking => ({
        time: `${booking.startTime}–${booking.endTime}`,
        resource: booking.hallName || booking.selectedHall,
        title: booking.status === 'block-out' ? 'Block-out' : 
               `${booking.customerName} — ${booking.eventType}`,
        status: booking.status === 'pending' ? 'Tentative' : 
                booking.status === 'confirmed' ? 'Confirmed' : 'Block-out',
        bookingId: booking.id
      }))
      .sort((a, b) => {
        // Sort by start time
        const timeA = a.time.split('–')[0];
        const timeB = b.time.split('–')[0];
        return timeA.localeCompare(timeB);
      });

    res.json({ schedule });

  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/dashboard/payments-due - Get payments due
router.get('/payments-due', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view payments.' });
    }

    const dateRanges = getDateRanges();
    const todayStr = dateRanges.today.toISOString().split('T')[0];
    
    // Get confirmed bookings with calculated prices
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .where('status', '==', 'confirmed')
      .get();

    const confirmedBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Transform to payments due format
    const paymentsDue = confirmedBookings
      .filter(booking => booking.calculatedPrice > 0)
      .map(booking => {
        const bookingDate = new Date(booking.bookingDate);
        const daysDiff = Math.ceil((dateRanges.today - bookingDate) / (1000 * 60 * 60 * 24));
        
        let status = 'Due Today';
        if (daysDiff > 0) {
          status = 'Overdue';
        } else if (daysDiff < 0) {
          status = 'Upcoming';
        }

        return {
          invoice: `INV-${booking.id.substring(0, 8).toUpperCase()}`,
          customer: booking.customerName,
          type: 'FINAL', // Could be enhanced to track different payment types
          amountAud: booking.calculatedPrice,
          due: booking.bookingDate,
          status: status,
          bookingId: booking.id
        };
      })
      .sort((a, b) => {
        // Sort by due date, overdue first
        if (a.status === 'Overdue' && b.status !== 'Overdue') return -1;
        if (b.status === 'Overdue' && a.status !== 'Overdue') return 1;
        return new Date(a.due) - new Date(b.due);
      });

    res.json({ payments: paymentsDue });

  } catch (error) {
    console.error('Error fetching payments due:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/dashboard/holds-expiring - Get holds expiring
router.get('/holds-expiring', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view holds.' });
    }

    const dateRanges = getDateRanges();
    
    // Get pending bookings
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .where('status', '==', 'pending')
      .get();

    const pendingBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Calculate expiration times
    const holds = pendingBookings.map(booking => {
      const createdAt = booking.createdAt || new Date();
      const expiresAt = new Date(createdAt.getTime() + (48 * 60 * 60 * 1000)); // 48 hours
      const now = dateRanges.now;
      const timeLeft = expiresAt - now;
      
      let expiresIn = 'Expired';
      if (timeLeft > 0) {
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        expiresIn = `${hours}h ${minutes}m`;
      }

      return {
        booking: `BKG-${booking.id.substring(0, 6).toUpperCase()}`,
        resource: booking.hallName || booking.selectedHall,
        start: `${booking.bookingDate} ${booking.startTime}`,
        expiresIn: expiresIn,
        customer: booking.customerName,
        bookingId: booking.id
      };
    }).filter(hold => hold.expiresIn !== 'Expired')
      .sort((a, b) => {
        // Sort by expiration time (soonest first)
        const timeA = a.expiresIn.includes('h') ? 
          parseInt(a.expiresIn.split('h')[0]) * 60 + parseInt(a.expiresIn.split('h')[1].split('m')[0]) : 9999;
        const timeB = b.expiresIn.includes('h') ? 
          parseInt(b.expiresIn.split('h')[0]) * 60 + parseInt(b.expiresIn.split('h')[1].split('m')[0]) : 9999;
        return timeA - timeB;
      });

    res.json({ holds });

  } catch (error) {
    console.error('Error fetching holds expiring:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/dashboard/activity - Get recent activity
router.get('/activity', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view activity.' });
    }

    // Get recent notifications for this user (without orderBy to avoid index requirement)
    const notificationsSnapshot = await admin.firestore()
      .collection('notifications')
      .where('userId', '==', dataUserId)
      .get();

    const activities = notificationsSnapshot.docs
      .map(doc => {
        const data = doc.data();
        const createdAt = data.createdAt?.toDate?.() || new Date();
        const timeStr = createdAt.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
        
        return {
          at: timeStr,
          actor: 'System',
          text: data.message || data.title,
          createdAt: createdAt
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // Sort in memory
      .slice(0, 10); // Limit to 10 most recent

    res.json({ activities });

  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/dashboard/resources - Get resources for the authenticated hall owner
router.get('/resources', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { hallOwnerId } = req.query;
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userData = userDoc.data();
    let dataUserId = userId; // Default to current user
    
    // Determine which user's data to fetch
    if (userData.role === 'sub_user') {
      // For sub-users, use their parent's ID
      dataUserId = userData.parentUserId;
      if (!dataUserId) {
        return res.status(400).json({ message: 'Sub-user has no parent user assigned' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall owners, use their own ID
      dataUserId = userId;
    } else if (userData.role === 'super_admin') {
      // For super admins, use the provided hallOwnerId or default to current user
      dataUserId = hallOwnerId || userId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view resources.' });
    }

    // Get all resources for this hall owner
    const resourcesSnapshot = await admin.firestore()
      .collection('resources')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const resources = resourcesSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      capacity: doc.data().capacity,
      amenities: doc.data().amenities || [],
      status: doc.data().status || 'active'
    }));

    res.json({ resources });

  } catch (error) {
    console.error('Error fetching resources:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
