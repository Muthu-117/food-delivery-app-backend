const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItem: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  description: String,
  image: String,
  price: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  size: {
    name: String,
    price: Number
  },
  customizations: [{
    name: String,
    options: [{
      name: String,
      price: Number
    }],
    totalPrice: Number
  }],
  specialInstructions: String,
  subtotal: {
    type: Number,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  items: [orderItemSchema],
  orderType: {
    type: String,
    enum: ['delivery', 'pickup'],
    default: 'delivery'
  },
  status: {
    type: String,
    enum: [
      'pending',           // Order placed, waiting for restaurant confirmation
      'confirmed',         // Restaurant confirmed the order
      'preparing',         // Restaurant is preparing the food
      'ready_for_pickup',  // Food is ready for pickup/delivery
      'out_for_delivery',  // Driver picked up the order
      'delivered',         // Order delivered successfully
      'cancelled',         // Order cancelled
      'refunded'          // Order refunded
    ],
    default: 'pending'
  },
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    instructions: String
  },
  pickupTime: Date, // For pickup orders
  scheduledDeliveryTime: Date, // For scheduled deliveries
  estimatedDeliveryTime: Date,
  actualDeliveryTime: Date,
  pricing: {
    subtotal: {
      type: Number,
      required: true
    },
    tax: {
      type: Number,
      required: true
    },
    deliveryFee: {
      type: Number,
      default: 0
    },
    serviceFee: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    tip: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    }
  },
  payment: {
    method: {
      type: String,
      enum: ['card', 'cash', 'paypal', 'wallet'],
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    transactionId: String,
    stripePaymentIntentId: String,
    paidAt: Date,
    refundedAt: Date,
    refundAmount: Number
  },
  deliveryDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  tracking: {
    orderPlaced: {
      timestamp: {
        type: Date,
        default: Date.now
      },
      location: String
    },
    orderConfirmed: {
      timestamp: Date,
      estimatedTime: Number // in minutes
    },
    preparationStarted: {
      timestamp: Date,
      estimatedTime: Number
    },
    readyForPickup: {
      timestamp: Date
    },
    pickedUp: {
      timestamp: Date,
      driverLocation: {
        latitude: Number,
        longitude: Number
      }
    },
    outForDelivery: {
      timestamp: Date,
      estimatedArrival: Date
    },
    delivered: {
      timestamp: Date,
      deliveredBy: String,
      signature: String,
      photo: String
    },
    cancelled: {
      timestamp: Date,
      reason: String,
      cancelledBy: {
        type: String,
        enum: ['customer', 'restaurant', 'admin', 'system']
      }
    }
  },
  customerNotes: String,
  restaurantNotes: String,
  driverNotes: String,
  contactInfo: {
    customerPhone: String,
    restaurantPhone: String,
    driverPhone: String
  },
  promotions: [{
    code: String,
    description: String,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed']
    },
    discountValue: Number,
    appliedAmount: Number
  }],
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    foodQuality: Number,
    deliverySpeed: Number,
    driverRating: Number,
    submittedAt: Date
  },
  isGift: {
    type: Boolean,
    default: false
  },
  giftMessage: String,
  repeatOrder: {
    type: Boolean,
    default: false
  },
  originalOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Generate unique order number before saving
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    this.orderNumber = `ORD${Date.now()}${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

// Virtual for order duration
orderSchema.virtual('orderDuration').get(function() {
  if (this.tracking.delivered && this.tracking.delivered.timestamp) {
    return this.tracking.delivered.timestamp - this.tracking.orderPlaced.timestamp;
  }
  return null;
});

// Virtual for current status message
orderSchema.virtual('statusMessage').get(function() {
  const messages = {
    pending: 'Your order has been placed and is waiting for restaurant confirmation.',
    confirmed: 'Your order has been confirmed by the restaurant.',
    preparing: 'The restaurant is preparing your delicious food.',
    ready_for_pickup: 'Your order is ready for pickup/delivery.',
    out_for_delivery: 'Your order is on its way to you.',
    delivered: 'Your order has been delivered successfully.',
    cancelled: 'Your order has been cancelled.',
    refunded: 'Your order has been refunded.'
  };
  return messages[this.status] || 'Unknown status';
});

// Virtual for estimated time remaining
orderSchema.virtual('estimatedTimeRemaining').get(function() {
  if (this.estimatedDeliveryTime && this.status !== 'delivered') {
    const now = new Date();
    const remaining = this.estimatedDeliveryTime - now;
    return remaining > 0 ? Math.ceil(remaining / (1000 * 60)) : 0; // in minutes
  }
  return null;
});

// Virtual for can be cancelled
orderSchema.virtual('canBeCancelled').get(function() {
  return ['pending', 'confirmed'].includes(this.status);
});

// Virtual for can be modified
orderSchema.virtual('canBeModified').get(function() {
  return this.status === 'pending';
});

// Method to update order status
orderSchema.methods.updateStatus = function(newStatus, additionalData = {}) {
  this.status = newStatus;
  
  // Update tracking information
  switch (newStatus) {
    case 'confirmed':
      this.tracking.orderConfirmed = {
        timestamp: new Date(),
        estimatedTime: additionalData.estimatedTime || 30
      };
      if (additionalData.estimatedTime) {
        this.estimatedDeliveryTime = new Date(Date.now() + additionalData.estimatedTime * 60000);
      }
      break;
    case 'preparing':
      this.tracking.preparationStarted = {
        timestamp: new Date(),
        estimatedTime: additionalData.estimatedTime || 20
      };
      break;
    case 'ready_for_pickup':
      this.tracking.readyForPickup = {
        timestamp: new Date()
      };
      break;
    case 'out_for_delivery':
      this.tracking.outForDelivery = {
        timestamp: new Date(),
        estimatedArrival: additionalData.estimatedArrival || new Date(Date.now() + 20 * 60000)
      };
      break;
    case 'delivered':
      this.tracking.delivered = {
        timestamp: new Date(),
        deliveredBy: additionalData.deliveredBy,
        signature: additionalData.signature,
        photo: additionalData.photo
      };
      this.actualDeliveryTime = new Date();
      break;
    case 'cancelled':
      this.tracking.cancelled = {
        timestamp: new Date(),
        reason: additionalData.reason,
        cancelledBy: additionalData.cancelledBy
      };
      break;
  }
  
  return this.save();
};

// Method to calculate total price
orderSchema.methods.calculateTotal = function() {
  let subtotal = 0;
  
  this.items.forEach(item => {
    subtotal += item.subtotal;
  });
  
  this.pricing.subtotal = subtotal;
  this.pricing.tax = subtotal * 0.08; // 8% tax rate
  
  let total = subtotal + this.pricing.tax + this.pricing.deliveryFee + this.pricing.serviceFee + this.pricing.tip;
  total -= this.pricing.discount;
  
  this.pricing.total = Math.max(total, 0);
  
  return this.pricing.total;
};

// Method to add feedback
orderSchema.methods.addFeedback = function(feedbackData) {
  this.feedback = {
    ...feedbackData,
    submittedAt: new Date()
  };
  return this.save();
};

// Index for efficient queries
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'deliveryDriver': 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);

