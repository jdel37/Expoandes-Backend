const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config({ path: './config.env' });

// Import routes
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const ordersRoutes = require('./routes/orders');
const cashCloseRoutes = require('./routes/cashClose');
const analyticsRoutes = require('./routes/analytics');
const userRoutes = require('./routes/users');
const dayRoutes = require('./routes/day');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:8081", 
      "http://localhost:8082",
      "http://192.168.20.26:3000",
      "http://192.168.20.26:8081",
      "http://192.168.20.26:8082",
      "exp://192.168.20.26:8081"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  }
});

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Demasiadas solicitudes desde esta IP, intenta de nuevo más tarde.'
});
app.use('/api/', limiter);

// CORS configuration
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:8081", 
    "http://localhost:8082",
    "http://192.168.20.26:3000",
    "http://192.168.20.26:8081",
    "http://192.168.20.26:8082",
    "exp://192.168.20.26:8081"
  ],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurante_manager')
.then(async () => {
  console.log('✅ Conectado a MongoDB');
  
  // Inicializar base de datos si es necesario
  try {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    if (collections.length === 0) {
      console.log('🔧 Inicializando base de datos...');
      // Crear índices básicos
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('restaurants').createIndex({ name: 1 });
      await db.collection('inventoryitems').createIndex({ restaurant: 1 });
      await db.collection('orders').createIndex({ restaurant: 1 });
      await db.collection('cashcloses').createIndex({ restaurant: 1 });
      console.log('✅ Base de datos inicializada');
    }
  } catch (error) {
    console.log('⚠️ Error inicializando base de datos:', error.message);
  }
})
.catch((err) => {
  console.error('❌ Error conectando a MongoDB:', err);
  console.log('💡 Asegúrate de que MongoDB esté corriendo:');
  console.log('   ./start-mongodb.sh');
  process.exit(1);
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 Usuario conectado:', socket.id);
  
  // Join user to their restaurant room
  socket.on('join-restaurant', (restaurantId) => {
    socket.join(`restaurant-${restaurantId}`);
    console.log(`Usuario ${socket.id} se unió al restaurante ${restaurantId}`);
  });

  // Handle order updates
  socket.on('order-update', (data) => {
    socket.to(`restaurant-${data.restaurantId}`).emit('order-updated', data);
  });

  // Handle inventory updates
  socket.on('inventory-update', (data) => {
    socket.to(`restaurant-${data.restaurantId}`).emit('inventory-updated', data);
  });

  // Handle cash close updates
  socket.on('cash-close-update', (data) => {
    socket.to(`restaurant-${data.restaurantId}`).emit('cash-close-updated', data);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Usuario desconectado:', socket.id);
  });
});

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/inventory', auth, inventoryRoutes);
app.use('/api/orders', auth, ordersRoutes);
app.use('/api/cash-close', auth, cashCloseRoutes);
app.use('/api/analytics', auth, analyticsRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/day', auth, dayRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Ruta ${req.originalUrl} no encontrada`
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Socket.io habilitado para tiempo real`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado');
    mongoose.connection.close();
    process.exit(0);
  });
});

module.exports = { app, io };
// Restarting server
