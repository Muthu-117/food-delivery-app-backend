const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide item name'],
    trim: true,
    maxlength: [100, 'Item name cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide item description'],
    maxlength: [300, 'Description cannot be more than 300 characters']
  },
  price: {
    type: Number,
    required: [true, 'Please provide item price'],
    min: [0, 'Price cannot be negative']
  },
  originalPrice: {
    type: Number, // For showing discounts
    min: [0, 'Original price cannot be negative']
  },
  image: {
    type: String,
    default: 'default-food-item.jpg'
  },
  category: {
    type: String,
    required: [true, 'Please provide item category'],
    enum: [
      'Appetizers', 'Soups', 'Salads', 'Main Course', 'Pasta', 'Pizza',
      'Burgers', 'Sandwiches', 'Seafood', 'Vegetarian', 'Vegan',
      'Desserts', 'Beverages', 'Alcoholic Drinks', 'Coffee & Tea', 'Other'
    ]
  },
  subcategory: String,
  ingredients: [String],
  allergens: [{
    type: String,
    enum: [
      'Gluten', 'Dairy', 'Eggs', 'Fish', 'Shellfish', 'Tree Nuts',
      'Peanuts', 'Soy', 'Sesame', 'Sulfites'
    ]
  }],
  nutritionalInfo: {
    calories: Number,
    protein: Number, // in grams
    carbohydrates: Number, // in grams
    fat: Number, // in grams
    fiber: Number, // in grams
    sugar: Number, // in grams
    sodium: Number // in milligrams
  },
  dietaryTags: [{
    type: String,
    enum: [
      'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free',
      'Low-Carb', 'Keto', 'Paleo', 'Halal', 'Kosher', 'Organic',
      'Spicy', 'Mild', 'Medium Spicy', 'Very Spicy'
    ]
  }],
  customizations: [{
    name: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['single', 'multiple'],
      default: 'single'
    },
    required: {
      type: Boolean,
      default: false
    },
    options: [{
      name: String,
      price: {
        type: Number,
        default: 0
      }
    }]
  }],
  sizes: [{
    name: {
      type: String,
      required: true
    },
    price: {
      type: Number,
      required: true
    },
    description: String
  }],
  preparationTime: {
    type: Number, // in minutes
    default: 15
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isSpicy: {
    type: Boolean,
    default: false
  },
  spiceLevel: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
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
  orderCount: {
    type: Number,
    default: 0
  },
  tags: [String]
}, {
  timestamps: true
});

const menuSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please provide menu name'],
    trim: true,
    default: 'Main Menu'
  },
  description: {
    type: String,
    maxlength: [200, 'Description cannot be more than 200 characters']
  },
  items: [menuItemSchema],
  categories: [{
    name: String,
    description: String,
    image: String,
    sortOrder: {
      type: Number,
      default: 0
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  availableHours: {
    start: String, // HH:MM format
    end: String    // HH:MM format
  },
  availableDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  specialOffers: [{
    title: String,
    description: String,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    discountValue: Number,
    applicableItems: [mongoose.Schema.Types.ObjectId], // References to menu items
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

// Virtual for getting items by category
menuSchema.virtual('itemsByCategory').get(function() {
  const categories = {};
  this.items.forEach(item => {
    if (!categories[item.category]) {
      categories[item.category] = [];
    }
    categories[item.category].push(item);
  });
  return categories;
});

// Virtual for getting available items
menuSchema.virtual('availableItems').get(function() {
  return this.items.filter(item => item.isAvailable);
});

// Virtual for getting popular items
menuSchema.virtual('popularItems').get(function() {
  return this.items.filter(item => item.isPopular && item.isAvailable);
});

// Virtual for getting featured items
menuSchema.virtual('featuredItems').get(function() {
  return this.items.filter(item => item.isFeatured && item.isAvailable);
});

// Method to check if menu is currently available
menuSchema.methods.isCurrentlyAvailable = function() {
  const now = new Date();
  const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
  
  // Check if today is in available days
  if (this.availableDays.length > 0 && !this.availableDays.includes(currentDay)) {
    return false;
  }
  
  // Check if current time is within available hours
  if (this.availableHours.start && this.availableHours.end) {
    return currentTime >= this.availableHours.start && currentTime <= this.availableHours.end;
  }
  
  return this.isActive;
};

// Method to get item by ID
menuSchema.methods.getItemById = function(itemId) {
  return this.items.id(itemId);
};

// Method to add item to menu
menuSchema.methods.addItem = function(itemData) {
  this.items.push(itemData);
  return this.save();
};

// Method to update item
menuSchema.methods.updateItem = function(itemId, updateData) {
  const item = this.items.id(itemId);
  if (item) {
    Object.assign(item, updateData);
    return this.save();
  }
  throw new Error('Item not found');
};

// Method to remove item
menuSchema.methods.removeItem = function(itemId) {
  this.items.id(itemId).remove();
  return this.save();
};

// Index for text search on items
menuSchema.index({
  'items.name': 'text',
  'items.description': 'text',
  'items.ingredients': 'text',
  'items.tags': 'text'
});

module.exports = mongoose.model('Menu', menuSchema);

