const express = require('express');
const { body, validationResult } = require('express-validator');
const Review = require('../models/Review');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @desc    Get reviews for a restaurant
// @route   GET /api/reviews/restaurant/:restaurantId
// @access  Public
router.get('/restaurant/:restaurantId', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const restaurant = await Restaurant.findById(req.params.restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    let query = { 
      restaurant: req.params.restaurantId, 
      status: 'approved' 
    };

    // Filter by rating
    if (req.query.rating) {
      query['rating.overall'] = parseInt(req.query.rating);
    }

    // Filter by tags
    if (req.query.tags) {
      query.tags = { $in: req.query.tags.split(',') };
    }

    // Sort options
    let sort = {};
    switch (req.query.sortBy) {
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'oldest':
        sort = { createdAt: 1 };
        break;
      case 'highest_rating':
        sort = { 'rating.overall': -1 };
        break;
      case 'lowest_rating':
        sort = { 'rating.overall': 1 };
        break;
      case 'most_helpful':
        sort = { helpfulVotes: -1 };
        break;
      default:
        sort = { createdAt: -1 };
    }

    const reviews = await Review.find(query)
      .populate('customer', 'name avatar')
      .populate('order', 'orderNumber createdAt')
      .skip(skip)
      .limit(limit)
      .sort(sort);

    const total = await Review.countDocuments(query);

    // Get rating statistics
    const ratingStats = await Review.getRestaurantAverageRating(req.params.restaurantId);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      pagination: {
        page,
        pages: Math.ceil(total / limit)
      },
      ratingStats,
      data: reviews
    });

  } catch (error) {
    console.error('Get restaurant reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single review
// @route   GET /api/reviews/:id
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('customer', 'name avatar')
      .populate('restaurant', 'name logo')
      .populate('order', 'orderNumber createdAt items');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.status(200).json({
      success: true,
      data: review
    });

  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create review
// @route   POST /api/reviews
// @access  Private/Customer
router.post('/', [
  protect,
  body('restaurant')
    .isMongoId()
    .withMessage('Valid restaurant ID is required'),
  body('order')
    .isMongoId()
    .withMessage('Valid order ID is required'),
  body('rating.overall')
    .isInt({ min: 1, max: 5 })
    .withMessage('Overall rating must be between 1 and 5'),
  body('comment')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Comment must be between 10 and 1000 characters'),
  body('title')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Title cannot exceed 100 characters')
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

    const { restaurant: restaurantId, order: orderId } = req.body;

    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (!order.customer.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to review this order'
      });
    }

    // Check if order is delivered
    if (order.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Can only review delivered orders'
      });
    }

    // Check if review already exists for this order
    const existingReview = await Review.findOne({ 
      customer: req.user.id, 
      order: orderId 
    });

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Review already exists for this order'
      });
    }

    // Verify restaurant matches order
    if (!order.restaurant.equals(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant does not match order'
      });
    }

    const reviewData = {
      customer: req.user.id,
      restaurant: restaurantId,
      order: orderId,
      rating: req.body.rating,
      title: req.body.title,
      comment: req.body.comment,
      images: req.body.images || [],
      pros: req.body.pros || [],
      cons: req.body.cons || [],
      tags: req.body.tags || [],
      deliveryExperience: req.body.deliveryExperience,
      orderDetails: {
        orderValue: order.pricing.total,
        itemsOrdered: order.items.map(item => item.name),
        deliveryMethod: order.orderType
      }
    };

    const review = await Review.create(reviewData);

    // Update restaurant rating
    const ratingStats = await Review.getRestaurantAverageRating(restaurantId);
    await Restaurant.findByIdAndUpdate(restaurantId, {
      'rating.average': ratingStats.averageRating,
      'rating.count': ratingStats.totalReviews
    });

    // Add feedback to order
    await order.addFeedback({
      rating: req.body.rating.overall,
      comment: req.body.comment,
      foodQuality: req.body.rating.food,
      deliverySpeed: req.body.rating.delivery,
      driverRating: req.body.deliveryExperience?.driverRating
    });

    const populatedReview = await Review.findById(review._id)
      .populate('customer', 'name avatar')
      .populate('restaurant', 'name logo');

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: populatedReview
    });

  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update review
// @route   PUT /api/reviews/:id
// @access  Private/Customer (own review only)
router.put('/:id', [
  protect,
  body('rating.overall')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Overall rating must be between 1 and 5'),
  body('comment')
    .optional()
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Comment must be between 10 and 1000 characters')
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

    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check ownership
    if (!review.customer.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this review'
      });
    }

    // Check if review can be edited (within 24 hours)
    const timeDiff = Date.now() - review.createdAt.getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (hoursDiff > 24) {
      return res.status(400).json({
        success: false,
        message: 'Reviews can only be edited within 24 hours of creation'
      });
    }

    const allowedFields = [
      'rating', 'title', 'comment', 'images', 'pros', 'cons', 
      'tags', 'deliveryExperience'
    ];

    const updateData = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    await review.editReview(updateData);

    // Update restaurant rating if overall rating changed
    if (req.body.rating?.overall) {
      const ratingStats = await Review.getRestaurantAverageRating(review.restaurant);
      await Restaurant.findByIdAndUpdate(review.restaurant, {
        'rating.average': ratingStats.averageRating,
        'rating.count': ratingStats.totalReviews
      });
    }

    const updatedReview = await Review.findById(review._id)
      .populate('customer', 'name avatar')
      .populate('restaurant', 'name logo');

    res.status(200).json({
      success: true,
      message: 'Review updated successfully',
      data: updatedReview
    });

  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete review
