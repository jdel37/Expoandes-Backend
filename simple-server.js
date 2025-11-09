const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware básico
app.use(express.json());
app.use(cors());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'success',
    message: 'API funcionando correctamente',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Ruta de prueba
app.get('/api/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Backend funcionando correctamente',
    data: {
      mongodb: 'conectado',
      timestamp: new Date().toISOString()
    }
  });
});

// Conectar a MongoDB
mongoose.connect('mongodb://localhost:27017/restaurante_manager')
  .then(() => {
    console.log('✅ Conectado a MongoDB');
    
    // Iniciar servidor
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🧪 Test: http://localhost:${PORT}/api/test`);
    });
  })
  .catch((err) => {
    console.error('❌ Error conectando a MongoDB:', err);
    process.exit(1);
  });
