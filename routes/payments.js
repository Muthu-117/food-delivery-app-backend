const express = require('express');
const { body, validationResult } = require('express-validator');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @desc    Create payment intent
// @route   POST /api/payments/create-intent
// @access  Private
router.post('/create-intent', [
  protect,
  body('orderId')
    .isMongoId()
    .withMessage('Valid order ID is required'),
  body('paymentMethodId')
    .optional()
    .isString()
    .withMessage('Payment method ID must be a string')
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

    const { orderId, paymentMethodId } = req.body;

    // Get order
    const order = await Order.findById(orderId)
      .populate('customer', 'email name')
      .populate('restaurant', 'name');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user owns the order
    if (!order.customer._id.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to pay for this order'
      });
    }

    // Check if order is in correct status
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be paid at this stage'
      });
    }

    // Check if payment is already completed
    if (order.payment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Order has already been paid'
      });
    }

    const amount = Math.round(order.pricing.total * 100); // Convert to cents

    const paymentIntentData = {
      amount,
      currency: 'usd',
      customer: order.customer.stripeCustomerId,
      metadata: {
        orderId: order._id.toString(),
        restaurantName: order.restaurant.name,
        customerEmail: order.customer.email
      },
      description: `Order ${order.orderNumber} from ${order.restaurant.name}`,
      receipt_email: order.customer.email
    };

    // If payment method is provided, attach it
    if (paymentMethodId) {
      paymentIntentData.payment_method = paymentMethodId;
      paymentIntentData.confirmation_method = 'manual';
      paymentIntentData.confirm = true;
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentData);

    // Update order with payment intent ID
    order.payment.stripePaymentIntentId = paymentIntent.id;
    order.payment.status = 'processing';
    await order.save();

    res.status(200).json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        status: paymentIntent.status
      }
    });

  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment processing error',
      error: error.message
    });
  }
});

// @desc    Confirm payment
// @route   POST /api/payments/confirm
// @access  Private
router.post('/confirm', [
  protect,
  body('paymentIntentId')
    .notEmpty()
    .withMessage('Payment intent ID is required')
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

    const { paymentIntentId } = req.body;

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        message: 'Payment intent not found'
      });
    }

    // Find order by payment intent ID
    const order = await Order.findOne({ 
      'payment.stripePaymentIntentId': paymentIntentId 
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found for this payment'
      });
    }

    // Check if user owns the order
    if (!order.customer.equals(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to confirm this payment'
      });
    }

    // Update order based on payment status
    if (paymentIntent.status === 'succeeded') {
      order.payment.status = 'completed';
      order.payment.paidAt = new Date();
      order.payment.transactionId = paymentIntent.id;
      
      // Update order status to confirmed
      await order.updateStatus('confirmed');
    } else if (paymentIntent.status === 'requires_action') {
      order.payment.status = 'processing';
    } else if (paymentIntent.status === 'payment_failed') {
      order.payment.status = 'failed';
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Payment status updated',
      data: {
        paymentStatus: order.payment.status,
        orderStatus: order.status,
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount
        }
      }
    });

  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment confirmation error',
      error: error.message
    });
  }
});

// @desc    Create customer in Stripe
// @route   POST /api/payments/create-customer
// @access  Private
router.post('/create-customer', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // Check if user already has a Stripe customer ID
    if (user.stripeCustomerId) {
      return res.status(400).json({
        success: false,
        message: 'Stripe customer already exists'
      });
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      phone: user.phone,
      metadata: {
        userId: user._id.toString()
      }
    });

    // Save Stripe customer ID to user
    user.stripeCustomerId = customer.id;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Stripe customer created successfully',
      data: {
        customerId: customer.id
      }
    });

  } catch (error) {
    console.error('Create Stripe customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating Stripe customer',
      error: error.message
    });
  }
});

// @desc    Add payment method
// @route   POST /api/payments/payment-methods
// @access  Private
router.post('/payment-methods', [
  protect,
  body('paymentMethodId')
    .notEmpty()
    .withMessage('Payment method ID is required')
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

    const { paymentMethodId } = req.body;
    const user = await User.findById(req.user.id);

    // Create Stripe customer if doesn't exist
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        phone: user.phone,
        metadata: {
          userId: user._id.toString()
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    // Get payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Add to user's payment methods
    const newPaymentMethod = {
      type: 'card',
      cardHolderName: paymentMethod.billing_details.name,
      isDefault: user.paymentMethods.length === 0,
      stripePaymentMethodId: paymentMethodId
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
      data: {
        paymentMethod: {
          id: paymentMethodId,
          type: paymentMethod.type,
          card: paymentMethod.card ? {
            brand: paymentMethod.card.brand,
            last4: paymentMethod.card.last4,
            expMonth: paymentMethod.card.exp_month,
            expYear: paymentMethod.card.exp_year
          } : null
        }
      }
    });

  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding payment method',
      error: error.message
    });
  }
});

