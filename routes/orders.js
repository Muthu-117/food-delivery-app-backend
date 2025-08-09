const express = require('express');
const { body, validationResult } = require('express-validator');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const Menu = require('../models/Menu');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Create new order
// @route   POST /api/orders
// @access  Private/Customer
router.post('/', [
  protect,
  body('restaurant')
    .isMongoId()
    .withMessage('Valid restaurant ID is required'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  body('items.*.menuItem')
    .isMongoId()
    .withMessage('Valid menu item ID is required'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('orderType')
    .isIn(['delivery', 'pickup'])
    .withMessage('Order type must be delivery or pickup'),
  body('payment.method')
    .isIn(['card', 'cash', 'paypal', 'wallet'])
    .withMessage('Invalid payment method')
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

    const { restaurant: restaurantId, items, orderType, deliveryAddress, scheduledDeliveryTime, payment } = req.body;

    // Verify restaurant exists and is active
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant || !restaurant.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found or inactive'
      });
    }

    // Get restaurant menu
    const menu = await Menu.findOne({ restaurant: restaurantId, isActive: true });
    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant menu not available'
      });
    }

    // Validate and calculate order items
    const orderItems = [];
    let subtotal = 0;

    for (const orderItem of items) {
      const menuItem = menu.items.id(orderItem.menuItem);
      
      if (!menuItem || !menuItem.isAvailable) {
        return res.status(400).json({
          success: false,
          message: `Item ${orderItem.menuItem} is not available`
        });
      }

      let itemPrice = menuItem.price;
      let customizationTotal = 0;

      // Calculate customizations
      if (orderItem.customizations) {
        for (const customization of orderItem.customizations) {
          const menuCustomization = menuItem.customizations.find(c => c.name === customization.name);
          if (menuCustomization) {
            customization.options.forEach(option => {
              const menuOption = menuCustomization.options.find(o => o.name === option.name);
              if (menuOption) {
                customizationTotal += menuOption.price;
              }
            });
          }
        }
      }

      // Calculate size price
      if (orderItem.size && menuItem.sizes.length > 0) {
        const size = menuItem.sizes.find(s => s.name === orderItem.size.name);
        if (size) {
          itemPrice = size.price;
        }
      }

      const itemSubtotal = (itemPrice + customizationTotal) * orderItem.quantity;
      subtotal += itemSubtotal;

      orderItems.push({
        menuItem: menuItem._id,
        name: menuItem.name,
        description: menuItem.description,
        image: menuItem.image,
        price: itemPrice,
        quantity: orderItem.quantity,
        size: orderItem.size,
        customizations: orderItem.customizations || [],
        specialInstructions: orderItem.specialInstructions,
        subtotal: itemSubtotal
      });
    }

    // Calculate pricing
    const tax = subtotal * 0.08; // 8% tax
    const deliveryFee = orderType === 'delivery' ? restaurant.deliveryInfo.deliveryFee : 0;
    const serviceFee = subtotal * 0.02; // 2% service fee
    const total = subtotal + tax + deliveryFee + serviceFee;

    // Create order
    const orderData = {
      customer: req.user.id,
      restaurant: restaurantId,
      items: orderItems,
      orderType,
      deliveryAddress: orderType === 'delivery' ? deliveryAddress : undefined,
      scheduledDeliveryTime,
      estimatedDeliveryTime: scheduledDeliveryTime || new Date(Date.now() + restaurant.deliveryInfo.estimatedDeliveryTime * 60000),
      pricing: {
        subtotal,
        tax,
        deliveryFee,
        serviceFee,
        discount: 0,
        tip: req.body.tip || 0,
        total: total + (req.body.tip || 0)
      },
      payment: {
        method: payment.method,
        status: 'pending'
      },
      customerNotes: req.body.customerNotes,
      contactInfo: {
        customerPhone: req.user.phone
      }
    };

    const order = await Order.create(orderData);

    // Update restaurant total orders
    restaurant.totalOrders += 1;
    restaurant.totalRevenue += order.pricing.total;
    await restaurant.save();

    // Add order to user's order history
    const user = await User.findById(req.user.id);
    user.orderHistory.push(order._id);
    await user.save();

    // Populate order for response
    const populatedOrder = await Order.findById(order._id)
      .populate('restaurant', 'name phone address')
      .populate('customer', 'name phone email');

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: populatedOrder
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user's orders
// @route   GET /api/orders
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let query = {};

    // Filter based on user role
    if (req.user.role === 'customer') {
      query.customer = req.user.id;
    } else if (req.user.role === 'restaurant_owner') {
      // Get restaurant owned by user
      const restaurant = await Restaurant.findOne({ owner: req.user.id });
      if (restaurant) {
        query.restaurant = restaurant._id;
      } else {
        return res.status(404).json({
          success: false,
          message: 'No restaurant found for this user'
        });
      }
    } else if (req.user.role === 'delivery_driver') {
      query.deliveryDriver = req.user.id;
    }

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
      .populate('restaurant', 'name logo phone address')
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
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'name logo phone address owner')
      .populate('customer', 'name phone email')
      .populate('deliveryDriver', 'name phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check authorization
    const isAuthorized = 
      order.customer._id.equals(req.user.id) ||
      (order.deliveryDriver && order.deliveryDriver._id.equals(req.user.id)) ||
      order.restaurant.owner.equals(req.user.id) ||
      req.user.role === 'admin';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order'
      });
    }

    res.status(200).json({
      success: true,
      data: order
    });

  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Restaurant Owner/Driver
