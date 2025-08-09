const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all users (admin only)
// @route   GET /api/users
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments();

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      pagination: {
        page,
        pages: Math.ceil(total / limit)
      },
      data: users
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private/Admin or Own Profile
router.get('/:id', protect, async (req, res) => {
  try {
    // Check if user is admin or accessing own profile
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this profile'
      });
    }

    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('favoriteRestaurants', 'name logo rating')
      .populate('orderHistory', 'orderNumber status total createdAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add address to user profile
// @route   POST /api/users/addresses
// @access  Private
router.post('/addresses', [
  protect,
  body('type')
    .isIn(['home', 'work', 'other'])
    .withMessage('Address type must be home, work, or other'),
  body('street')
    .notEmpty()
    .withMessage('Street address is required'),
  body('city')
    .notEmpty()
    .withMessage('City is required'),
  body('state')
    .notEmpty()
    .withMessage('State is required'),
  body('zipCode')
    .notEmpty()
    .withMessage('Zip code is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.id);
    
    const newAddress = {
      type: req.body.type,
      street: req.body.street,
      city: req.body.city,
      state: req.body.state,
      zipCode: req.body.zipCode,
      coordinates: req.body.coordinates,
      isDefault: req.body.isDefault || user.addresses.length === 0
    };

    // If this is set as default, unset other defaults
    if (newAddress.isDefault) {
      user.addresses.forEach(addr => addr.isDefault = false);
    }

    user.addresses.push(newAddress);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: user.addresses
    });

  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update address
// @route   PUT /api/users/addresses/:addressId
// @access  Private
router.put('/addresses/:addressId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // Update address fields
    const allowedFields = ['type', 'street', 'city', 'state', 'zipCode', 'coordinates', 'isDefault'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        address[field] = req.body[field];
      }
    });

    // If this is set as default, unset other defaults
    if (req.body.isDefault) {
      user.addresses.forEach(addr => {
        if (!addr._id.equals(address._id)) {
          addr.isDefault = false;
        }
      });
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: user.addresses
    });

  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete address
// @route   DELETE /api/users/addresses/:addressId
// @access  Private
router.delete('/addresses/:addressId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const address = user.addresses.id(req.params.addressId);

    if (!address) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    address.remove();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
      data: user.addresses
    });

  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add payment method
// @route   POST /api/users/payment-methods
// @access  Private
router.post('/payment-methods', [
  protect,
  body('type')
    .isIn(['card', 'paypal', 'wallet'])
    .withMessage('Payment type must be card, paypal, or wallet'),
  body('cardHolderName')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Card holder name must be at least 2 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.user.id);
    
    const newPaymentMethod = {
      type: req.body.type,
      cardHolderName: req.body.cardHolderName,
      isDefault: req.body.isDefault || user.paymentMethods.length === 0,
      stripePaymentMethodId: req.body.stripePaymentMethodId
    };

    // If this is set as default, unset other defaults
    if (newPaymentMethod.isDefault) {
      user.paymentMethods.forEach(pm => pm.isDefault = false);
    }

    user.paymentMethods.push(newPaymentMethod);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: user.paymentMethods
    });

  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete payment method
// @route   DELETE /api/users/payment-methods/:paymentId
// @access  Private
router.delete('/payment-methods/:paymentId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const paymentMethod = user.paymentMethods.id(req.params.paymentId);

    if (!paymentMethod) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    paymentMethod.remove();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Payment method deleted successfully',
      data: user.paymentMethods
    });

  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add restaurant to favorites
// @route   POST /api/users/favorites/:restaurantId
// @access  Private
router.post('/favorites/:restaurantId', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    const user = await User.findById(req.user.id);
    
    // Check if already in favorites
    if (user.favoriteRestaurants.includes(req.params.restaurantId)) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant already in favorites'
      });
    }

    user.favoriteRestaurants.push(req.params.restaurantId);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Restaurant added to favorites',
      data: user.favoriteRestaurants
    });

  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Remove restaurant from favorites
// @route   DELETE /api/users/favorites/:restaurantId
// @access  Private
router.delete('/favorites/:restaurantId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    user.favoriteRestaurants = user.favoriteRestaurants.filter(
      id => !id.equals(req.params.restaurantId)
    );
    
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Restaurant removed from favorites',
      data: user.favoriteRestaurants
    });

  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user's order history
// @route   GET /api/users/orders
// @access  Private
router.get('/orders', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({ customer: req.user.id })
      .populate('restaurant', 'name logo')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments({ customer: req.user.id });

    res.status(200).json({
      success: true,
      count: orders.length,
      total,
      pagination: {
        page,
        pages: Math.ceil(total / limit)
      },
      data: orders
    });

  } catch (error) {
    console.error('Get order history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user preferences
// @route   PUT /api/users/preferences
// @access  Private
router.put('/preferences', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (req.body.preferences) {
      user.preferences = { ...user.preferences, ...req.body.preferences };
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: 'Preferences updated successfully',
      data: user.preferences
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Deactivate user account
// @route   PUT /api/users/deactivate
// @access  Private
router.put('/deactivate', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.isActive = false;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

