const express = require('express');
const { body, validationResult, query } = require('express-validator');
const CashClose = require('../models/CashClose');
const Order = require('../models/Order');
const { auth, authorize } = require('../middleware/auth');

const formatCurrency = (value) => {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(value);
};

const router = express.Router();

// @route   GET /api/cash-close
// @desc    Get all cash closes
// @access  Private
router.get('/', [
  auth,
  query('page').optional().isInt({ min: 1 }).withMessage('Página debe ser un número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite debe ser entre 1 y 100'),
  query('status').optional().isIn(['open', 'closed', 'verified']).withMessage('Estado inválido'),
  query('shift').optional().isIn(['morning', 'afternoon', 'night', 'full-day']).withMessage('Turno inválido'),
  query('startDate').optional().isISO8601().withMessage('Fecha de inicio inválida'),
  query('endDate').optional().isISO8601().withMessage('Fecha de fin inválida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Parámetros inválidos',
        errors: errors.array()
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = {
      restaurant: req.restaurant,
      isActive: true
    };

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.shift) {
      filter.shift = req.query.shift;
    }

    if (req.query.startDate && req.query.endDate) {
      filter.date = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    // Get cash closes
    const cashCloses = await CashClose.find(filter)
      .populate('openedBy', 'name email')
      .populate('closedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await CashClose.countDocuments(filter);

    // Get summary
    const summary = await CashClose.getDailySummary(req.restaurant, new Date());

    res.json({
      status: 'success',
      data: {
        cashCloses,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        summary: summary[0] || {
          totalCashCloses: 0,
          totalSales: 0,
          totalExpenses: 0,
          netSales: 0,
          averageDifference: 0,
          perfectCloses: 0
        }
      }
    });
  } catch (error) {
    console.error('Get cash closes error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/cash-close/current
// @desc    Get current open cash close
// @access  Private
router.get('/current', auth, async (req, res) => {
  try {
    const cashClose = await CashClose.findOne({
      restaurant: req.restaurant,
      status: 'open',
      isActive: true
    })
    .populate('openedBy', 'name email');

    res.json({
      status: 'success',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Get current cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/cash-close/:id
// @desc    Get single cash close
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const cashClose = await CashClose.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    })
    .populate('openedBy', 'name email')
    .populate('closedBy', 'name email')
    .populate('verifiedBy', 'name email');

    if (!cashClose) {
      return res.status(404).json({
        status: 'error',
        message: 'Cierre de caja no encontrado'
      });
    }

    res.json({
      status: 'success',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Get cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/cash-close
// @desc    Create cash close
// @access  Private
router.post('/', [
  auth,
  body('shift').isIn(['morning', 'afternoon', 'night', 'full-day']).withMessage('Turno inválido'),
  body('openingCash').exists().isFloat({ min: 0 }).withMessage('El dinero de apertura debe ser un número no negativo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Cash close creation validation errors:', errors.array());
      return res.status(400).json({
        status: 'error',
        message: 'Datos inválidos: ' + errors.array().map(err => err.msg).join(', '),
        errors: errors.array()
      });
    }

    const { shift, openingCash } = req.body;

    // Check if there's already an open cash close for this shift
    const existingCashClose = await CashClose.findOne({
      restaurant: req.restaurant,
      shift,
      status: 'open',
      isActive: true
    });

    if (existingCashClose) {
      return res.status(400).json({
        status: 'error',
        message: 'Ya existe un cierre de caja abierto para este turno'
      });
    }

    const cashCloseData = {
      shift,
      openingCash,
      expectedCash: openingCash, // Initially same as opening
      restaurant: req.restaurant,
      openedBy: req.user._id
    };

    const cashClose = new CashClose(cashCloseData);
    await cashClose.save();

    // Populate for response
    await cashClose.populate('openedBy', 'name email');

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('cash-close-updated', {
      type: 'opened',
      cashClose
    });

    res.status(201).json({
      status: 'success',
      message: 'Cierre de caja abierto exitosamente',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Create cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/cash-close/:id/close
// @desc    Close cash
// @access  Private
router.put('/:id/close', [
  auth,
  body('closingCash').isFloat({ min: 0 }).withMessage('El dinero de cierre debe ser un número no negativo'),
  body('sales.card').isFloat({ min: 0 }).withMessage('Ventas con tarjeta deben ser no negativas'),
  body('expenses').optional().isArray().withMessage('Gastos deben ser un array'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notas muy largas')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { closingCash, sales, expenses = [], notes } = req.body;

    const cashClose = await CashClose.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!cashClose) {
      return res.status(404).json({
        status: 'error',
        message: 'Cierre de caja no encontrado'
      });
    }

    if (cashClose.status !== 'open') {
      return res.status(400).json({
        status: 'error',
        message: 'El cierre de caja no está abierto'
      });
    }

    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Calculate total sales from delivered orders
    const deliveredOrders = await Order.find({
      restaurant: req.restaurant,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      isActive: true,
      status: 'delivered'
    });
    const totalSalesFromOrders = deliveredOrders.reduce((sum, order) => sum + order.total, 0);

    // Close cash
    await cashClose.closeCash({
      closingCash,
      cardSales: sales.card,
      totalSalesFromOrders,
      expenses,
      notes
    }, req.user._id);

    // Populate for response
    await cashClose.populate([
      { path: 'openedBy', select: 'name email' },
      { path: 'closedBy', select: 'name email' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('cash-close-updated', {
      type: 'closed',
      cashClose
    });

    res.json({
      status: 'success',
      message: 'Cierre de caja realizado exitosamente',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Close cash error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/cash-close/:id/verify
// @desc    Verify cash close
// @access  Private
router.put('/:id/verify', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const cashClose = await CashClose.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!cashClose) {
      return res.status(404).json({
        status: 'error',
        message: 'Cierre de caja no encontrado'
      });
    }

    if (cashClose.status !== 'closed') {
      return res.status(400).json({
        status: 'error',
        message: 'El cierre de caja debe estar cerrado para ser verificado'
      });
    }

    await cashClose.verifyCashClose(req.user._id);

    // Populate for response
    await cashClose.populate([
      { path: 'openedBy', select: 'name email' },
      { path: 'closedBy', select: 'name email' },
      { path: 'verifiedBy', select: 'name email' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('cash-close-updated', {
      type: 'verified',
      cashClose
    });

    res.json({
      status: 'success',
      message: 'Cierre de caja verificado exitosamente',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Verify cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/cash-close/:id/expenses
// @desc    Add expense to cash close
// @access  Private
router.post('/:id/expenses', [
  auth,
  body('description').trim().isLength({ min: 1, max: 200 }).withMessage('Descripción requerida (máximo 200 caracteres)'),
  body('amount').isFloat({ min: 0 }).withMessage('El monto debe ser un número no negativo'),
  body('category').isIn(['supplies', 'utilities', 'maintenance', 'other']).withMessage('Categoría inválida'),
  body('receipt').optional().trim().isLength({ max: 500 }).withMessage('Recibo muy largo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { description, amount, category, receipt } = req.body;

    const cashClose = await CashClose.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!cashClose) {
      return res.status(404).json({
        status: 'error',
        message: 'Cierre de caja no encontrado'
      });
    }

    if (cashClose.status !== 'open') {
      return res.status(400).json({
        status: 'error',
        message: 'Solo se pueden agregar gastos a cierres de caja abiertos'
      });
    }

    await cashClose.addExpense({
      description,
      amount,
      category,
      receipt
    });

    // Populate for response
    await cashClose.populate([
      { path: 'openedBy', select: 'name email' },
      { path: 'closedBy', select: 'name email' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('cash-close-updated', {
      type: 'expense_added',
      cashClose
    });

    res.json({
      status: 'success',
      message: 'Gasto agregado exitosamente',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/cash-close/:id/restore
// @desc    Restore a closed or verified cash close to open status
// @access  Private
router.put('/:id/restore', auth, async (req, res) => {
  try {
    const cashClose = await CashClose.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!cashClose) {
      return res.status(404).json({
        status: 'error',
        message: 'Cierre de caja no encontrado'
      });
    }

    if (cashClose.status === 'open') {
      return res.status(400).json({
        status: 'error',
        message: 'El cierre de caja ya está abierto'
      });
    }

    await cashClose.restoreCashClose();

    // Populate for response
    await cashClose.populate([
      { path: 'openedBy', select: 'name email' },
      { path: 'closedBy', select: 'name email' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('cash-close-updated', {
      type: 'restored',
      cashClose
    });

    res.json({
      status: 'success',
      message: 'Cierre de caja restaurado exitosamente',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Restore cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/cash-close/summary/daily
// @desc    Get daily cash close summary
// @access  Private
router.get('/summary/daily', [
  auth,
  query('date').optional().isISO8601().withMessage('Fecha inválida')
], async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const summary = await CashClose.getDailySummary(req.restaurant, date);

    res.json({
      status: 'success',
      data: { summary: summary[0] || {
        totalCashCloses: 0,
        totalSales: 0,
        totalExpenses: 0,
        netSales: 0,
        averageDifference: 0,
        perfectCloses: 0
      }}
    });
  } catch (error) {
    console.error('Get daily summary error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/cash-close/current
// @desc    Get current open cash close
// @access  Private
router.get('/current', auth, async (req, res) => {
  try {
    const cashClose = await CashClose.findOne({
      restaurant: req.restaurant,
      status: 'open',
      isActive: true
    })
    .populate('openedBy', 'name email');

    res.json({
      status: 'success',
      data: { cashClose }
    });
  } catch (error) {
    console.error('Get current cash close error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
