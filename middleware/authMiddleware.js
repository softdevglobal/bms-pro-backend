const admin = require('../firebaseAdmin');

function parseTokenHeader(token) {
  try {
    const headerB64 = token.split('.')[0];
    const padded = headerB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Middleware to verify token (HS256 JWT first; only try Firebase for RS256 w/ kid)
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const jwt = require('jsonwebtoken');

    // Attempt HS256 JWT verification first
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = decoded;
      return next();
    } catch (jwtError) {
      // Expired -> explicit message
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Token has expired', code: 'TOKEN_EXPIRED' });
      }

      // If token looks like HS* (no kid or alg HS*), treat as invalid rather than trying Firebase
      const header = parseTokenHeader(token);
      const alg = header?.alg || '';
      const isFirebaseCandidate = Boolean(header?.kid) && alg === 'RS256';

      if (!isFirebaseCandidate) {
        return res.status(401).json({ message: 'Invalid token', code: 'INVALID_TOKEN' });
      }

      // Try Firebase only for RS256 tokens with kid
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        return next();
      } catch (firebaseError) {
        if (firebaseError.code === 'auth/id-token-expired') {
          return res.status(401).json({ message: 'Firebase token has expired', code: 'FIREBASE_TOKEN_EXPIRED' });
        }
        return res.status(401).json({ message: 'Token verification failed', code: 'TOKEN_VERIFICATION_FAILED' });
      }
    }
  } catch (error) {
    return res.status(401).json({ message: 'Authentication failed', code: 'AUTH_FAILED' });
  }
};

module.exports = { verifyToken };
