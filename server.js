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

// Importar rutas
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const ordersRoutes = require('./routes/orders');
const cashCloseRoutes = require('./routes/cashClose');
const analyticsRoutes = require('./routes/analytics');
const userRoutes = require('./routes/users');
const dayRoutes = require('./routes/day');
const restaurantRoutes = require('./routes/restaurant');

// Middleware
const errorHandler = require('./middleware/errorHandler');
const { auth } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1);

// 🧩 Crear servidor HTTP solo en desarrollo
let server;
if (process.env.NODE_ENV !== 'production') {
  server = createServer(app);
}

// 🛡 Seguridad y rendimiento
app.use(helmet());
app.use(compression());

// 🚫 Límite de peticiones
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Demasiadas solicitudes desde esta IP. Intenta de nuevo más tarde.'
});
app.use('/api/', limiter);

// 🌍 CORS
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://192.168.20.26:3000",
  "http://192.168.20.26:8081",
  "http://192.168.20.26:8082",
  "exp://192.168.20.26:8081"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// 📦 Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🧾 Logs solo en desarrollo
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// 🔌 Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  dbName: 'test',
  bufferTimeoutMS: 60000,
  connectTimeoutMS: 60000,
  socketTimeoutMS: 60000
})
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err.message));

// ⚡ Socket.io (solo local)
if (process.env.NODE_ENV !== 'production' && server) {
  const io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST", "PUT", "DELETE"], credentials: true }
  });

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);
    socket.on('join-restaurant', (restaurantId) => socket.join(`restaurant-${restaurantId}`));
    socket.on('disconnect', () => console.log('🔌 Usuario desconectado:', socket.id));
  });

  // Hacer accesible io desde req
  app.use((req, res, next) => {
    req.io = io;
    next();
  });
}

// 🩺 Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 🚀 Rutas
app.use('/api/auth', authRoutes);
app.use('/api/inventory', auth, inventoryRoutes);
app.use('/api/orders', auth, ordersRoutes);
app.use('/api/cash-close', auth, cashCloseRoutes);
app.use('/api/analytics', auth, analyticsRoutes);
app.use('/api/users', auth, userRoutes);
app.use('/api/day', auth, dayRoutes);
app.use('/api/restaurant', auth, restaurantRoutes);

// ❌ 404
app.use('*', (req, res) => {
  res.status(404).json({ status: 'error', message: `Ruta ${req.originalUrl} no encontrada` });
});

// ⚠️ Manejador de errores global
app.use(errorHandler);

// 🔹 Solo iniciar servidor en local
if (process.env.NODE_ENV !== 'production' && server) {
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => console.log(`🚀 Servidor local corriendo en puerto ${PORT}`));
}

// 🔹 En producción (Vercel) exportamos solo la app
module.exports = app;
