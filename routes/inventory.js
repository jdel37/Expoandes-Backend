const express = require('express');
const { body, validationResult, query } = require('express-validator');
const InventoryItem = require('../models/InventoryItem');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/inventory
// @desc    Get all inventory items
// @access  Private
router.get('/', [
  auth,
  query('page').optional().isInt({ min: 1 }).withMessage('Página debe ser un número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite debe ser entre 1 y 100'),
  query('category').optional().isIn(['Bebidas', 'Snacks', 'Comida', 'Postres', 'Ingredientes', 'Otros']).withMessage('Categoría inválida'),
  query('search').optional().trim().isLength({ max: 100 }).withMessage('Búsqueda muy larga'),
  query('lowStock').optional().isBoolean().withMessage('LowStock debe ser booleano')
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

    if (req.query.category) {
      filter.category = req.query.category;
    }

    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { sku: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    if (req.query.lowStock === 'true') {
      filter.isLowStock = true;
    }

    // Get items
    const items = await InventoryItem.find(filter)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await InventoryItem.countDocuments(filter);

    // Get summary
    const summary = await InventoryItem.getInventorySummary(req.restaurant);

    res.json({
      status: 'success',
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        },
        summary: summary[0] || {
          totalItems: 0,
          totalValue: 0,
          lowStockItems: 0,
          categories: []
        }
      }
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/inventory/:id
// @desc    Get single inventory item
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    const item = await InventoryItem.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        status: 'error',
        message: 'Producto no encontrado'
      });
    }

    res.json({
      status: 'success',
      data: { item }
    });
  } catch (error) {
    console.error('Get inventory item error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/inventory
// @desc    Create inventory item
// @access  Private
router.post('/', [
  auth,
  authorize('admin', 'manager'),
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('El nombre es requerido y debe tener máximo 100 caracteres'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('La descripción no puede exceder 500 caracteres'),
  body('category').isIn(['Bebidas', 'Snacks', 'Comida', 'Postres', 'Ingredientes', 'Otros']).withMessage('Categoría inválida'),
  body('quantity').isInt({ min: 0 }).withMessage('La cantidad debe ser un número entero no negativo'),
  body('minQuantity').optional().isInt({ min: 0 }).withMessage('La cantidad mínima debe ser un número entero no negativo'),
  body('maxQuantity').optional().isInt({ min: 0 }).withMessage('La cantidad máxima debe ser un número entero no negativo'),
  body('costPrice').isFloat({ min: 0 }).withMessage('El precio de costo debe ser un número no negativo'),
  body('sellingPrice').isFloat({ min: 0 }).withMessage('El precio de venta debe ser un número no negativo'),
  body('unit').isIn(['unidad', 'kg', 'g', 'l', 'ml', 'caja', 'paquete']).withMessage('Unidad inválida'),
  body('sku').optional().trim().isLength({ max: 20 }).withMessage('SKU no puede exceder 20 caracteres')
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

    const itemData = {
      ...req.body,
      restaurant: req.restaurant
    };

    const item = new InventoryItem(itemData);
    await item.save();

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('inventory-updated', {
      type: 'created',
      item
    });

    res.status(201).json({
      status: 'success',
      message: 'Producto creado exitosamente',
      data: { item }
    });
  } catch (error) {
    console.error('Create inventory item error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/inventory/:id
// @desc    Update inventory item
// @access  Private
router.put('/:id', [
  auth,
  authorize('admin', 'manager'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('El nombre debe tener máximo 100 caracteres'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('La descripción no puede exceder 500 caracteres'),
  body('category').optional().isIn(['Bebidas', 'Snacks', 'Comida', 'Postres', 'Ingredientes', 'Otros']).withMessage('Categoría inválida'),
  body('quantity').optional().isInt({ min: 0 }).withMessage('La cantidad debe ser un número entero no negativo'),
  body('minQuantity').optional().isInt({ min: 0 }).withMessage('La cantidad mínima debe ser un número entero no negativo'),
  body('maxQuantity').optional().isInt({ min: 0 }).withMessage('La cantidad máxima debe ser un número entero no negativo'),
  body('costPrice').optional().isFloat({ min: 0 }).withMessage('El precio de costo debe ser un número no negativo'),
  body('sellingPrice').optional().isFloat({ min: 0 }).withMessage('El precio de venta debe ser un número no negativo'),
  body('unit').optional().isIn(['unidad', 'kg', 'g', 'l', 'ml', 'caja', 'paquete']).withMessage('Unidad inválida')
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

    const item = await InventoryItem.findOneAndUpdate(
      {
        _id: req.params.id,
        restaurant: req.restaurant,
        isActive: true
      },
      req.body,
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({
        status: 'error',
        message: 'Producto no encontrado'
      });
    }

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('inventory-updated', {
      type: 'updated',
      item
    });

    res.json({
      status: 'success',
      message: 'Producto actualizado exitosamente',
      data: { item }
    });
  } catch (error) {
    console.error('Update inventory item error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   DELETE /api/inventory/:id
// @desc    Delete inventory item
// @access  Private
router.delete('/:id', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const item = await InventoryItem.findOneAndUpdate(
      {
        _id: req.params.id,
        restaurant: req.restaurant,
        isActive: true
      },
      { isActive: false },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({
        status: 'error',
        message: 'Producto no encontrado'
      });
    }

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('inventory-updated', {
      type: 'deleted',
      itemId: req.params.id
    });

    res.json({
      status: 'success',
      message: 'Producto eliminado exitosamente'
    });
  } catch (error) {
    console.error('Delete inventory item error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/inventory/:id/update-quantity
// @desc    Update item quantity
// @access  Private
router.post('/:id/update-quantity', [
  auth,
  body('quantity').isInt({ min: 0 }).withMessage('La cantidad debe ser un número entero no negativo'),
  body('operation').optional().isIn(['set', 'add', 'subtract']).withMessage('Operación inválida')
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

    const { quantity, operation = 'set' } = req.body;

    const item = await InventoryItem.findOne({
      _id: req.params.id,
      restaurant: req.restaurant,
      isActive: true
    });

    if (!item) {
      return res.status(404).json({
        status: 'error',
        message: 'Producto no encontrado'
      });
    }

    await item.updateQuantity(quantity, operation);

    // Emit real-time update
    req.io.to(`restaurant-${req.restaurant}`).emit('inventory-updated', {
      type: 'quantity_updated',
      item
    });

    res.json({
      status: 'success',
      message: 'Cantidad actualizada exitosamente',
      data: { item }
    });
  } catch (error) {
    console.error('Update quantity error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/inventory/low-stock
// @desc    Get low stock items
// @access  Private
router.get('/low-stock', auth, async (req, res) => {
  try {
    const lowStockItems = await InventoryItem.getLowStockItems(req.restaurant);

    res.json({
      status: 'success',
      data: { items: lowStockItems }
    });
  } catch (error) {
    console.error('Get low stock items error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/inventory/summary
// @desc    Get inventory summary
// @access  Private
router.get('/summary', auth, async (req, res) => {
  try {
    const summary = await InventoryItem.getInventorySummary(req.restaurant);

    res.json({
      status: 'success',
      data: { summary: summary[0] || {
        totalItems: 0,
        totalValue: 0,
        lowStockItems: 0,
        categories: []
      }}
    });
  } catch (error) {
    console.error('Get inventory summary error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