// @desc    Get user's payment methods
// @route   GET /api/payments/payment-methods
// @access  Private
router.get('/payment-methods', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user.stripeCustomerId) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Get payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card'
    });

    const formattedPaymentMethods = paymentMethods.data.map(pm => ({
      id: pm.id,
      type: pm.type,
      card: pm.card ? {
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year
      } : null,
      billingDetails: pm.billing_details
    }));

    res.status(200).json({
      success: true,
      data: formattedPaymentMethods
    });

  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving payment methods',
      error: error.message
    });
  }
});

// @desc    Delete payment method
// @route   DELETE /api/payments/payment-methods/:paymentMethodId
// @access  Private
router.delete('/payment-methods/:paymentMethodId', protect, async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    const user = await User.findById(req.user.id);

    // Detach from Stripe
    await stripe.paymentMethods.detach(paymentMethodId);

    // Remove from user's payment methods
    user.paymentMethods = user.paymentMethods.filter(
      pm => pm.stripePaymentMethodId !== paymentMethodId
    );

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Payment method removed successfully'
    });

  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing payment method',
      error: error.message
    });
  }
});

// @desc    Process refund
// @route   POST /api/payments/refund
// @access  Private/Admin/Restaurant Owner
router.post('/refund', [
  protect,
  body('orderId')
    .isMongoId()
    .withMessage('Valid order ID is required'),
  body('amount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Refund amount must be positive'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason cannot exceed 500 characters')
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

    const { orderId, amount, reason } = req.body;

    const order = await Order.findById(orderId)
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
        message: 'Not authorized to refund this order'
      });
    }

    // Check if order can be refunded
    if (order.payment.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Order payment is not completed'
      });
    }

    if (!order.payment.stripePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'No payment intent found for this order'
      });
    }

    // Calculate refund amount
    const refundAmount = amount ? Math.round(amount * 100) : Math.round(order.pricing.total * 100);

    // Create refund in Stripe
    const refund = await stripe.refunds.create({
      payment_intent: order.payment.stripePaymentIntentId,
      amount: refundAmount,
      reason: 'requested_by_customer',
      metadata: {
        orderId: order._id.toString(),
        refundReason: reason || 'Customer requested refund'
      }
    });

    // Update order
    order.payment.status = 'refunded';
    order.payment.refundedAt = new Date();
    order.payment.refundAmount = refundAmount / 100;
    
    await order.updateStatus('refunded', {
      reason: reason || 'Payment refunded',
      cancelledBy: req.user.role
    });

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refundId: refund.id,
        amount: refund.amount / 100,
        status: refund.status
      }
    });

  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing refund',
      error: error.message
    });
  }
});

// @desc    Webhook endpoint for Stripe events
// @route   POST /api/payments/webhook
// @access  Public (Stripe webhook)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        
        // Find and update order
        const order = await Order.findOne({
          'payment.stripePaymentIntentId': paymentIntent.id
        });

        if (order) {
          order.payment.status = 'completed';
          order.payment.paidAt = new Date();
          order.payment.transactionId = paymentIntent.id;
          
          if (order.status === 'pending') {
            await order.updateStatus('confirmed');
          } else {
            await order.save();
          }
        }
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        
        const failedOrder = await Order.findOne({
          'payment.stripePaymentIntentId': failedPayment.id
        });

        if (failedOrder) {
          failedOrder.payment.status = 'failed';
          await failedOrder.save();
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// @desc    Get payment history
// @route   GET /api/payments/history
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const orders = await Order.find({ 
      customer: req.user.id,
      'payment.status': { $in: ['completed', 'refunded'] }
    })
      .populate('restaurant', 'name logo')
      .select('orderNumber pricing payment createdAt restaurant')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments({ 
      customer: req.user.id,
      'payment.status': { $in: ['completed', 'refunded'] }
    });

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
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

