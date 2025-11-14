const express = require('express');
const admin = require('../firebaseAdmin');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// use shared auth middleware

// Helper function to calculate date ranges
const getDateRanges = (period = '90d') => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  let startDate, endDate;
  
  switch (period) {
    case '30d':
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 30);
      endDate = today;
      break;
    case '90d':
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 90);
      endDate = today;
      break;
    case '180d':
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 180);
      endDate = today;
      break;
    case '1y':
      startDate = new Date(today);
      startDate.setFullYear(today.getFullYear() - 1);
      endDate = today;
      break;
    default:
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 90);
      endDate = today;
  }
  
  return { startDate, endDate, today: now };
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

// Helper function to calculate trend analysis
const calculateTrend = (currentValue, previousValue) => {
  if (previousValue === 0) return 0;
  return Math.round(((currentValue - previousValue) / previousValue) * 100);
};

// Helper function to calculate conversion rates
const calculateConversionRate = (confirmed, total) => {
  if (total === 0) return 0;
  return Math.round((confirmed / total) * 100);
};

// Case-insensitive status helpers
const isConfirmed = (status) => String(status || '').toLowerCase() === 'confirmed' || String(status || '').toLowerCase() === 'completed';
const isPending = (status) => String(status || '').toLowerCase() === 'pending' || String(status || '').toLowerCase() === 'tentative';
const isCancelled = (status) => String(status || '').toLowerCase() === 'cancelled';

// Robust revenue accessor for bookings or invoices
const getBookingRevenue = (b) => {
  // Prefer calculatedPrice; fallback to priceDetails.frontendEstimatedPrice
  const calc = Number(b?.calculatedPrice || 0);
  const est = Number(b?.priceDetails?.adminEstimatedPrice || b?.priceDetails?.frontendEstimatedPrice || 0);
  return Number.isFinite(calc) && calc > 0 ? calc : (Number.isFinite(est) ? est : 0);
};
const getInvoiceTotal = (inv) => {
  const finalTotal = Number(inv?.finalTotal);
  const total = Number(inv?.total);
  if (Number.isFinite(finalTotal)) return finalTotal;
  if (Number.isFinite(total)) return total;
  return 0;
};

