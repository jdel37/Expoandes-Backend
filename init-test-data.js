// backend/init-test-data.js
// Script para crear datos de prueba en la base de datos

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

// Import models
const User = require('./models/User');
const Restaurant = require('./models/Restaurant');

const initTestData = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurante_manager');
    console.log('✅ Conectado a MongoDB');

    // Clear existing data
    await User.deleteMany({});
    await Restaurant.deleteMany({});
    console.log('🧹 Datos anteriores eliminados');

    // Create test restaurant
    const restaurant = new Restaurant({
      name: 'Restaurante Demo',
      address: {
        street: 'Calle Principal 123',
        city: 'Bogotá',
        state: 'Cundinamarca',
        zipCode: '110111',
        country: 'Colombia'
      },
      contact: {
        phone: '+57 300 123 4567',
        email: 'demo@restaurante.com'
      },
      settings: {
        currency: 'COP',
        timezone: 'America/Bogota',
        businessHours: {
          monday: { open: '08:00', close: '22:00', isOpen: true },
          tuesday: { open: '08:00', close: '22:00', isOpen: true },
          wednesday: { open: '08:00', close: '22:00', isOpen: true },
          thursday: { open: '08:00', close: '22:00', isOpen: true },
          friday: { open: '08:00', close: '23:00', isOpen: true },
          saturday: { open: '09:00', close: '23:00', isOpen: true },
          sunday: { open: '10:00', close: '21:00', isOpen: true }
        }
      }
    });

    await restaurant.save();
    console.log('🏪 Restaurante creado:', restaurant.name);

    // Create test user (password will be hashed by pre-save hook)
    const user = new User({
      name: 'Usuario Demo',
      email: 'demo@test.com',
      password: '123456', // Will be hashed automatically
      role: 'admin',
      restaurant: restaurant._id
    });

    await user.save();
    console.log('👤 Usuario creado:', user.email);

    // Create additional test users
    const users = [
      {
        name: 'Admin Principal',
        email: 'admin@restaurante.com',
        password: 'admin123',
        role: 'admin'
      },
      {
        name: 'Mesero Juan',
        email: 'mesero@restaurante.com',
        password: 'mesero123',
        role: 'employee'
      },
      {
        name: 'Cajero María',
        email: 'cajero@restaurante.com',
        password: 'cajero123',
        role: 'manager'
      }
    ];

    for (const userData of users) {
      // Password will be hashed by pre-save hook
      const newUser = new User({
        name: userData.name,
        email: userData.email,
        password: userData.password, // Will be hashed automatically
        role: userData.role,
        restaurant: restaurant._id
      });
      await newUser.save();
      console.log(`👤 Usuario creado: ${userData.email} (${userData.password})`);
    }

    console.log('\n🎉 ¡Datos de prueba creados exitosamente!');
    console.log('\n📋 CREDENCIALES DE PRUEBA:');
    console.log('================================');
    console.log('👑 ADMINISTRADOR:');
    console.log('   Email: demo@test.com');
    console.log('   Password: 123456');
    console.log('');
    console.log('👑 ADMINISTRADOR PRINCIPAL:');
    console.log('   Email: admin@restaurante.com');
    console.log('   Password: admin123');
    console.log('');
    console.log('🍽️ MESERO:');
    console.log('   Email: mesero@restaurante.com');
    console.log('   Password: mesero123');
    console.log('');
    console.log('💰 CAJERO:');
    console.log('   Email: cajero@restaurante.com');
    console.log('   Password: cajero123');
    console.log('================================');

  } catch (error) {
    console.error('❌ Error creando datos de prueba:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB');
    process.exit(0);
  }
};

// Run the script
initTestData();
