const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  let token;

  // Check for token in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Not authorized, user not found'
        });
      }

      // Check if user is active
      if (!req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account has been deactivated'
        });
      }

      next();
    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`
      });
    }

    next();
  };
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Token is invalid, but we continue without user
      req.user = null;
    }
  }

  next();
};

// Check if user owns the resource
const checkOwnership = (resourceModel, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      const resource = await resourceModel.findById(req.params[resourceIdParam]);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      // Check if user owns the resource or is admin
      if (resource.owner && !resource.owner.equals(req.user._id) && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this resource'
        });
      }

      // For orders, check if user is customer, restaurant owner, or driver
      if (resourceModel.modelName === 'Order') {
        const isAuthorized = 
          resource.customer.equals(req.user._id) ||
          (resource.deliveryDriver && resource.deliveryDriver.equals(req.user._id)) ||
          req.user.role === 'admin';

        if (!isAuthorized) {
          // Check if user owns the restaurant
          const Restaurant = require('../models/Restaurant');
          const restaurant = await Restaurant.findOne({ 
            _id: resource.restaurant, 
            owner: req.user._id 
          });

          if (!restaurant) {
            return res.status(403).json({
              success: false,
              message: 'Not authorized to access this order'
            });
          }
        }
      }

      req.resource = resource;
      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error during authorization check'
      });
    }
  };
};

// Rate limiting for authentication endpoints
// const authRateLimit = (req, res, next) => {
//   // This would typically use Redis or similar for production
//   // For now, we'll use a simple in-memory store
//   const attempts = req.session?.loginAttempts || 0;
//   const lastAttempt = req.session?.lastLoginAttempt || 0;
//   const now = Date.now();

//   // Reset attempts after 15 minutes
//   if (now - lastAttempt > 15 * 60 * 1000) {
//     req.session.loginAttempts = 0;
//   }

//   if (attempts >= 5) {
//     return res.status(429).json({
//       success: false,
//       message: 'Too many login attempts. Please try again in 15 minutes.'
//     });
//   }

//   next();
// };

const loginAttempts = {};

const authRateLimit = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const record = loginAttempts[ip] || { attempts: 0, lastAttempt: 0 };

  // Reset after 15 minutes
  if (now - record.lastAttempt > 15 * 60 * 1000) {
    record.attempts = 0;
  }

  // Block if too many attempts
  if (record.attempts >= 5) {
    return res.status(429).json({
      success: false,
      message: 'Too many login attempts. Please try again in 15 minutes.'
    });
  }

  loginAttempts[ip] = record;
  next();
};


// Middleware to track login attempts
const trackLoginAttempt = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    if (res.statusCode === 401) {
      req.session = req.session || {};
      req.session.loginAttempts = (req.session.loginAttempts || 0) + 1;
      req.session.lastLoginAttempt = Date.now();
    } else if (res.statusCode === 200) {
      // Reset on successful login
      if (req.session) {
        req.session.loginAttempts = 0;
      }
    }
    
    originalSend.call(this, data);
  };
  
  next();
};

module.exports = {
  protect,
  authorize,
  optionalAuth,
  checkOwnership,
  authRateLimit,
  trackLoginAttempt
};

