const express = require('express');
const { body, validationResult } = require('express-validator');
const Menu = require('../models/Menu');
const Restaurant = require('../models/Restaurant');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// @desc    Get restaurant menu
// @route   GET /api/menus/restaurant/:restaurantId
// @access  Public
router.get('/restaurant/:restaurantId', optionalAuth, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.restaurantId);
    
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    const menu = await Menu.findOne({ 
      restaurant: req.params.restaurantId, 
      isActive: true 
    });

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Filter available items only for public access
    const availableItems = menu.items.filter(item => item.isAvailable);
    
    const menuData = {
      ...menu.toObject(),
      items: availableItems,
      itemsByCategory: menu.itemsByCategory,
      popularItems: menu.popularItems,
      featuredItems: menu.featuredItems
    };

    res.status(200).json({
      success: true,
      data: menuData
    });

  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get menu by ID
// @route   GET /api/menus/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'name owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // If user is not the owner, only show available items
    let items = menu.items;
    if (!req.user || (req.user.id !== menu.restaurant.owner.toString() && req.user.role !== 'admin')) {
      items = menu.items.filter(item => item.isAvailable);
    }

    const menuData = {
      ...menu.toObject(),
      items
    };

    res.status(200).json({
      success: true,
      data: menuData
    });

  } catch (error) {
    console.error('Get menu by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create menu
// @route   POST /api/menus
// @access  Private/Restaurant Owner
router.post('/', [
  protect,
  authorize('restaurant_owner', 'admin'),
  body('restaurant')
    .isMongoId()
    .withMessage('Valid restaurant ID is required'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Menu name must be between 2 and 100 characters')
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

    const restaurant = await Restaurant.findById(req.body.restaurant);
    
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
        message: 'Not authorized to create menu for this restaurant'
      });
    }

    const menu = await Menu.create(req.body);

    res.status(201).json({
      success: true,
      message: 'Menu created successfully',
      data: menu
    });

  } catch (error) {
    console.error('Create menu error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update menu
// @route   PUT /api/menus/:id
// @access  Private/Restaurant Owner
router.put('/:id', protect, async (req, res) => {
  try {
    let menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Check ownership
    if (menu.restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this menu'
      });
    }

    const allowedFields = [
      'name', 'description', 'categories', 'isActive', 
      'availableHours', 'availableDays', 'specialOffers'
    ];

    const updateData = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    menu = await Menu.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Menu updated successfully',
      data: menu
    });

  } catch (error) {
    console.error('Update menu error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add item to menu
// @route   POST /api/menus/:id/items
// @access  Private/Restaurant Owner
router.post('/:id/items', [
  protect,
  authorize('restaurant_owner', 'admin'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Item name must be between 2 and 100 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 300 })
    .withMessage('Description must be between 10 and 300 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
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

    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Check ownership
    if (menu.restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add items to this menu'
      });
    }

    const newItem = req.body;
    menu.items.push(newItem);
    await menu.save();

    const addedItem = menu.items[menu.items.length - 1];

    res.status(201).json({
      success: true,
      message: 'Item added to menu successfully',
      data: addedItem
    });

  } catch (error) {
    console.error('Add menu item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update menu item
// @route   PUT /api/menus/:id/items/:itemId
// @access  Private/Restaurant Owner
router.put('/:id/items/:itemId', protect, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Check ownership
    if (menu.restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update items in this menu'
      });
    }

    const item = menu.items.id(req.params.itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    // Update item fields
    const allowedFields = [
      'name', 'description', 'price', 'originalPrice', 'image', 'category',
      'subcategory', 'ingredients', 'allergens', 'nutritionalInfo', 'dietaryTags',
      'customizations', 'sizes', 'preparationTime', 'isAvailable', 'isPopular',
      'isFeatured', 'isSpicy', 'spiceLevel', 'tags'
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    });

    await menu.save();

    res.status(200).json({
      success: true,
      message: 'Menu item updated successfully',
      data: item
    });

  } catch (error) {
    console.error('Update menu item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete menu item
// @route   DELETE /api/menus/:id/items/:itemId
// @access  Private/Restaurant Owner
router.delete('/:id/items/:itemId', protect, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Check ownership
    if (menu.restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete items from this menu'
      });
    }

    const item = menu.items.id(req.params.itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    item.remove();
    await menu.save();

    res.status(200).json({
      success: true,
      message: 'Menu item deleted successfully'
    });

  } catch (error) {
    console.error('Delete menu item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Search menu items
// @route   GET /api/menus/search
// @access  Public
router.get('/search', async (req, res) => {
  try {
    const { q, category, dietary, priceRange, restaurantId } = req.query;

    let query = { isActive: true };
    
    if (restaurantId) {
      query.restaurant = restaurantId;
    }

    const menus = await Menu.find(query);
    
    let allItems = [];
    menus.forEach(menu => {
      menu.items.forEach(item => {
        if (item.isAvailable) {
          allItems.push({
            ...item.toObject(),
            menuId: menu._id,
            restaurantId: menu.restaurant
          });
        }
      });
    });

    // Filter by search query
    if (q) {
      const searchRegex = new RegExp(q, 'i');
      allItems = allItems.filter(item => 
        searchRegex.test(item.name) || 
        searchRegex.test(item.description) ||
        item.ingredients.some(ingredient => searchRegex.test(ingredient)) ||
        item.tags.some(tag => searchRegex.test(tag))
      );
    }

    // Filter by category
    if (category) {
      allItems = allItems.filter(item => item.category === category);
    }

    // Filter by dietary restrictions
    if (dietary) {
      const dietaryArray = dietary.split(',');
      allItems = allItems.filter(item => 
        dietaryArray.some(diet => item.dietaryTags.includes(diet))
      );
    }

    // Filter by price range
    if (priceRange) {
      const [min, max] = priceRange.split('-').map(Number);
      allItems = allItems.filter(item => 
        item.price >= min && item.price <= max
      );
    }

    // Sort by relevance (you can implement more sophisticated sorting)
    allItems.sort((a, b) => {
      if (a.isPopular && !b.isPopular) return -1;
      if (!a.isPopular && b.isPopular) return 1;
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      return b.rating.average - a.rating.average;
    });

    res.status(200).json({
      success: true,
      count: allItems.length,
      data: allItems
    });

  } catch (error) {
    console.error('Search menu items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get menu item by ID
// @route   GET /api/menus/:id/items/:itemId
// @access  Public
router.get('/:id/items/:itemId', async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'name');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    const item = menu.items.id(req.params.itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...item.toObject(),
        restaurant: menu.restaurant
      }
    });

  } catch (error) {
    console.error('Get menu item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Toggle item availability
// @route   PATCH /api/menus/:id/items/:itemId/availability
// @access  Private/Restaurant Owner
router.patch('/:id/items/:itemId/availability', protect, async (req, res) => {
  try {
    const menu = await Menu.findById(req.params.id)
      .populate('restaurant', 'owner');

    if (!menu) {
      return res.status(404).json({
        success: false,
        message: 'Menu not found'
      });
    }

    // Check ownership
    if (menu.restaurant.owner.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to modify this menu'
      });
    }

    const item = menu.items.id(req.params.itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    item.isAvailable = !item.isAvailable;
    await menu.save();

    res.status(200).json({
      success: true,
      message: `Item ${item.isAvailable ? 'enabled' : 'disabled'} successfully`,
      data: { isAvailable: item.isAvailable }
    });

  } catch (error) {
    console.error('Toggle item availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;

