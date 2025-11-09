const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'El nombre del producto es requerido'],
    trim: true,
    maxlength: [100, 'El nombre no puede exceder 100 caracteres']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'La descripción no puede exceder 500 caracteres']
  },
  category: {
    type: String,
    required: [true, 'La categoría es requerida'],
    enum: ['Bebidas', 'Snacks', 'Comida', 'Postres', 'Ingredientes', 'Otros'],
    default: 'Otros'
  },
  sku: {
    type: String,
    sparse: true,
    trim: true,
    uppercase: true
  },
  quantity: {
    type: Number,
    required: [true, 'La cantidad es requerida'],
    min: [0, 'La cantidad no puede ser negativa'],
    default: 0
  },
  minQuantity: {
    type: Number,
    min: [0, 'La cantidad mínima no puede ser negativa'],
    default: 5
  },
  maxQuantity: {
    type: Number,
    min: [0, 'La cantidad máxima no puede ser negativa'],
    default: 1000
  },
  costPrice: {
    type: Number,
    required: [true, 'El precio de costo es requerido'],
    min: [0, 'El precio de costo no puede ser negativo']
  },
  sellingPrice: {
    type: Number,
    required: [true, 'El precio de venta es requerido'],
    min: [0, 'El precio de venta no puede ser negativo']
  },
  unit: {
    type: String,
    required: [true, 'La unidad es requerida'],
    enum: ['unidad', 'kg', 'g', 'l', 'ml', 'caja', 'paquete'],
    default: 'unidad'
  },
  supplier: {
    name: {
      type: String,
      trim: true
    },
    contact: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true
    }
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Calculated fields
  totalValue: {
    type: Number,
    default: 0
  },
  isLowStock: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for better performance
inventoryItemSchema.index({ restaurant: 1, category: 1 });
inventoryItemSchema.index({ restaurant: 1, isActive: 1 });

// Pre-save middleware to calculate derived fields
inventoryItemSchema.pre('save', function(next) {
  // Calculate total value
  this.totalValue = this.quantity * this.costPrice;
  
  // Check if low stock
  this.isLowStock = this.quantity <= this.minQuantity;
  
  // Update last updated
  this.lastUpdated = new Date();
  
  next();
});

// Static method to get low stock items
inventoryItemSchema.statics.getLowStockItems = function(restaurantId) {
  return this.find({
    restaurant: restaurantId,
    isActive: true,
    isLowStock: true
  }).sort({ quantity: 1 });
};

// Static method to get inventory summary
inventoryItemSchema.statics.getInventorySummary = function(restaurantId) {
  return this.aggregate([
    {
      $match: {
        restaurant: restaurantId,
        isActive: true
      }
    },
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        totalValue: { $sum: '$totalValue' },
        lowStockItems: {
          $sum: {
            $cond: [{ $lte: ['$quantity', '$minQuantity'] }, 1, 0]
          }
        },
        categories: { $addToSet: '$category' }
      }
    }
  ]);
};

// Instance method to update quantity
inventoryItemSchema.methods.updateQuantity = function(newQuantity, operation = 'set') {
  if (operation === 'add') {
    this.quantity += newQuantity;
  } else if (operation === 'subtract') {
    this.quantity = Math.max(0, this.quantity - newQuantity);
  } else {
    this.quantity = Math.max(0, newQuantity);
  }
  
  return this.save();
};

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
