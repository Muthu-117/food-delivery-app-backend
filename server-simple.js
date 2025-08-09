const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// CORS configuration
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check route
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'Food Delivery API is running!', 
    timestamp: new Date().toISOString(),
    environment: 'development'
  });
});

// Mock authentication routes
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, role } = req.body;
  
  // Mock successful registration
  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    user: {
      id: Date.now(),
      name,
      email,
      role: role || 'customer'
    },
    token: 'mock-jwt-token-' + Date.now()
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  // Mock successful login
  res.json({
    success: true,
    message: 'Login successful',
    user: {
      id: 1,
      name: 'John Doe',
      email,
      role: 'customer'
    },
    token: 'mock-jwt-token-' + Date.now()
  });
});

// Mock restaurants routes
app.get('/api/restaurants', (req, res) => {
  const mockRestaurants = [
    {
      id: 1,
      name: "Mario's Italian Kitchen",
      image: "/api/placeholder/400/250",
      rating: 4.8,
      reviewCount: 324,
      deliveryTime: "25-35 min",
      deliveryFee: 2.99,
      cuisine: "Italian",
      priceRange: "$$",
      distance: "1.2 km",
      featured: true,
      openNow: true,
      freeDelivery: false,
      description: "Authentic Italian cuisine with fresh pasta and wood-fired pizzas",
      tags: ["Pizza", "Pasta", "Italian", "Family-friendly"]
    },
    {
      id: 2,
      name: "Dragon Palace",
      image: "/api/placeholder/400/250",
      rating: 4.6,
      reviewCount: 189,
      deliveryTime: "30-40 min",
      deliveryFee: 1.99,
      cuisine: "Chinese",
      priceRange: "$",
      distance: "2.1 km",
      featured: true,
      openNow: true,
      freeDelivery: true,
      description: "Traditional Chinese dishes with modern presentation",
      tags: ["Chinese", "Dim Sum", "Noodles", "Vegetarian Options"]
    }
  ];
  
  res.json({
    success: true,
    data: mockRestaurants,
    count: mockRestaurants.length
  });
});

app.get('/api/restaurants/:id', (req, res) => {
  const { id } = req.params;
  
  const mockRestaurant = {
    id: parseInt(id),
    name: "Mario's Italian Kitchen",
    image: "/api/placeholder/800/400",
    rating: 4.8,
    reviewCount: 324,
    deliveryTime: "25-35 min",
    deliveryFee: 2.99,
    cuisine: "Italian",
    priceRange: "$$",
    distance: "1.2 km",
    openNow: true,
    description: "Authentic Italian cuisine with fresh pasta and wood-fired pizzas",
    address: "123 Main Street, Downtown",
    phone: "+1 (555) 123-4567",
    website: "www.mariositalian.com",
    tags: ["Pizza", "Pasta", "Italian", "Family-friendly"],
    menu: {
      appetizers: [
        {
          id: 1,
          name: "Bruschetta Classica",
          description: "Toasted bread topped with fresh tomatoes, basil, and garlic",
          price: 8.99,
          image: "/api/placeholder/150/150",
          popular: true
        }
      ],
      pasta: [
        {
          id: 3,
          name: "Spaghetti Carbonara",
          description: "Classic Roman pasta with eggs, cheese, pancetta, and black pepper",
          price: 18.99,
          image: "/api/placeholder/150/150",
          popular: true
        }
      ]
    }
  };
  
  res.json({
    success: true,
    data: mockRestaurant
  });
});

// Mock orders routes
app.post('/api/orders', (req, res) => {
  const orderData = req.body;
  
  // Mock successful order creation
  res.status(201).json({
    success: true,
    message: 'Order placed successfully',
    order: {
      id: 'ORD-' + Date.now(),
      ...orderData,
      status: 'confirmed',
      estimatedDelivery: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    }
  });
});

app.get('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  
  const mockOrder = {
    id,
    status: 'preparing',
    restaurant: "Mario's Italian Kitchen",
    items: [
      { name: "Spaghetti Carbonara", quantity: 1, price: 18.99 }
    ],
    total: 23.98,
    estimatedDelivery: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    deliveryAddress: "123 Test Street, Test City"
  };
  
  res.json({
    success: true,
    data: mockOrder
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simple Food Delivery API running on port ${PORT}`);
});

module.exports = app;

