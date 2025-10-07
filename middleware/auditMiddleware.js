const AuditService = require('../services/auditService');

// Middleware to capture IP address for audit logging
const captureIP = (req, res, next) => {
  req.ipAddress = req.ip || 
                  req.connection.remoteAddress || 
                  req.socket.remoteAddress ||
                  (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                  req.headers['x-forwarded-for']?.split(',')[0] ||
                  req.headers['x-real-ip'] ||
                  'unknown';
  next();
};

// Middleware to log user logout (when token expires or is invalid)
const logUserLogout = async (req, res, next) => {
  // Store original send function
  const originalSend = res.send;
  
  // Override send function to capture logout events
  res.send = function(data) {
    // Check if this is a 401 response (unauthorized)
    if (res.statusCode === 401 && req.user) {
      // Log logout event asynchronously
      AuditService.logUserLogout(
        req.user.uid,
        req.user.email,
        req.user.role,
        req.ipAddress,
        req.user.hallId || (req.user.role === 'hall_owner' ? req.user.uid : null)
      ).catch(err => {
        console.error('Error logging user logout:', err);
      });
    }
    
    // Call original send function
    originalSend.call(this, data);
  };
  
  next();
};

module.exports = {
  captureIP,
  logUserLogout
};
