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
const restaurantRoutes = require('./routes/restaurant');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1);

// ✅ Crea el servidor HTTP solo en local
let server;
if (process.env.NODE_ENV !== 'production') {
  server = createServer(app);
} else {
  server = app; // 👈 En Vercel exportamos solo la app, no el servidor
}

// Seguridad y rendimiento
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
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

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging (solo dev)
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI, { dbName: 'test', bufferTimeoutMS: 30000 })
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

// Socket.io (solo se activa en local)
if (process.env.NODE_ENV !== 'production') {
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

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);
    socket.on('join-restaurant', (restaurantId) => {
      socket.join(`restaurant-${restaurantId}`);
    });
    socket.on('disconnect', () => console.log('🔌 Usuario desconectado:', socket.id));
  });

  app.use((req, res, next) => {
    req.io = io;
    next();
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Rutas principales
app.use('/api/auth', authRoutes);
app.use('/api/inventory', auth, inventoryRoutes);
app.use('/api/orders', auth, ordersRoutes);
app.use('/api/cash-close', auth, cashCloseRoutes);
app.use('/api/analytics', auth, analyticsRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/day', auth, dayRoutes);
app.use('/api/restaurant', auth, restaurantRoutes);

// 404
app.use('*', (req, res) => {
  res.status(404).json({ status: 'error', message: `Ruta ${req.originalUrl} no encontrada` });
});

// Error handler
app.use(errorHandler);

// 🔹 Ejecutar solo en local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor local corriendo en puerto ${PORT}`);
  });
}

// 🔹 Exporta solo la app (requerido por Vercel)
module.exports = app;
