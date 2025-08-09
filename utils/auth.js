const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Generate refresh token
const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

// Send token response
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  // Create token
  const token = generateToken(user._id);
  
  // Create refresh token
  const refreshToken = generateRefreshToken();
  
  const options = {
    expires: new Date(
      Date.now() + (process.env.JWT_COOKIE_EXPIRE || 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  };

  // Remove password from output
  user.password = undefined;

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      message,
      token,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        defaultAddress: user.defaultAddress,
        defaultPaymentMethod: user.defaultPaymentMethod,
        preferences: user.preferences
      }
    });
};

// Verify email token
const verifyEmailToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Generate email verification token
const generateEmailVerificationToken = (email) => {
  return jwt.sign({ email, type: 'email_verification' }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });
};

// Generate password reset token
const generatePasswordResetToken = () => {
  // Generate token
  const resetToken = crypto.randomBytes(20).toString('hex');
  
  // Hash token
  const hashedToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  return { resetToken, hashedToken };
};

// Validate password strength
const validatePassword = (password) => {
  const errors = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/(?=.*[a-z])/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/(?=.*[A-Z])/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/(?=.*\d)/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/(?=.*[@$!%*?&])/.test(password)) {
    errors.push('Password must contain at least one special character (@$!%*?&)');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Generate OTP for phone verification
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Hash OTP for storage
const hashOTP = (otp) => {
  return crypto
    .createHash('sha256')
    .update(otp)
    .digest('hex');
};

// Verify OTP
const verifyOTP = (inputOTP, hashedOTP) => {
  const hashedInput = crypto
    .createHash('sha256')
    .update(inputOTP)
    .digest('hex');
    
  return hashedInput === hashedOTP;
};

// Generate secure session ID
const generateSessionId = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Create user session data
const createUserSession = (user) => {
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    lastActivity: new Date(),
    sessionId: generateSessionId()
  };
};

// Sanitize user data for response
const sanitizeUser = (user) => {
  const userObject = user.toObject ? user.toObject() : user;
  
  // Remove sensitive fields
  delete userObject.password;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpire;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpire;
  
  // Remove sensitive payment method data
  if (userObject.paymentMethods) {
    userObject.paymentMethods = userObject.paymentMethods.map(pm => ({
      _id: pm._id,
      type: pm.type,
      cardHolderName: pm.cardHolderName,
      isDefault: pm.isDefault,
      // Don't include card numbers or other sensitive data
    }));
  }
  
  return userObject;
};

// Check if user has permission for action
const hasPermission = (user, action, resource = null) => {
  const permissions = {
    admin: ['*'], // Admin can do everything
    restaurant_owner: [
      'manage_restaurant',
      'manage_menu',
      'view_orders',
      'update_order_status',
      'respond_to_reviews'
    ],
    delivery_driver: [
      'view_assigned_orders',
      'update_delivery_status',
      'view_delivery_route'
    ],
    customer: [
      'place_order',
      'view_own_orders',
      'cancel_own_order',
      'leave_review',
      'manage_profile'
    ]
  };
  
  const userPermissions = permissions[user.role] || [];
  
  // Admin has all permissions
  if (userPermissions.includes('*')) {
    return true;
  }
  
  // Check specific permission
  if (userPermissions.includes(action)) {
    return true;
  }
  
  // Resource-specific checks
  if (resource) {
    switch (action) {
      case 'manage_restaurant':
        return resource.owner && resource.owner.equals(user._id);
      case 'view_order':
        return resource.customer.equals(user._id) || 
               (resource.deliveryDriver && resource.deliveryDriver.equals(user._id));
      case 'cancel_order':
        return resource.customer.equals(user._id) && 
               ['pending', 'confirmed'].includes(resource.status);
      default:
        return false;
    }
  }
  
  return false;
};

module.exports = {
  generateToken,
  generateRefreshToken,
  sendTokenResponse,
  verifyEmailToken,
  generateEmailVerificationToken,
  generatePasswordResetToken,
  validatePassword,
  generateOTP,
  hashOTP,
  verifyOTP,
  generateSessionId,
  createUserSession,
  sanitizeUser,
  hasPermission
};

