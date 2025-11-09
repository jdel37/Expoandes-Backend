const express = require('express');
const { query, validationResult } = require('express-validator');
const Order = require('../models/Order');
const CashClose = require('../models/CashClose');
const InventoryItem = require('../models/InventoryItem');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/analytics/dashboard
// @desc    Get dashboard analytics
// @access  Private
router.get('/dashboard', auth, async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    // Get today's orders summary
    const ordersSummary = await Order.getDailySales(req.restaurant, today);
    
    // Get inventory summary
    const inventorySummary = await InventoryItem.getInventorySummary(req.restaurant);
    
    // Get low stock items
    const lowStockItems = await InventoryItem.getLowStockItems(req.restaurant);
    
    // Get recent orders
    const recentOrders = await Order.find({
      restaurant: req.restaurant,
      isActive: true
    })
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .limit(5);

    // Get cash close summary
    const cashCloseSummary = await CashClose.getDailySummary(req.restaurant, today);

    res.json({
      status: 'success',
      data: {
        orders: ordersSummary[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          statusBreakdown: []
        },
        inventory: inventorySummary[0] || {
          totalItems: 0,
          totalValue: 0,
          lowStockItems: 0,
          categories: []
        },
        lowStockItems,
        recentOrders,
        cashClose: cashCloseSummary[0] || {
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
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/analytics/sales
// @desc    Get sales analytics
// @access  Private
router.get('/sales', [
  auth,
  query('startDate').isISO8601().withMessage('Fecha de inicio inválida'),
  query('endDate').isISO8601().withMessage('Fecha de fin inválida'),
  query('groupBy').optional().isIn(['day', 'week', 'month']).withMessage('Agrupación inválida')
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

    const { startDate, endDate, groupBy = 'day' } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get sales data grouped by period
    let groupFormat;
    switch (groupBy) {
      case 'day':
        groupFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
        break;
      case 'week':
        groupFormat = { $dateToString: { format: '%Y-W%U', date: '$createdAt' } };
        break;
      case 'month':
        groupFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
        break;
    }

    const salesData = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true,
          status: 'delivered' // Only delivered orders for profit calculation
        }
      },
      { $unwind: '$items' }, // Unwind the items array
      {
        $addFields: {
          itemProfit: { $multiply: [{ $subtract: ['$items.unitPrice', '$items.cost'] }, '$items.quantity'] }
        }
      },
      {
        $group: {
          _id: groupFormat,
          totalOrders: { $sum: 1 },
          totalProfit: { $sum: '$itemProfit' }, // Sum itemProfit for totalProfit
          averageOrderValue: { $avg: '$total' }, // Still use total for average order value
          ordersByStatus: {
            $push: '$status'
          }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    // Get payment method breakdown
    const paymentBreakdown = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true,
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$total' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get top selling items
    const topItems = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true,
          status: { $ne: 'cancelled' }
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.name',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.totalPrice' }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      status: 'success',
      data: {
        salesData,
        paymentBreakdown,
        topItems
      }
    });
  } catch (error) {
    console.error('Get sales analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/analytics/inventory
// @desc    Get inventory analytics
// @access  Private
router.get('/inventory', auth, async (req, res) => {
  try {
    // Get inventory summary
    const summary = await InventoryItem.getInventorySummary(req.restaurant);
    
    // Get low stock items
    const lowStockItems = await InventoryItem.getLowStockItems(req.restaurant);
    
    // Get inventory by category
    const categoryBreakdown = await InventoryItem.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          isActive: true
        }
      },
      {
        $group: {
          _id: '$category',
          totalItems: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' },
          totalValue: { $sum: '$totalValue' },
          lowStockCount: {
            $sum: {
              $cond: [{ $lte: ['$quantity', '$minQuantity'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { totalValue: -1 } }
    ]);

    // Get inventory movement (items with recent updates)
    const recentUpdates = await InventoryItem.find({
      restaurant: req.restaurant,
      isActive: true
    })
    .sort({ lastUpdated: -1 })
    .limit(10)
    .select('name category quantity lastUpdated');

    res.json({
      status: 'success',
      data: {
        summary: summary[0] || {
          totalItems: 0,
          totalValue: 0,
          lowStockItems: 0,
          categories: []
        },
        lowStockItems,
        categoryBreakdown,
        recentUpdates
      }
    });
  } catch (error) {
    console.error('Get inventory analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/analytics/orders
// @desc    Get orders analytics
// @access  Private
router.get('/orders', [
  auth,
  query('startDate').isISO8601().withMessage('Fecha de inicio inválida'),
  query('endDate').isISO8601().withMessage('Fecha de fin inválida')
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

    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get orders summary
    const ordersSummary = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true
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
          },
          typeBreakdown: {
            $push: '$type'
          }
        }
      }
    ]);

    // Get orders by status
    const statusBreakdown = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$total' }
        }
      }
    ]);

    // Get orders by type
    const typeBreakdown = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$total' }
        }
      }
    ]);

    // Get hourly distribution
    const hourlyDistribution = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: start, $lte: end },
          isActive: true
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
          totalRevenue: { $sum: '$total' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      status: 'success',
      data: {
        summary: ordersSummary[0] || {
          totalOrders: 0,
          totalRevenue: 0,
          averageOrderValue: 0,
          statusBreakdown: [],
          typeBreakdown: []
        },
        statusBreakdown,
        typeBreakdown,
        hourlyDistribution
      }
    });
  } catch (error) {
    console.error('Get orders analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/analytics/projections
// @desc    Get sales projections
// @access  Private
router.get('/projections', [
  auth,
  query('period').optional().isIn(['week', 'month', 'quarter']).withMessage('Período inválido')
], async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    
    // Get historical data for projections
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(endDate.getDate() - 30); // Last 30 days
        break;
      case 'month':
        startDate.setMonth(endDate.getMonth() - 6); // Last 6 months
        break;
      case 'quarter':
        startDate.setMonth(endDate.getMonth() - 12); // Last 12 months
        break;
    }

    // Get historical sales data
    const historicalData = await Order.aggregate([
      {
        $match: {
          restaurant: req.restaurant,
          createdAt: { $gte: startDate, $lte: endDate },
          isActive: true,
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          totalRevenue: { $sum: '$total' },
          totalOrders: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Simple linear regression for projections
    const projections = calculateProjections(historicalData, period);

    res.json({
      status: 'success',
      data: {
        historicalData,
        projections
      }
    });
  } catch (error) {
    console.error('Get projections error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// Helper function to calculate projections
function calculateProjections(data, period) {
  if (data.length < 2) {
    return {
      nextPeriod: 0,
      trend: 'stable',
      confidence: 'low'
    };
  }

  // Simple linear regression
  const n = data.length;
  const x = data.map((_, index) => index);
  const y = data.map(d => d.totalRevenue);
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) {
    // Data is not suitable for linear regression
    return {
      nextPeriod: y.reduce((a,b) => a+b, 0) / n, // return average
      trend: 'stable',
      confidence: 'low'
    };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate trend
  const recentAvg = y.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, y.length);
  
  const olderDataEndIndex = Math.max(0, y.length - 7);
  const olderData = y.slice(0, olderDataEndIndex);
  const olderAvg = olderData.length > 0 ? olderData.reduce((a, b) => a + b, 0) / olderData.length : 0;
  
  let trend = 'stable';
  if (olderAvg > 0) {
    if (recentAvg > olderAvg * 1.1) trend = 'increasing';
    else if (recentAvg < olderAvg * 0.9) trend = 'decreasing';
  }
  
  // Project next period
  const nextPeriod = Math.max(0, slope * n + intercept);
  
  // Calculate confidence based on data consistency
  const variance = y.reduce((sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2), 0) / n;
  const confidence = variance < 10000 ? 'high' : variance < 50000 ? 'medium' : 'low';

  return {
    nextPeriod: Math.round(nextPeriod),
    trend,
    confidence,
    slope: Math.round(slope * 100) / 100
  };
}

module.exports = router;
// Forcing a reload
