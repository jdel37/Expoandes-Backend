const mongoose = require('mongoose');

const cashCloseSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: [true, 'La fecha es requerida'],
    default: Date.now
  },
  shift: {
    type: String,
    enum: ['morning', 'afternoon', 'night', 'full-day'],
    required: [true, 'El turno es requerido']
  },
  openingCash: {
    type: Number,
    required: [true, 'El dinero de apertura es requerido'],
    min: [0, 'El dinero de apertura no puede ser negativo']
  },
  openedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  closingCash: {
    type: Number,
    min: [0, 'El dinero de cierre no puede ser negativo']
  },
  expectedCash: {
    type: Number,
    min: [0, 'El dinero esperado no puede ser negativo']
  },
  difference: {
    type: Number
  },
  sales: {
    cash: {
      type: Number,
      default: 0,
      min: [0, 'Las ventas en efectivo no pueden ser negativas']
    },
    card: {
      type: Number,
      default: 0,
      min: [0, 'Las ventas con tarjeta no pueden ser negativas']
    },
    transfer: {
      type: Number,
      default: 0,
      min: [0, 'Las ventas por transferencia no pueden ser negativas']
    },
    total: {
      type: Number,
      min: [0, 'El total de ventas no puede ser negativo']
    }
  },
  expenses: [{
    description: {
      type: String,
      required: true,
      trim: true
    },
    amount: {
      type: Number,
      required: true,
      min: [0, 'El monto del gasto no puede ser negativo']
    },
    category: {
      type: String,
      enum: ['supplies', 'utilities', 'maintenance', 'other'],
      default: 'other'
    },
    receipt: {
      type: String // URL or path to receipt image
    }
  }],
  totalExpenses: {
    type: Number,
    default: 0,
    min: [0, 'El total de gastos no puede ser negativo']
  },
  netSales: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'verified'],
    default: 'open'
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Las notas no pueden exceder 500 caracteres']
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: {
    type: Date
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for better performance
cashCloseSchema.index({ restaurant: 1, date: -1 });
cashCloseSchema.index({ restaurant: 1, status: 1 });
cashCloseSchema.index({ openedBy: 1 });

// Pre-save middleware to calculate derived fields
cashCloseSchema.pre('save', function(next) {
  // Calculate total expenses
  this.totalExpenses = this.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  
  // Calculate net sales
  this.netSales = this.sales.total - this.totalExpenses;
  
  next();
});

// Static method to get cash close by date range
cashCloseSchema.statics.getCashClosesByDateRange = function(restaurantId, startDate, endDate) {
  return this.find({
    restaurant: restaurantId,
    date: {
      $gte: startDate,
      $lte: endDate
    },
    isActive: true
  }).sort({ date: -1 });
};

// Static method to get daily summary
cashCloseSchema.statics.getDailySummary = function(restaurantId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  return this.aggregate([
    {
      $match: {
        restaurant: restaurantId,
        date: { $gte: startOfDay, $lte: endOfDay },
        isActive: true,
        status: 'closed'
      }
    },
    {
      $group: {
        _id: null,
        totalCashCloses: { $sum: 1 },
        totalSales: { $sum: '$sales.total' },
        totalExpenses: { $sum: '$totalExpenses' },
        netSales: { $sum: '$netSales' },
        averageDifference: { $avg: '$difference' },
        perfectCloses: {
          $sum: {
            $cond: [{ $eq: ['$difference', 0] }, 1, 0]
          }
        }
      }
    }
  ]);
};

// Instance method to close cash
cashCloseSchema.methods.closeCash = function(closingData, closedBy) {
  this.closingCash = closingData.closingCash;
  this.sales.card = closingData.cardSales;
  this.expenses = closingData.expenses || [];
  this.notes = closingData.notes || '';
  this.closedBy = closedBy;
  this.status = 'closed';

  // Calculate total reported sales (cash in drawer + card sales)
  const totalReportedSales = this.closingCash + this.sales.card;
  
  // Total sales from delivered orders (system's record)
  const totalSystemSales = closingData.totalSalesFromOrders;

  // The difference is between what was reported and what the system recorded
  this.difference = totalReportedSales - totalSystemSales;
  
  // Update sales total with system's record
  this.sales.total = totalSystemSales;
  
  // Calculate cash sales from system (total system sales - card sales reported by user)
  this.sales.cash = totalSystemSales - this.sales.card;

  // Calculate total expenses (this is already done in pre-save, but good to be explicit here)
  this.totalExpenses = this.expenses.reduce((sum, expense) => sum + expense.amount, 0);

  // Calculate expected cash in drawer (opening cash + cash sales from system - total expenses)
  this.expectedCash = this.openingCash + this.sales.cash - this.totalExpenses;

  // The difference is between what was reported (closingCash) and what was expected
  this.difference = this.closingCash - this.expectedCash;
  
  return this.save();
};

// Instance method to verify cash close
cashCloseSchema.methods.verifyCashClose = function(verifiedBy) {
  this.verifiedBy = verifiedBy;
  this.verifiedAt = new Date();
  this.status = 'verified';
  
  return this.save();
};

// Instance method to add expense
cashCloseSchema.methods.addExpense = function(expenseData) {
  this.expenses.push(expenseData);
  return this.save();
};

// Instance method to restore cash close
cashCloseSchema.methods.restoreCashClose = function() {
  this.status = 'open';
  this.closingCash = undefined;
  this.closedBy = undefined;
  this.verifiedBy = undefined;
  this.verifiedAt = undefined;
  this.sales.card = 0;
  this.sales.total = 0;
  this.sales.cash = 0;
  this.difference = undefined;
  this.expectedCash = this.openingCash; // Reset expected cash to opening cash

  return this.save();
};

module.exports = mongoose.model('CashClose', cashCloseSchema);
