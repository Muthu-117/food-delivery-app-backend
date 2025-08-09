const express = require('express');
const { body, validationResult } = require('express-validator');
const Restaurant = require('../models/Restaurant');
const Menu = require('../models/Menu');
const Order = require('../models/Order');
const Review = require('../models/Review');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all restaurants with filtering and search
// @route   GET /api/restaurants
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    // Build query
    let query = { isActive: true };

    // Search by name, cuisine, or tags
    if (req.query.search) {
      query.$text = { $search: req.query.search };
    }

    // Filter by cuisine type
    if (req.query.cuisine) {
      query.cuisineTypes = { $in: req.query.cuisine.split(',') };
    }

    // Filter by price range
    if (req.query.priceRange) {
      query.priceRange = { $in: req.query.priceRange.split(',') };
    }

    // Filter by rating
    if (req.query.minRating) {
      query['rating.average'] = { $gte: parseFloat(req.query.minRating) };
    }

    // Filter by features
    if (req.query.features) {
      query.features = { $in: req.query.features.split(',') };
    }

    // Filter by delivery fee
    if (req.query.maxDeliveryFee) {
      query['deliveryInfo.deliveryFee'] = { $lte: parseFloat(req.query.maxDeliveryFee) };
    }

    // Geospatial search (restaurants near location)
    if (req.query.lat && req.query.lng && req.query.radius) {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.lng);
      const radius = parseFloat(req.query.radius) * 1000; // Convert km to meters

      query['address.coordinates'] = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          },
          $maxDistance: radius
        }
      };
    }

    // Sort options
    let sort = {};
    switch (req.query.sortBy) {
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      case 'deliveryTime':
        sort = { 'deliveryInfo.estimatedDeliveryTime': 1 };
        break;
      case 'deliveryFee':
        sort = { 'deliveryInfo.deliveryFee': 1 };
        break;
      case 'popularity':
        sort = { totalOrders: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const restaurants = await Restaurant.find(query)
      .populate('owner', 'name')
      .select('-owner.password')
      .skip(skip)
      .limit(limit)
      .sort(sort);

    const total = await Restaurant.countDocuments(query);

    // Add distance if geospatial search was performed
    const restaurantsWithDistance = restaurants.map(restaurant => {
      const restaurantObj = restaurant.toObject();
      
      // Calculate distance if user location provided
      if (req.query.lat && req.query.lng) {
        const userLat = parseFloat(req.query.lat);
        const userLng = parseFloat(req.query.lng);
        const restLat = restaurant.address.coordinates.latitude;
        const restLng = restaurant.address.coordinates.longitude;
        
        // Haversine formula for distance calculation
        const R = 6371; // Earth's radius in km
        const dLat = (restLat - userLat) * Math.PI / 180;
        const dLng = (restLng - userLng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(userLat * Math.PI / 180) * Math.cos(restLat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        
        restaurantObj.distance = Math.round(distance * 10) / 10; // Round to 1 decimal
      }
      
      return restaurantObj;
    });

    res.status(200).json({
      success: true,
      count: restaurants.length,
      total,
      pagination: {
        page,
        pages: Math.ceil(total / limit)
      },
      data: restaurantsWithDistance
    });

  } catch (error) {
    console.error('Get restaurants error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single restaurant
// @route   GET /api/restaurants/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate('owner', 'name email phone');

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Get restaurant menu
    const menu = await Menu.findOne({ restaurant: req.params.id, isActive: true })
      .populate('items');

    // Get recent reviews
    const reviews = await Review.find({ 
      restaurant: req.params.id, 
      status: 'approved' 
    })
      .populate('customer', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get rating statistics
    const ratingStats = await Review.getRestaurantAverageRating(req.params.id);

    const restaurantData = {
      ...restaurant.toObject(),
      menu: menu || null,
      reviews,
      ratingStats
    };

    res.status(200).json({
      success: true,
      data: restaurantData
    });

  } catch (error) {
    console.error('Get restaurant error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create restaurant
// @route   POST /api/restaurants
// @access  Private/Restaurant Owner
router.post('/', [
  protect,
  authorize('restaurant_owner', 'admin'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Restaurant name must be between 2 and 100 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Description must be between 10 and 500 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .matches(/^\+?[\d\s-()]+$/)
    .withMessage('Please provide a valid phone number'),
  body('address.street')
    .notEmpty()
    .withMessage('Street address is required'),
  body('address.city')
    .notEmpty()
    .withMessage('City is required'),
  body('address.state')
    .notEmpty()
    .withMessage('State is required'),
  body('address.zipCode')
    .notEmpty()
    .withMessage('Zip code is required'),
  body('cuisineTypes')
    .isArray({ min: 1 })
    .withMessage('At least one cuisine type is required'),
  body('priceRange')
    .isIn(['$', '$$', '$$$', '$$$$'])
    .withMessage('Invalid price range')
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

    // Check if user already owns a restaurant
    const existingRestaurant = await Restaurant.findOne({ owner: req.user.id });
    if (existingRestaurant && req.user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'You already own a restaurant'
      });
    }

    const restaurantData = {
      ...req.body,
      owner: req.user.id
    };

    const restaurant = await Restaurant.create(restaurantData);

    // Create default menu for the restaurant
    await Menu.create({
      restaurant: restaurant._id,
      name: 'Main Menu',
      description: `Menu for ${restaurant.name}`,
      items: []
    });

    res.status(201).json({
      success: true,
      message: 'Restaurant created successfully',
      data: restaurant
    });

  } catch (error) {
    console.error('Create restaurant error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update restaurant
// @route   PUT /api/restaurants/:id
// @access  Private/Restaurant Owner
router.put('/:id', protect, async (req, res) => {
  try {
    let restaurant = await Restaurant.findById(req.params.id);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check ownership
    if (restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this restaurant'
      });
    }

    // Fields that can be updated
    const allowedFields = [
      'name', 'description', 'email', 'phone', 'address', 'cuisineTypes',
      'priceRange', 'images', 'logo', 'coverImage', 'operatingHours',
      'deliveryInfo', 'features', 'socialMedia', 'tags', 'specialOffers'
    ];

    const updateData = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    restaurant = await Restaurant.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Restaurant updated successfully',
      data: restaurant
    });

  } catch (error) {
    console.error('Update restaurant error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete restaurant
// @route   DELETE /api/restaurants/:id
// @access  Private/Restaurant Owner
router.delete('/:id', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check ownership
    if (restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this restaurant'
      });
    }

    // Check for active orders
    const activeOrders = await Order.countDocuments({
      restaurant: req.params.id,
      status: { $in: ['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] }
    });

    if (activeOrders > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete restaurant with active orders'
      });
    }

    // Soft delete - just deactivate
    restaurant.isActive = false;
    await restaurant.save();

    res.status(200).json({
      success: true,
      message: 'Restaurant deactivated successfully'
    });

  } catch (error) {
    console.error('Delete restaurant error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get restaurant orders
// @route   GET /api/restaurants/:id/orders
// @access  Private/Restaurant Owner
router.get('/:id/orders', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check ownership
    if (restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these orders'
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let query = { restaurant: req.params.id };

    // Filter by status
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Filter by date range
    if (req.query.startDate && req.query.endDate) {
      query.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const orders = await Order.find(query)
      .populate('customer', 'name phone email')
      .populate('deliveryDriver', 'name phone')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments(query);

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
    console.error('Get restaurant orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get restaurant analytics
// @route   GET /api/restaurants/:id/analytics
// @access  Private/Restaurant Owner
router.get('/:id/analytics', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Check ownership
    if (restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view analytics'
      });
    }

    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // Order statistics
    const orderStats = await Order.aggregate([
      {
        $match: {
          restaurant: restaurant._id,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$pricing.total' },
          averageOrderValue: { $avg: '$pricing.total' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          }
        }
      }
    ]);

    // Popular items
    const popularItems = await Order.aggregate([
      { $match: { restaurant: restaurant._id, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          orderCount: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.subtotal' }
        }
      },
      { $sort: { orderCount: -1 } },
      { $limit: 10 }
    ]);

    // Rating statistics
    const ratingStats = await Review.getRestaurantAverageRating(req.params.id);

    const analytics = {
      orderStats: orderStats[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        completedOrders: 0,
        cancelledOrders: 0
      },
      popularItems,
      ratingStats,
      period: {
        startDate,
        endDate
      }
    };

    res.status(200).json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Get restaurant analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