// @route   DELETE /api/reviews/:id
// @access  Private/Customer (own review) or Admin
router.delete('/:id', protect, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check authorization
    if (!review.customer.equals(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this review'
      });
    }

    await Review.findByIdAndDelete(req.params.id);

    // Update restaurant rating
    const ratingStats = await Review.getRestaurantAverageRating(review.restaurant);
    await Restaurant.findByIdAndUpdate(review.restaurant, {
      'rating.average': ratingStats.averageRating,
      'rating.count': ratingStats.totalReviews
    });

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Vote on review helpfulness
// @route   POST /api/reviews/:id/vote
// @access  Private
router.post('/:id/vote', [
  protect,
  body('vote')
    .isIn(['helpful', 'unhelpful'])
    .withMessage('Vote must be helpful or unhelpful')
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

    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Users cannot vote on their own reviews
    if (review.customer.equals(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot vote on your own review'
      });
    }

    await review.voteHelpful(req.user.id, req.body.vote);

    res.status(200).json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        helpfulVotes: review.helpfulVotes,
        unhelpfulVotes: review.unhelpfulVotes,
        helpfulPercentage: review.helpfulPercentage
      }
    });

  } catch (error) {
    console.error('Vote on review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add restaurant response to review
// @route   POST /api/reviews/:id/response
// @access  Private/Restaurant Owner
router.post('/:id/response', [
  protect,
  authorize('restaurant_owner', 'admin'),
  body('text')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Response must be between 10 and 500 characters')
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

    const review = await Review.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user owns the restaurant
    if (!review.restaurant.owner.equals(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this review'
      });
    }

    // Check if response already exists
    if (review.response.text) {
      return res.status(400).json({
        success: false,
        message: 'Response already exists for this review'
      });
    }

    await review.addResponse(req.body.text, req.user.id);

    const updatedReview = await Review.findById(review._id)
      .populate('customer', 'name avatar')
      .populate('response.respondedBy', 'name');

    res.status(200).json({
      success: true,
      message: 'Response added successfully',
      data: updatedReview
    });

  } catch (error) {
    console.error('Add review response error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Report review
// @route   POST /api/reviews/:id/report
// @access  Private
router.post('/:id/report', [
  protect,
  body('reason')
    .isIn(['Inappropriate Content', 'Spam', 'Fake Review', 'Offensive Language', 'Personal Information', 'Other'])
    .withMessage('Invalid report reason')
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

    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Users cannot report their own reviews
    if (review.customer.equals(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot report your own review'
      });
    }

    try {
      await review.reportReview(req.user.id, req.body.reason);

      res.status(200).json({
        success: true,
        message: 'Review reported successfully'
      });
    } catch (error) {
      if (error.message === 'You have already reported this review') {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      throw error;
    }

  } catch (error) {
    console.error('Report review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user's reviews
// @route   GET /api/reviews/user/me
// @access  Private
router.get('/user/me', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const reviews = await Review.find({ customer: req.user.id })
      .populate('restaurant', 'name logo')
      .populate('order', 'orderNumber createdAt')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Review.countDocuments({ customer: req.user.id });

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      pagination: {
        page,
        pages: Math.ceil(total / limit)
      },
      data: reviews
    });

  } catch (error) {
    console.error('Get user reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Moderate review (Admin only)
// @route   PUT /api/reviews/:id/moderate
// @access  Private/Admin
router.put('/:id/moderate', [
  protect,
  authorize('admin'),
  body('status')
    .isIn(['pending', 'approved', 'rejected', 'flagged'])
    .withMessage('Invalid status'),
  body('moderationNotes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Moderation notes cannot exceed 500 characters')
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

    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.status = req.body.status;
    review.moderationNotes = req.body.moderationNotes;
    await review.save();

    // Update restaurant rating if status changed to approved/rejected
    if (['approved', 'rejected'].includes(req.body.status)) {
      const ratingStats = await Review.getRestaurantAverageRating(review.restaurant);
      await Restaurant.findByIdAndUpdate(review.restaurant, {
        'rating.average': ratingStats.averageRating,
        'rating.count': ratingStats.totalReviews
      });
    }

    res.status(200).json({
      success: true,
      message: 'Review moderated successfully',
      data: review
    });

  } catch (error) {
    console.error('Moderate review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