router.put('/:id/status', [
  protect,
  body('status')
    .isIn(['pending', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled'])
    .withMessage('Invalid status')
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

    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const { status } = req.body;

    // Check authorization based on status change
    let isAuthorized = false;

    if (['confirmed', 'preparing', 'ready_for_pickup'].includes(status)) {
      // Restaurant owner can update these statuses
      isAuthorized = order.restaurant.owner.equals(req.user.id) || req.user.role === 'admin';
    } else if (['out_for_delivery', 'delivered'].includes(status)) {
      // Delivery driver can update these statuses
      isAuthorized = (order.deliveryDriver && order.deliveryDriver.equals(req.user.id)) || req.user.role === 'admin';
    } else if (status === 'cancelled') {
      // Customer, restaurant owner, or admin can cancel
      isAuthorized = 
        order.customer.equals(req.user.id) ||
        order.restaurant.owner.equals(req.user.id) ||
        req.user.role === 'admin';
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this order status'
      });
    }

    // Validate status transition
    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['ready_for_pickup', 'cancelled'],
      ready_for_pickup: ['out_for_delivery', 'delivered', 'cancelled'],
      out_for_delivery: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: []
    };

    if (!validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot change status from ${order.status} to ${status}`
      });
    }

    // Update order status with additional data
    const additionalData = {
      estimatedTime: req.body.estimatedTime,
      estimatedArrival: req.body.estimatedArrival,
      deliveredBy: req.body.deliveredBy,
      signature: req.body.signature,
      photo: req.body.photo,
      reason: req.body.reason,
      cancelledBy: req.user.role
    };

    await order.updateStatus(status, additionalData);

    res.status(200).json({
      success: true,
      message: `Order status updated to ${status}`,
      data: order
    });

  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private/Customer/Restaurant Owner
router.put('/:id/cancel', [
  protect,
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Cancellation reason cannot exceed 500 characters')
], async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check authorization
    const isAuthorized = 
      order.customer.equals(req.user.id) ||
      order.restaurant.owner.equals(req.user.id) ||
      req.user.role === 'admin';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this order'
      });
    }

    // Check if order can be cancelled
    if (!order.canBeCancelled) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled at this stage'
      });
    }

    await order.updateStatus('cancelled', {
      reason: req.body.reason || 'No reason provided',
      cancelledBy: req.user.role
    });

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      data: order
    });

  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Assign delivery driver
// @route   PUT /api/orders/:id/assign-driver
// @access  Private/Admin/Restaurant Owner
router.put('/:id/assign-driver', [
  protect,
  authorize('admin', 'restaurant_owner'),
  body('driverId')
    .isMongoId()
    .withMessage('Valid driver ID is required')
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

    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check authorization for restaurant owner
    if (req.user.role === 'restaurant_owner' && !order.restaurant.owner.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to assign driver for this order'
      });
    }

    // Verify driver exists and is active
    const driver = await User.findById(req.body.driverId);
    if (!driver || driver.role !== 'delivery_driver' || !driver.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or inactive delivery driver'
      });
    }

    order.deliveryDriver = req.body.driverId;
    order.contactInfo.driverPhone = driver.phone;
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Delivery driver assigned successfully',
      data: order
    });

  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get order tracking
// @route   GET /api/orders/:id/tracking
// @access  Private
router.get('/:id/tracking', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('restaurant', 'name phone address owner')
      .populate('deliveryDriver', 'name phone')
      .select('tracking status estimatedDeliveryTime orderNumber');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check authorization
    const isAuthorized = 
      order.customer.equals(req.user.id) ||
      (order.deliveryDriver && order.deliveryDriver._id.equals(req.user.id)) ||
      order.restaurant.owner.equals(req.user.id) ||
      req.user.role === 'admin';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this order tracking'
      });
    }

    const trackingData = {
      orderNumber: order.orderNumber,
      status: order.status,
      statusMessage: order.statusMessage,
      estimatedDeliveryTime: order.estimatedDeliveryTime,
      estimatedTimeRemaining: order.estimatedTimeRemaining,
      tracking: order.tracking,
      restaurant: order.restaurant,
      deliveryDriver: order.deliveryDriver
    };

    res.status(200).json({
      success: true,
      data: trackingData
    });

  } catch (error) {
    console.error('Get order tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Repeat order
// @route   POST /api/orders/:id/repeat
// @access  Private/Customer
router.post('/:id/repeat', protect, async (req, res) => {
  try {
    const originalOrder = await Order.findById(req.params.id);

    if (!originalOrder) {
      return res.status(404).json({
        success: false,
        message: 'Original order not found'
      });
    }

    // Check if user owns the original order
    if (!originalOrder.customer.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to repeat this order'
      });
    }

    // Verify restaurant is still active
    const restaurant = await Restaurant.findById(originalOrder.restaurant);
    if (!restaurant || !restaurant.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant is no longer available'
      });
    }

    // Create new order based on original
    const newOrderData = {
      customer: req.user.id,
      restaurant: originalOrder.restaurant,
      items: originalOrder.items,
      orderType: originalOrder.orderType,
      deliveryAddress: req.body.deliveryAddress || originalOrder.deliveryAddress,
      pricing: originalOrder.pricing,
      payment: {
        method: req.body.paymentMethod || originalOrder.payment.method,
        status: 'pending'
      },
      customerNotes: req.body.customerNotes,
      repeatOrder: true,
      originalOrder: originalOrder._id
    };

    const newOrder = await Order.create(newOrderData);

    res.status(201).json({
      success: true,
      message: 'Order repeated successfully',
      data: newOrder
    });

  } catch (error) {
    console.error('Repeat order error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

