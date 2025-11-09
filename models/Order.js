const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  inventoryItem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryItem',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: [true, 'La cantidad es requerida'],
    min: [1, 'La cantidad debe ser al menos 1']
  },
  unitPrice: {
    type: Number,
    required: [true, 'El precio unitario es requerido'],
    min: [0, 'El precio no puede ser negativo']
  },
  cost: {
    type: Number,
    required: [true, 'El costo es requerido'],
    min: [0, 'El costo no puede ser negativo']
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, 'El precio total no puede ser negativo']
  }
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true
  },
  customer: {
    name: {
      type: String,
      required: [true, 'El nombre del cliente es requerido'],
      trim: true,
      maxlength: [100, 'El nombre no puede exceder 100 caracteres']
    },
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    address: {
      street: String,
      city: String,
      notes: String
    }
  },
  type: {
    type: String,
    enum: ['dine-in', 'takeout', 'delivery'],
    default: 'dine-in'
  },
  tableNumber: {
    type: String,
    trim: true
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    min: [0, 'El subtotal no puede ser negativo']
  },
  tax: {
    type: Number,
    default: 0,
    min: [0, 'El impuesto no puede ser negativo']
  },
  discount: {
    type: Number,
    default: 0,
    min: [0, 'El descuento no puede ser negativo']
  },
  total: {
    type: Number,
    min: [0, 'El total no puede ser negativo']
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded', 'partially_paid'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'transfer', 'mixed'],
    default: 'cash'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Las notas no pueden exceder 500 caracteres']
  },
  estimatedTime: {
    type: Number, // in minutes
    default: 30
  },
  actualTime: {
    type: Number // in minutes
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  completedAt: {
    type: Date
  },
  inventoryDecrementedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better performance
orderSchema.index({ restaurant: 1, status: 1 });
orderSchema.index({ restaurant: 1, createdAt: -1 });
orderSchema.index({ 'customer.name': 1 });

// Pre-save middleware to calculate totals
orderSchema.pre('save', function(next) {
  // Calculate item totals
  this.items.forEach(item => {
    item.totalPrice = item.quantity * item.unitPrice;
  });
  
  // Calculate subtotal
  this.subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
  
  // Calculate total
  this.total = this.subtotal + this.tax - this.discount;
  
  // Generate order number if not exists
  if (!this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    this.orderNumber = `${year}${month}${day}${random}`;
  }
  
  next();
});

// Static method to get orders by date range
orderSchema.statics.getOrdersByDateRange = function(restaurantId, startDate, endDate) {
  return this.find({
    restaurant: restaurantId,
    createdAt: {
      $gte: startDate,
      $lte: endDate
    },
    isActive: true
  }).sort({ createdAt: -1 });
};

// Static method to get daily sales summary
orderSchema.statics.getDailySales = function(restaurantId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.aggregate([
    {
      $match: {
        restaurant: restaurantId,
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        isActive: true,
        status: { $ne: 'cancelled' }
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$total' },
        averageOrderValue: { $avg: '$total' },
        statusBreakdown: {
          $push: '$status'
        }
      }
    }
  ]);
};

// Instance method to update status
orderSchema.methods.updateStatus = async function(newStatus) {
  const oldStatus = this.status;
  this.status = newStatus;
  
  if ((newStatus === 'preparing' || newStatus === 'delivered') && !this.inventoryDecrementedAt) {
    this.inventoryDecrementedAt = new Date();
    // Update inventory quantities
    for (const item of this.items) {
      await mongoose.model('InventoryItem').findByIdAndUpdate(
        item.inventoryItem,
        { $inc: { quantity: -item.quantity } }
      );
    }
  }

  if (newStatus === 'delivered' && !this.completedAt) {
    this.completedAt = new Date();
    this.actualTime = Math.floor((this.completedAt - this.createdAt) / (1000 * 60));
  }

  // Restore inventory if order is cancelled
  if (newStatus === 'cancelled') {
    if (this.inventoryDecrementedAt) {
      for (const item of this.items) {
        await mongoose.model('InventoryItem').findByIdAndUpdate(
          item.inventoryItem,
          { $inc: { quantity: item.quantity } }
        );
      }
      this.inventoryDecrementedAt = null;
    }
    this.isActive = false; // Set isActive to false when cancelled
  }
  
  return this.save();
};

// Instance method to add item
orderSchema.methods.addItem = function(itemData) {
  this.items.push(itemData);
  return this.save();
};

// Instance method to remove item
orderSchema.methods.removeItem = function(itemId) {
  this.items.id(itemId).remove();
  return this.save();
};

module.exports = mongoose.model('Order', orderSchema);
