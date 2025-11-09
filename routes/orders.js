const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Order = require('../models/Order');
const InventoryItem = require('../models/InventoryItem');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/orders
// @desc    Get all orders
// @access  Private
router.get('/', [
  auth,
  query('page').optional().isInt({ min: 1 }).withMessage('Página debe ser un número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite debe ser entre 1 y 100'),
  query('status').optional().isIn(['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']).withMessage('Estado inválido'),
  query('type').optional().isIn(['dine-in', 'takeout', 'delivery']).withMessage('Tipo inválido'),
  query('date').optional().isISO8601().withMessage('Fecha inválida'),
  query('search').optional().trim().isLength({ max: 100 }).withMessage('Búsqueda muy larga')
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

    if (req.query.type) {
      filter.type = req.query.type;
    }

    if (req.query.date) {
      const date = new Date(req.query.date);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      filter.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay
      };
    }

    if (req.query.search) {
      filter.$or = [
        { orderNumber: { $regex: req.query.search, $options: 'i' } },
        { 'customer.name': { $regex: req.query.search, $options: 'i' } },
        { 'customer.phone': { $regex: req.query.search, $options: 'i' } }
      ];
    }

    // Get orders
    const orders = await Order.find(filter)
      .populate('createdBy', 'name email')
      .populate('assignedTo', 'name email')
      .populate('items.inventoryItem', 'name category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await Order.countDocuments(filter);

    // Get summary
    const summary = await Order.getDailySales(req.restaurant, new Date());

    res.json({
      status: 'success',
      data: {
        orders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        summary: summary[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          statusBreakdown: []
        }
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/orders/:id
// @desc    Get single order
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    })
    .populate('createdBy', 'name email')
    .populate('assignedTo', 'name email')
    .populate('items.inventoryItem', 'name category unit');

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Pedido no encontrado'
      });
    }

    res.json({
      status: 'success',
      data: { order }
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/orders
// @desc    Create order
// @access  Private
router.post('/', [
  auth,
  body('customer.name').trim().isLength({ min: 1, max: 100 }).withMessage('El nombre del cliente es requerido'),
  body('customer.phone').optional().trim().isLength({ max: 20 }).withMessage('Teléfono muy largo'),
  body('customer.email').optional().isEmail().normalizeEmail().withMessage('Email inválido'),
  body('type').isIn(['dine-in', 'takeout', 'delivery']).withMessage('Tipo de pedido inválido'),
  body('tableNumber').optional().trim().isLength({ max: 10 }).withMessage('Número de mesa muy largo'),
  body('items').isArray({ min: 1 }).withMessage('Debe tener al menos un item'),
  body('items.*.inventoryItem').isMongoId().withMessage('ID de inventario inválido'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Cantidad debe ser al menos 1'),
  body('paymentMethod').optional().isIn(['cash', 'card', 'transfer', 'mixed']).withMessage('Método de pago inválido'),
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

    const { customer, type, tableNumber, items, paymentMethod = 'cash', notes } = req.body;

    // Validate inventory items and get prices
    const orderItems = [];
    for (const item of items) {
      const inventoryItem = await InventoryItem.findOne({
        _id: item.inventoryItem,
        restaurant: req.restaurant,
        isActive: true
      });

      if (!inventoryItem) {
        return res.status(400).json({
          status: 'error',
          message: `Producto ${item.inventoryItem} no encontrado`
        });
      }

      if (inventoryItem.quantity < item.quantity) {
        return res.status(400).json({
          status: 'error',
          message: `Stock insuficiente para ${inventoryItem.name}. Disponible: ${inventoryItem.quantity}`
        });
      }

      orderItems.push({
        inventoryItem: inventoryItem._id,
        name: inventoryItem.name,
        quantity: item.quantity,
        unitPrice: inventoryItem.sellingPrice,
        cost: inventoryItem.costPrice, // Add cost here
        totalPrice: inventoryItem.sellingPrice * item.quantity
      });
    }

    // Create order
    const orderData = {
      customer,
      type,
      tableNumber,
      items: orderItems,
      paymentMethod,
      notes,
      restaurant: req.restaurant,
      createdBy: req.user._id
    };

    const order = new Order(orderData);
    await order.save();

    // Populate order for response
    await order.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'items.inventoryItem', select: 'name category unit' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('order-updated', {
      type: 'created',
      order
    });

    res.status(201).json({
      status: 'success',
      message: 'Pedido creado exitosamente',
      data: { order }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/orders/:id
// @desc    Update order
// @access  Private
router.put('/:id', [
  auth,
  body('customer.name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Nombre del cliente inválido'),
  body('customer.phone').optional().trim().isLength({ max: 20 }).withMessage('Teléfono muy largo'),
  body('customer.email').optional().isEmail().normalizeEmail().withMessage('Email inválido'),
  body('type').optional().isIn(['dine-in', 'takeout', 'delivery']).withMessage('Tipo de pedido inválido'),
  body('tableNumber').optional().trim().isLength({ max: 10 }).withMessage('Número de mesa muy largo'),
  body('paymentMethod').optional().isIn(['cash', 'card', 'transfer', 'mixed']).withMessage('Método de pago inválido'),
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

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Pedido no encontrado'
      });
    }

    // Update order
    Object.assign(order, req.body);
    await order.save();

    // Populate order for response
    await order.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo', select: 'name email' },
      { path: 'items.inventoryItem', select: 'name category unit' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('order-updated', {
      type: 'updated',
      order
    });

    res.json({
      status: 'success',
      message: 'Pedido actualizado exitosamente',
      data: { order }
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/orders/:id/status
// @desc    Update order status
// @access  Private
router.put('/:id/status', [
  auth,
  body('status').isIn(['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']).withMessage('Estado inválido')
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

    const { status } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Pedido no encontrado'
      });
    }

    await order.updateStatus(status);

    // Populate order for response
    await order.populate([
      { path: 'createdBy', select: 'name email' },
      { path: 'assignedTo', select: 'name email' },
      { path: 'items.inventoryItem', select: 'name category unit' }
    ]);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('order-updated', {
      type: 'status_updated',
      order
    });

    res.json({
      status: 'success',
      message: 'Estado del pedido actualizado exitosamente',
      data: { order }
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   DELETE /api/orders/:id
// @desc    Delete order
// @access  Private
router.delete('/:id', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Pedido no encontrado'
      });
    }

    // Restore inventory quantities if order is not delivered
    if (order.status !== 'delivered') {
      for (const item of order.items) {
        await InventoryItem.findByIdAndUpdate(
          item.inventoryItem,
          { $inc: { quantity: item.quantity } }
        );
      }
    }

    // Soft delete order
    order.isActive = false;
    await order.save();

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('order-updated', {
      type: 'deleted',
      orderId: req.params.id
    });

    res.json({
      status: 'success',
      message: 'Pedido eliminado exitosamente'
    });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/orders/summary/daily
// @desc    Get daily orders summary
// @access  Private
router.get('/summary/daily', [
  auth,
  query('date').optional().isISO8601().withMessage('Fecha inválida')
], async (req, res) => {
  try {
    const date = req.query.date ? new Date(req.query.date) : new Date();
    const summary = await Order.getDailySales(req.restaurant, date);

    res.json({
      status: 'success',
      data: { summary: summary[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0,
        statusBreakdown: []
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

module.exports = router;
