const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del restaurante es requerido'],
    trim: true,
    maxlength: [100, 'El nombre no puede exceder 100 caracteres']
  },
  address: {
    street: {
      type: String,
      required: [true, 'La dirección es requerida'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'La ciudad es requerida'],
      trim: true
    },
    state: {
      type: String,
      required: [true, 'El estado es requerido'],
      trim: true
    },
    zipCode: {
      type: String,
      required: [true, 'El código postal es requerido'],
      trim: true
    },
    country: {
      type: String,
      required: [true, 'El país es requerido'],
      trim: true
    }
  },
  contact: {
    phone: {
      type: String,
      required: [true, 'El teléfono es requerido'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'El email es requerido'],
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email inválido']
    }
  },
  settings: {
    currency: {
      type: String,
      default: 'COP',
      enum: ['COP', 'USD', 'EUR', 'MXN']
    },
    timezone: {
      type: String,
      default: 'America/Bogota'
    },
    businessHours: {
      monday: {
        open: { type: String, default: '08:00' },
        close: { type: String, default: '22:00' },
        isOpen: { type: Boolean, default: true }
      },
      tuesday: {
        open: { type: String, default: '08:00' },
        close: { type: String, default: '22:00' },
        isOpen: { type: Boolean, default: true }
      },
      wednesday: {
        open: { type: String, default: '08:00' },
        close: { type: String, default: '22:00' },
        isOpen: { type: Boolean, default: true }
      },
      thursday: {
        open: { type: String, default: '08:00' },
        close: { type: String, default: '22:00' },
        isOpen: { type: Boolean, default: true }
      },
      friday: {
        open: { type: String, default: '08:00' },
        close: { type: String, default: '23:00' },
        isOpen: { type: Boolean, default: true }
      },
      saturday: {
        open: { type: String, default: '09:00' },
        close: { type: String, default: '23:00' },
        isOpen: { type: Boolean, default: true }
      },
      sunday: {
        open: { type: String, default: '09:00' },
        close: { type: String, default: '21:00' },
        isOpen: { type: Boolean, default: true }
      }
    },
    taxRate: {
      type: Number,
      default: 0.19,
      min: 0,
      max: 1
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better performance
restaurantSchema.index({ name: 1 });
restaurantSchema.index({ 'contact.email': 1 });

module.exports = mongoose.model('Restaurant', restaurantSchema);
