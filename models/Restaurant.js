const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide restaurant name'],
    trim: true,
    maxlength: [100, 'Restaurant name cannot be more than 100 characters']
  },
  slug: {
    type: String,
    unique: true
  },
  description: {
    type: String,
    required: [true, 'Please provide restaurant description'],
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  email: {
    type: String,
    required: [true, 'Please provide restaurant email'],
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please provide restaurant phone number'],
    match: [/^\+?[\d\s-()]+$/, 'Please provide a valid phone number']
  },
  address: {
    street: {
      type: String,
      required: [true, 'Please provide street address']
    },
    city: {
      type: String,
      required: [true, 'Please provide city']
    },
    state: {
      type: String,
      required: [true, 'Please provide state']
    },
    zipCode: {
      type: String,
      required: [true, 'Please provide zip code']
    },
    coordinates: {
      latitude: {
        type: Number,
        required: true
      },
      longitude: {
        type: Number,
        required: true
      }
    }
  },
  cuisineTypes: [{
    type: String,
    required: true,
    enum: [
      'Italian', 'Chinese', 'Indian', 'Mexican', 'American', 'Thai', 
      'Japanese', 'Mediterranean', 'French', 'Korean', 'Vietnamese', 
      'Greek', 'Spanish', 'Lebanese', 'Turkish', 'Brazilian', 'Other'
    ]
  }],
  priceRange: {
    type: String,
    enum: ['$', '$$', '$$$', '$$$$'],
    required: true
  },
  images: [{
    url: String,
    caption: String,
    isMain: {
      type: Boolean,
      default: false
    }
  }],
  logo: {
    type: String,
    default: 'default-restaurant-logo.png'
  },
  coverImage: {
    type: String,
    default: 'default-restaurant-cover.jpg'
  },
  operatingHours: {
    monday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    tuesday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    wednesday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    thursday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    friday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    saturday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    },
    sunday: {
      isOpen: { type: Boolean, default: true },
      openTime: String,
      closeTime: String
    }
  },
  deliveryInfo: {
    deliveryFee: {
      type: Number,
      required: true,
      min: 0
    },
    minimumOrder: {
      type: Number,
      required: true,
      min: 0
    },
    estimatedDeliveryTime: {
      type: Number, // in minutes
      required: true,
      min: 10
    },
    deliveryRadius: {
      type: Number, // in kilometers
      required: true,
      min: 1
    },
    freeDeliveryThreshold: {
      type: Number,
      default: 0
    }
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  },
  features: [{
    type: String,
    enum: [
      'Vegetarian Options', 'Vegan Options', 'Gluten-Free Options',
      'Halal', 'Kosher', 'Organic', 'Local Sourced',
      'Outdoor Seating', 'Takeout', 'Delivery', 'Catering',
      'Credit Cards Accepted', 'Cash Only', 'Alcohol Served'
    ]
  }],
  socialMedia: {
    facebook: String,
    instagram: String,
    twitter: String,
    website: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  totalRevenue: {
    type: Number,
    default: 0
  },
  tags: [String],
  specialOffers: [{
    title: String,
    description: String,
    discountPercentage: Number,
    validFrom: Date,
    validUntil: Date,
    isActive: {
      type: Boolean,
      default: true
    }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Create restaurant slug from name
restaurantSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Virtual for checking if restaurant is currently open
restaurantSchema.virtual('isCurrentlyOpen').get(function() {
  const now = new Date();
  const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  
  const todayHours = this.operatingHours[currentDay];
  
  if (!todayHours.isOpen) {
    return false;
  }
  
  return currentTime >= todayHours.openTime && currentTime <= todayHours.closeTime;
});

// Virtual for full address
restaurantSchema.virtual('fullAddress').get(function() {
  return `${this.address.street}, ${this.address.city}, ${this.address.state} ${this.address.zipCode}`;
});

// Virtual for main image
restaurantSchema.virtual('mainImage').get(function() {
  const mainImg = this.images.find(img => img.isMain);
  return mainImg ? mainImg.url : this.coverImage;
});

// Index for geospatial queries
restaurantSchema.index({ 'address.coordinates': '2dsphere' });

// Index for text search
restaurantSchema.index({
  name: 'text',
  description: 'text',
  cuisineTypes: 'text',
  tags: 'text'
});

module.exports = mongoose.model('Restaurant', restaurantSchema);

