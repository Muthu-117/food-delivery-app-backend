const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
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
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  rating: {
    overall: {
      type: Number,
      required: [true, 'Please provide an overall rating'],
      min: 1,
      max: 5
    },
    food: {
      type: Number,
      min: 1,
      max: 5
    },
    service: {
      type: Number,
      min: 1,
      max: 5
    },
    delivery: {
      type: Number,
      min: 1,
      max: 5
    },
    value: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  title: {
    type: String,
    maxlength: [100, 'Review title cannot be more than 100 characters']
  },
  comment: {
    type: String,
    required: [true, 'Please provide a review comment'],
    maxlength: [1000, 'Review comment cannot be more than 1000 characters']
  },
  images: [{
    url: String,
    caption: String
  }],
  pros: [String], // What the customer liked
  cons: [String], // What could be improved
  recommendedItems: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Menu.items'
  }],
  tags: [{
    type: String,
    enum: [
      'Great Food', 'Fast Delivery', 'Good Value', 'Excellent Service',
      'Fresh Ingredients', 'Large Portions', 'Authentic Taste', 'Clean Packaging',
      'Hot Food', 'On Time', 'Friendly Driver', 'Easy Ordering',
      'Cold Food', 'Late Delivery', 'Poor Packaging', 'Wrong Order',
      'Small Portions', 'Overpriced', 'Poor Quality', 'Rude Service'
    ]
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: true
  },
  helpfulVotes: {
    type: Number,
    default: 0
  },
  unhelpfulVotes: {
    type: Number,
    default: 0
  },
  votedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    vote: {
      type: String,
      enum: ['helpful', 'unhelpful']
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged'],
    default: 'pending'
  },
  moderationNotes: String,
  response: {
    text: String,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    respondedAt: Date
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    editedAt: Date,
    previousComment: String,
    previousRating: Number
  }],
  reportedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      enum: [
        'Inappropriate Content', 'Spam', 'Fake Review', 
        'Offensive Language', 'Personal Information', 'Other'
      ]
    },
    reportedAt: {
      type: Date,
      default: Date.now
    }
  }],
  deliveryExperience: {
    driverRating: {
      type: Number,
      min: 1,
      max: 5
    },
    driverComment: String,
    deliveryTime: String, // 'on-time', 'early', 'late'
    packagingQuality: {
      type: Number,
      min: 1,
      max: 5
    }
  },
  orderDetails: {
    orderValue: Number,
    itemsOrdered: [String],
    deliveryMethod: {
      type: String,
      enum: ['delivery', 'pickup']
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for helpful percentage
reviewSchema.virtual('helpfulPercentage').get(function() {
  const totalVotes = this.helpfulVotes + this.unhelpfulVotes;
  if (totalVotes === 0) return 0;
  return Math.round((this.helpfulVotes / totalVotes) * 100);
});

// Virtual for review age
reviewSchema.virtual('reviewAge').get(function() {
  const now = new Date();
  const reviewDate = this.createdAt;
  const diffTime = Math.abs(now - reviewDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
});

// Virtual for average rating calculation
reviewSchema.virtual('averageRating').get(function() {
  const ratings = [
    this.rating.food,
    this.rating.service,
    this.rating.delivery,
    this.rating.value
  ].filter(rating => rating !== undefined);
  
  if (ratings.length === 0) return this.rating.overall;
  
  const sum = ratings.reduce((acc, rating) => acc + rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
});

// Method to vote on review helpfulness
reviewSchema.methods.voteHelpful = function(userId, voteType) {
  // Remove existing vote from this user
  this.votedBy = this.votedBy.filter(vote => !vote.user.equals(userId));
  
  // Add new vote
  this.votedBy.push({ user: userId, vote: voteType });
  
  // Recalculate vote counts
  this.helpfulVotes = this.votedBy.filter(vote => vote.vote === 'helpful').length;
  this.unhelpfulVotes = this.votedBy.filter(vote => vote.vote === 'unhelpful').length;
  
  return this.save();
};

// Method to add restaurant response
reviewSchema.methods.addResponse = function(responseText, responderId) {
  this.response = {
    text: responseText,
    respondedBy: responderId,
    respondedAt: new Date()
  };
  return this.save();
};

// Method to report review
reviewSchema.methods.reportReview = function(userId, reason) {
  // Check if user already reported this review
  const existingReport = this.reportedBy.find(report => report.user.equals(userId));
  if (existingReport) {
    throw new Error('You have already reported this review');
  }
  
  this.reportedBy.push({
    user: userId,
    reason: reason
  });
  
  // Auto-flag if multiple reports
  if (this.reportedBy.length >= 3) {
    this.status = 'flagged';
  }
  
  return this.save();
};

// Method to edit review
reviewSchema.methods.editReview = function(newData) {
  // Save edit history
  this.editHistory.push({
    editedAt: new Date(),
    previousComment: this.comment,
    previousRating: this.rating.overall
  });
  
  // Update review
  Object.assign(this, newData);
  this.isEdited = true;
  
  return this.save();
};

// Static method to get restaurant average rating
reviewSchema.statics.getRestaurantAverageRating = async function(restaurantId) {
  const result = await this.aggregate([
    { $match: { restaurant: restaurantId, status: 'approved' } },
    {
      $group: {
        _id: '$restaurant',
        averageRating: { $avg: '$rating.overall' },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: '$rating.overall'
        }
      }
    }
  ]);
  
  if (result.length === 0) {
    return { averageRating: 0, totalReviews: 0, ratingDistribution: [] };
  }
  
  const data = result[0];
  
  // Calculate rating distribution
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  data.ratingDistribution.forEach(rating => {
    distribution[Math.floor(rating)]++;
  });
  
  return {
    averageRating: Math.round(data.averageRating * 10) / 10,
    totalReviews: data.totalReviews,
    ratingDistribution: distribution
  };
};

// Ensure one review per order per customer
reviewSchema.index({ customer: 1, order: 1 }, { unique: true });

// Index for efficient queries
reviewSchema.index({ restaurant: 1, status: 1, createdAt: -1 });
reviewSchema.index({ customer: 1, createdAt: -1 });
reviewSchema.index({ 'rating.overall': -1 });
reviewSchema.index({ helpfulVotes: -1 });

module.exports = mongoose.model('Review', reviewSchema);

