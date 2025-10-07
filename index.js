const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('./firebaseAdmin');
const { captureIP } = require('./middleware/auditMiddleware');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(captureIP); // Capture IP addresses for all requests


// Auth routes
const authRoutes = require('./routes/auth');
app.use('/api', authRoutes);

// Users routes
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// Resources routes
const resourcesRoutes = require('./routes/resources');
app.use('/api/resources', resourcesRoutes);

// Pricing routes
const pricingRoutes = require('./routes/pricing');
app.use('/api/pricing', pricingRoutes);

// Bookings routes
const bookingsRoutes = require('./routes/bookings');
app.use('/api/bookings', bookingsRoutes);

// Notifications routes
const notificationsRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationsRoutes);

// Dashboard routes
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);

// Reports routes
const reportsRoutes = require('./routes/reports');
app.use('/api/reports', reportsRoutes);

// Audit routes
const auditRoutes = require('./routes/audit');
app.use('/api/audit', auditRoutes);

// Email Templates routes
const emailTemplatesRoutes = require('./routes/emailTemplates');
app.use('/api/email-templates', emailTemplatesRoutes);

// Email Communications routes
const emailCommsRoutes = require('./routes/emailComms');
app.use('/api/email-comms', emailCommsRoutes);

// Invoices routes
const invoicesRoutes = require('./routes/invoices');
app.use('/api/invoices', invoicesRoutes);

// Payments routes
const paymentsRoutes = require('./routes/payments');
app.use('/api/payments', paymentsRoutes);

// Quotations routes
const quotationsRoutes = require('./routes/quotations');
app.use('/api/quotations', quotationsRoutes);

// Login endpoint (verifies Firebase ID token and returns custom JWT)
app.post('/api/login', async (req, res) => {
  const { idToken } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
  
  if (!idToken) {
    return res.status(400).json({ message: 'ID token is required' });
  }
  
  try {
    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    
    // Get user data from Firestore
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found in database' });
    }
    
    const userData = userDoc.data();
    
    console.log('Login attempt for user:', decodedToken.email);
    console.log('User data from Firestore:', JSON.stringify(userData, null, 2));
    
    // Create custom JWT token
    const token = jwt.sign(
      { 
        uid: uid, 
        email: decodedToken.email, 
        role: userData.role 
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Log successful login
    const AuditService = require('./services/auditService');
    const hallId = userData.hallId || 
                   (userData.role === 'hall_owner' ? uid : null) ||
                   (userData.role === 'sub_user' && userData.parentUserId ? userData.parentUserId : null);
    
    await AuditService.logUserLogin(
      uid,
      decodedToken.email,
      userData.role,
      ipAddress,
      hallId
    );
    
    res.json({ 
      token, 
      role: userData.role,
      uid: uid,
      email: decodedToken.email
    });
  } catch (error) {
    console.error('Login error:', error);
    
    // Handle specific Firebase Auth errors
    if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({ message: 'Invalid ID token' });
    }
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'ID token has expired' });
    }
    if (error.code === 'auth/user-disabled') {
      return res.status(401).json({ message: 'User account has been disabled' });
    }
    
    res.status(500).json({ message: 'Authentication failed' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