// Helper function to generate forecast data
const generateForecastData = (historicalData, periods = 6) => {
  if (!historicalData || historicalData.length < 2) return [];
  
  // Simple linear regression for forecasting
  const n = historicalData.length;
  const sumX = historicalData.reduce((sum, _, index) => sum + index, 0);
  const sumY = historicalData.reduce((sum, item) => sum + item.bookings, 0);
  const sumXY = historicalData.reduce((sum, item, index) => sum + index * item.bookings, 0);
  const sumXX = historicalData.reduce((sum, _, index) => sum + index * index, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  const forecast = [];
  const lastMonth = new Date(historicalData[historicalData.length - 1].month + ' 01');
  
  for (let i = 1; i <= periods; i++) {
    const forecastDate = new Date(lastMonth);
    forecastDate.setMonth(forecastDate.getMonth() + i);
    
    const forecastBookings = Math.max(0, Math.round(intercept + slope * (n + i - 1)));
    const forecastRevenue = forecastBookings * (sumY / n); // Simple revenue estimation
    
    forecast.push({
      month: forecastDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
      bookings: forecastBookings,
      revenue: Math.round(forecastRevenue),
      isForecast: true
    });
  }
  
  return forecast;
};

// GET /api/reports/executive-kpis - Get executive KPIs
router.get('/executive-kpis', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { period = '90d', hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    const dateRanges = getDateRanges(period);
    const previousPeriodStart = new Date(dateRanges.startDate);
    const previousPeriodEnd = new Date(dateRanges.startDate);
    const periodDuration = dateRanges.endDate - dateRanges.startDate;
    previousPeriodStart.setTime(previousPeriodStart.getTime() - periodDuration);
    previousPeriodEnd.setTime(previousPeriodEnd.getTime() - 1);
    
    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Filter bookings by current period
    const currentPeriodBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startDate && bookingDate <= dateRanges.endDate;
    });

    // Filter bookings by previous period
    const previousPeriodBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= previousPeriodStart && bookingDate <= previousPeriodEnd;
    });

    // Get invoices for this hall owner (filter in memory by date to avoid compound indexes)
    const invoicesSnapshot = await admin.firestore()
      .collection('invoices')
      .where('hallOwnerId', '==', dataUserId)
      .get();
    const allInvoices = invoicesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      issueDate: doc.data().issueDate?.toDate?.() || null,
      dueDate: doc.data().dueDate?.toDate?.() || null,
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Calculate current period metrics (bookings: pending+confirmed+completed)
    const currentBookings = currentPeriodBookings.filter(b => isConfirmed(b.status) || isPending(b.status)).length;

    // Revenue: prefer invoices issued in current period; fallback to booking revenue
    const currentPeriodInvoices = allInvoices.filter(inv => {
      const d = inv.issueDate || inv.createdAt || null;
      return d && d >= dateRanges.startDate && d <= dateRanges.endDate;
    });
    const currentRevenueFromInvoices = currentPeriodInvoices.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
    const currentRevenueFromBookings = currentPeriodBookings
      .filter(b => isConfirmed(b.status))
      .reduce((sum, b) => sum + getBookingRevenue(b), 0);
    const currentRevenue = Math.max(currentRevenueFromInvoices, currentRevenueFromBookings);

    const currentUtilisation = calculateOccupancy(
      currentPeriodBookings.filter(b => isConfirmed(b.status))
    );
    
    // Calculate deposit conversion (confirmed vs pending)
    const confirmedBookings = currentPeriodBookings.filter(b => isConfirmed(b.status)).length;
    const pendingBookings = currentPeriodBookings.filter(b => isPending(b.status)).length;
    const totalBookings = confirmedBookings + pendingBookings;
    const depositConversion = totalBookings > 0 ? Math.round((confirmedBookings / totalBookings) * 100) : 0;
    
    // Calculate on-time payments (simplified - assuming confirmed bookings are paid)
    const onTimePayments = totalBookings > 0 ? Math.round((confirmedBookings / totalBookings) * 100) : 0;
    
    // Calculate cancellation rate
    const cancelledBookings = currentPeriodBookings.filter(b => isCancelled(b.status)).length;
    const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

    // Calculate previous period metrics for comparison
    const previousBookings = previousPeriodBookings.filter(b => isConfirmed(b.status) || isPending(b.status)).length;
    const previousPeriodInvoices = allInvoices.filter(inv => {
      const d = inv.issueDate || inv.createdAt || null;
      return d && d >= previousPeriodStart && d <= previousPeriodEnd;
    });
    const previousRevenueInvoices = previousPeriodInvoices.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
    const previousRevenueBookings = previousPeriodBookings
      .filter(b => isConfirmed(b.status))
      .reduce((sum, b) => sum + getBookingRevenue(b), 0);
    const previousRevenue = Math.max(previousRevenueInvoices, previousRevenueBookings);

    const previousUtilisation = calculateOccupancy(
      previousPeriodBookings.filter(b => isConfirmed(b.status))
    );
    
    const previousConfirmed = previousPeriodBookings.filter(b => isConfirmed(b.status)).length;
    const previousPending = previousPeriodBookings.filter(b => isPending(b.status)).length;
    const previousTotal = previousConfirmed + previousPending;
    const previousDepositConversion = previousTotal > 0 ? Math.round((previousConfirmed / previousTotal) * 100) : 0;
    const previousOnTimePayments = previousTotal > 0 ? Math.round((previousConfirmed / previousTotal) * 100) : 0;
    const previousCancelled = previousPeriodBookings.filter(b => isCancelled(b.status)).length;
    const previousCancellationRate = previousTotal > 0 ? Math.round((previousCancelled / previousTotal) * 100) : 0;

    // Calculate changes
    const bookingsChange = previousBookings > 0 ? Math.round(((currentBookings - previousBookings) / previousBookings) * 100) : 0;
    const revenueChange = previousRevenue > 0 ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100) : 0;
    const utilisationChange = previousUtilisation > 0 ? currentUtilisation - previousUtilisation : 0;
    const depositConversionChange = previousDepositConversion > 0 ? depositConversion - previousDepositConversion : 0;
    const onTimePaymentsChange = previousOnTimePayments > 0 ? onTimePayments - previousOnTimePayments : 0;
    const cancellationRateChange = previousCancellationRate > 0 ? cancellationRate - previousCancellationRate : 0;

    const kpis = {
      bookings: {
        value: currentBookings,
        change: bookingsChange,
        period: period === '90d' ? 'QoQ' : 'MoM',
        trend: bookingsChange > 0 ? 'up' : bookingsChange < 0 ? 'down' : 'neutral'
      },
      revenue: {
        value: currentRevenue,
        change: revenueChange,
        period: period === '90d' ? 'QoQ' : 'MoM',
        trend: revenueChange > 0 ? 'up' : revenueChange < 0 ? 'down' : 'neutral'
      },
      utilisation: {
        value: currentUtilisation,
        change: utilisationChange,
        period: 'pp',
        trend: utilisationChange > 0 ? 'up' : utilisationChange < 0 ? 'down' : 'neutral'
      },
      depositConversion: {
        value: depositConversion,
        change: depositConversionChange,
        period: 'MoM',
        trend: depositConversionChange > 0 ? 'up' : depositConversionChange < 0 ? 'down' : 'neutral'
      },
      onTimePayments: {
        value: onTimePayments,
        change: onTimePaymentsChange,
        period: 'MoM',
        trend: onTimePaymentsChange > 0 ? 'up' : onTimePaymentsChange < 0 ? 'down' : 'neutral'
      },
      cancellationRate: {
        value: cancellationRate,
        change: cancellationRateChange,
        period: 'MoM',
        trend: cancellationRateChange > 0 ? 'up' : cancellationRateChange < 0 ? 'down' : 'neutral'
      }
    };

    res.json({ kpis, period, dateRange: { start: dateRanges.startDate, end: dateRanges.endDate } });

  } catch (error) {
    console.error('Error fetching executive KPIs:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/historical-data - Get historical performance data
router.get('/historical-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { months = 6, hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Fetch invoices for revenue aggregation
    const invoicesSnapshot = await admin.firestore()
      .collection('invoices')
      .where('hallOwnerId', '==', dataUserId)
      .get();
    const allInvoices = invoicesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      issueDate: doc.data().issueDate?.toDate?.() || null,
      createdAt: doc.data().createdAt?.toDate?.() || null
    }));

    // Generate historical data for the last N months
    const historicalData = [];
    const now = new Date();
    
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      
      const monthBookings = allBookings.filter(booking => {
        const bookingDate = new Date(booking.bookingDate);
        return bookingDate >= monthStart && bookingDate <= monthEnd && (isConfirmed(booking.status) || isPending(booking.status));
      });
      
      const bookings = monthBookings.length;

      // Revenue: prefer invoices issued in the month; fallback to confirmed booking values
      const monthInvoices = allInvoices.filter(inv => {
        const d = inv.issueDate || inv.createdAt || null;
        return d && d >= monthStart && d <= monthEnd;
      });
      const revenueFromInvoices = monthInvoices.reduce((sum, inv) => sum + getInvoiceTotal(inv), 0);
      const revenueFromBookings = monthBookings
        .filter(b => isConfirmed(b.status))
        .reduce((sum, b) => sum + getBookingRevenue(b), 0);
      const revenue = Math.max(revenueFromInvoices, revenueFromBookings);
      
      historicalData.push({
        month: monthStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
        bookings,
        revenue
      });
    }

    res.json({ historicalData });

  } catch (error) {
    console.error('Error fetching historical data:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/pipeline-data - Get pipeline data (upcoming bookings)
router.get('/pipeline-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { months = 6, hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Generate pipeline data for the next N months
    const pipelineData = [];
    const now = new Date();
    
    for (let i = 1; i <= parseInt(months); i++) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);
      
      const monthBookings = allBookings.filter(booking => {
        const bookingDate = new Date(booking.bookingDate);
        return bookingDate >= monthStart && bookingDate <= monthEnd && 
               (isPending(booking.status) || isConfirmed(booking.status));
      });
      
      const bookings = monthBookings.length;
      const revenue = monthBookings.reduce((sum, b) => sum + getBookingRevenue(b), 0);
      
      pipelineData.push({
        month: monthStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
        bookings,
        revenue
      });
    }

    res.json({ pipelineData });

  } catch (error) {
    console.error('Error fetching pipeline data:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/funnel-data - Get booking funnel data
router.get('/funnel-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { period = '90d', hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    const dateRanges = getDateRanges(period);
    
    // Get all bookings for this hall owner in the period
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Filter bookings by period
    const periodBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startDate && bookingDate <= dateRanges.endDate;
    });

    // Calculate funnel stages
    const requests = periodBookings.length; // All bookings in period
    const pending = periodBookings.filter(b => b.status === 'pending').length;
    const hold = periodBookings.filter(b => b.status === 'pending' && 
      b.createdAt && (new Date() - b.createdAt) > (2 * 24 * 60 * 60 * 1000)).length; // Pending > 2 days
    const confirmed = periodBookings.filter(b => b.status === 'confirmed').length;
    const completed = periodBookings.filter(b => b.status === 'completed').length;

    const funnelData = [
      { 
        stage: 'Requests', 
        count: requests, 
        dropoff: 0 
      },
      { 
        stage: 'Pending', 
        count: pending, 
        dropoff: requests - pending,
        reason: 'Incomplete info' 
      },
      { 
        stage: 'Hold', 
        count: hold, 
        dropoff: pending - hold,
        reason: 'Conflicts detected' 
      },
      { 
        stage: 'Confirmed', 
        count: confirmed, 
        dropoff: hold - confirmed,
        reason: 'Deposit not paid' 
      },
      { 
        stage: 'Completed', 
        count: completed, 
        dropoff: confirmed - completed,
        reason: 'Last-minute cancellations' 
      }
    ];

    res.json({ funnelData });

  } catch (error) {
    console.error('Error fetching funnel data:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/payment-analysis - Get payment analysis data
router.get('/payment-analysis', verifyToken, async (req, res) => {
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    // Get all confirmed bookings for this hall owner
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

    // Calculate payment metrics
    const totalBookings = confirmedBookings.length;
    const onTimeBookings = confirmedBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      const today = new Date();
      return bookingDate >= today; // Future bookings are considered "on time"
    }).length;
    
    const onTime = totalBookings > 0 ? Math.round((onTimeBookings / totalBookings) * 100) : 0;
    const overdue = 100 - onTime;

    // Calculate aging buckets (simplified)
    const aging = [
      { bucket: '0-30 days', amount: 0, count: 0 },
      { bucket: '31-60 days', amount: 0, count: 0 },
      { bucket: '61-90 days', amount: 0, count: 0 },
      { bucket: '90+ days', amount: 0, count: 0 }
    ];

    confirmedBookings.forEach(booking => {
      const bookingDate = new Date(booking.bookingDate);
      const today = new Date();
      const daysDiff = Math.ceil((today - bookingDate) / (1000 * 60 * 60 * 24));
      const amount = booking.calculatedPrice || 0;
      
      if (daysDiff <= 30) {
        aging[0].amount += amount;
        aging[0].count += 1;
      } else if (daysDiff <= 60) {
        aging[1].amount += amount;
        aging[1].count += 1;
      } else if (daysDiff <= 90) {
        aging[2].amount += amount;
        aging[2].count += 1;
      } else {
        aging[3].amount += amount;
        aging[3].count += 1;
      }
    });

    const paymentData = {
      onTime,
      overdue,
      aging
    };

    res.json({ paymentData });

  } catch (error) {
    console.error('Error fetching payment analysis:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/resource-utilisation - Get resource utilisation data
router.get('/resource-utilisation', verifyToken, async (req, res) => {
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    // Get all resources for this hall owner
    const resourcesSnapshot = await admin.firestore()
      .collection('resources')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const resources = resourcesSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      capacity: doc.data().capacity
    }));

    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Generate utilisation data for each resource
    const utilisationData = resources.map(resource => {
      const resourceBookings = allBookings.filter(booking => 
        booking.selectedHall === resource.id && booking.status === 'confirmed'
      );

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM to 10 PM
      
      const data = days.map(day => {
        const dayBookings = resourceBookings.filter(booking => {
          const bookingDate = new Date(booking.bookingDate);
          return bookingDate.getDay() === days.indexOf(day);
        });

        const utilisation = hours.map(hour => {
          const hourBookings = dayBookings.filter(booking => {
            const startHour = parseInt(booking.startTime.split(':')[0]);
            const endHour = parseInt(booking.endTime.split(':')[0]);
            return hour >= startHour && hour < endHour;
          });

          const rate = hourBookings.length > 0 ? 100 : Math.random() * 30; // Random for demo
          return {
            hour: `${hour.toString().padStart(2, '0')}:00`,
            rate,
            hasBuffers: Math.random() > 0.7,
            isSetup: Math.random() > 0.8,
            isPackdown: Math.random() > 0.85
          };
        });

        return { day, utilisation };
      });

      return {
        name: resource.name,
        data
      };
    });

    res.json({ utilisationData });

  } catch (error) {
    console.error('Error fetching resource utilisation:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/cancellation-reasons - Get cancellation analysis
router.get('/cancellation-reasons', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { period = '90d', hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    const dateRanges = getDateRanges(period);
    
    // Get all cancelled bookings for this hall owner in the period
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .where('status', '==', 'cancelled')
      .get();

    const cancelledBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Filter by period
    const periodCancellations = cancelledBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startDate && bookingDate <= dateRanges.endDate;
    });

    // Simulate cancellation reasons (in real app, this would be stored in booking data)
    const totalCancellations = periodCancellations.length;
    const cancellationData = [
      { reason: 'Customer request', count: Math.round(totalCancellations * 0.4), rate: 40 },
      { reason: 'Weather', count: Math.round(totalCancellations * 0.3), rate: 30 },
      { reason: 'Policy violation', count: Math.round(totalCancellations * 0.2), rate: 20 },
      { reason: 'Schedule conflict', count: Math.round(totalCancellations * 0.1), rate: 10 }
    ];

    res.json({ cancellationData, totalCancellations });

  } catch (error) {
    console.error('Error fetching cancellation reasons:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/forecast - Get forecast data
router.get('/forecast', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { periods = 6, hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Generate historical data for the last 6 months
    const historicalData = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      
      const monthBookings = allBookings.filter(booking => {
        const bookingDate = new Date(booking.bookingDate);
        return bookingDate >= monthStart && bookingDate <= monthEnd && booking.status === 'confirmed';
      });
      
      const bookings = monthBookings.length;
      const revenue = monthBookings.reduce((sum, b) => sum + (b.calculatedPrice || 0), 0);
      
      historicalData.push({
        month: monthStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
        bookings,
        revenue
      });
    }

    // Generate forecast data
    const forecastData = generateForecastData(historicalData, parseInt(periods));

    res.json({ 
      historicalData,
      forecastData,
      scenarios: {
        base: forecastData,
        optimistic: forecastData.map(item => ({
          ...item,
          bookings: Math.round(item.bookings * 1.15),
          revenue: Math.round(item.revenue * 1.15)
        })),
        cautious: forecastData.map(item => ({
          ...item,
          bookings: Math.round(item.bookings * 0.85),
          revenue: Math.round(item.revenue * 0.85)
        }))
      }
    });

  } catch (error) {
    console.error('Error fetching forecast data:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/reports/summary - Get comprehensive summary
router.get('/summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { period = '90d', hallOwnerId } = req.query;
    
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
      return res.status(403).json({ message: 'Access denied. Only hall owners, sub-users, and super admins can view reports.' });
    }

    const dateRanges = getDateRanges(period);
    
    // Get all bookings for this hall owner
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', dataUserId)
      .get();

    const allBookings = bookingsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || null,
      updatedAt: doc.data().updatedAt?.toDate?.() || null
    }));

    // Filter bookings by period
    const periodBookings = allBookings.filter(booking => {
      const bookingDate = new Date(booking.bookingDate);
      return bookingDate >= dateRanges.startDate && bookingDate <= dateRanges.endDate;
    });

    // Calculate comprehensive metrics
    const confirmedBookings = periodBookings.filter(b => b.status === 'confirmed');
    const totalRevenue = confirmedBookings.reduce((sum, b) => sum + (b.calculatedPrice || 0), 0);
    const averageBookingValue = confirmedBookings.length > 0 ? totalRevenue / confirmedBookings.length : 0;
    
    // Customer metrics
    const uniqueCustomers = new Set(periodBookings.map(b => b.customerEmail)).size;
    
    // Resource utilization
    const totalBookedHours = confirmedBookings.reduce((sum, booking) => {
      const start = new Date(`2000-01-01T${booking.startTime}:00`);
      const end = new Date(`2000-01-01T${booking.endTime}:00`);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      return sum + hours;
    }, 0);
    
    const totalAvailableHours = 12 * 30; // 12 hours per day for 30 days
    const utilization = totalAvailableHours > 0 ? (totalBookedHours / totalAvailableHours) * 100 : 0;
    
    // Conversion metrics
    const totalRequests = periodBookings.length;
    const conversionRate = totalRequests > 0 ? (confirmedBookings.length / totalRequests) * 100 : 0;
    
    const summary = {
      period,
      dateRange: { start: dateRanges.startDate, end: dateRanges.endDate },
      metrics: {
        totalBookings: confirmedBookings.length,
        totalRevenue,
        averageBookingValue: Math.round(averageBookingValue * 100) / 100,
        uniqueCustomers,
        utilization: Math.round(utilization * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        totalRequests
      },
      breakdown: {
        byStatus: {
          confirmed: confirmedBookings.length,
          pending: periodBookings.filter(b => b.status === 'pending').length,
          cancelled: periodBookings.filter(b => b.status === 'cancelled').length,
          completed: periodBookings.filter(b => b.status === 'completed').length
        },
        byEventType: periodBookings.reduce((acc, booking) => {
          acc[booking.eventType] = (acc[booking.eventType] || 0) + 1;
          return acc;
        }, {})
      }
    };

    res.json(summary);

  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
