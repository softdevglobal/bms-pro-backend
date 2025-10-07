const admin = require('../firebaseAdmin');

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('Authorization header:', authHeader);
    
    const token = authHeader?.split(' ')[1];
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ message: 'No token provided' });
    }

    console.log('Token received:', token.substring(0, 20) + '...');
    
    // Try to verify as JWT first
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      console.log('JWT decoded:', decoded);
      req.user = decoded;
      next();
    } catch (jwtError) {
      console.log('JWT verification failed:', jwtError.message);
      
      // Check if it's an expired token error
      if (jwtError.name === 'TokenExpiredError') {
        console.log('Token has expired');
        return res.status(401).json({ 
          message: 'Token has expired', 
          code: 'TOKEN_EXPIRED' 
        });
      }
      
      // Check if it's a malformed token
      if (jwtError.name === 'JsonWebTokenError') {
        console.log('Invalid JWT token format');
        return res.status(401).json({ 
          message: 'Invalid token format', 
          code: 'INVALID_TOKEN' 
        });
      }
      
      // For other JWT errors, try Firebase token verification
      try {
        console.log('Trying Firebase token verification...');
        const decodedToken = await admin.auth().verifyIdToken(token);
        console.log('Firebase token decoded:', decodedToken);
        req.user = decodedToken;
        next();
      } catch (firebaseError) {
        console.log('Firebase token verification failed:', firebaseError.message);
        
        // Handle specific Firebase errors
        if (firebaseError.code === 'auth/argument-error') {
          return res.status(401).json({ 
            message: 'Invalid Firebase token format', 
            code: 'INVALID_FIREBASE_TOKEN' 
          });
        }
        
        if (firebaseError.code === 'auth/id-token-expired') {
          return res.status(401).json({ 
            message: 'Firebase token has expired', 
            code: 'FIREBASE_TOKEN_EXPIRED' 
          });
        }
        
        // Generic error for other Firebase issues
        return res.status(401).json({ 
          message: 'Token verification failed', 
          code: 'TOKEN_VERIFICATION_FAILED' 
        });
      }
    }
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ 
      message: 'Authentication failed', 
      code: 'AUTH_FAILED' 
    });
  }
};

module.exports = {
  verifyToken
};
