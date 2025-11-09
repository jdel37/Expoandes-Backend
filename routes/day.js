const express = require('express');
const { auth, authorize } = require('../middleware/auth');
const Order = require('../models/Order');
const CashClose = require('../models/CashClose');
const Restaurant = require('../models/Restaurant');

const router = express.Router();

// @route   POST /api/day/end
// @desc    End the day, calculate stats, and reset orders
// @access  Private (manager or admin)
router.post('/end', async (req, res) => {
  try {
    const restaurantId = req.restaurant;

    // 1. Get all active orders for the restaurant for the current day
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const orders = await Order.find({
      restaurant: restaurantId,
      isActive: true,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    // 2. Calculate total revenue and other stats from these orders
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const totalOrders = orders.length;

    // 3. Create a projection/summary record (using CashClose model for simplicity)
    // This is a simplified "end of day" record, not a full cash close.
    const endOfDayRecord = new CashClose({
      date: new Date(),
      shift: 'full-day', // Or a new enum like 'end-of-day'
      openedBy: req.user._id,
      closedBy: req.user._id,
      openingCash: 0, // Assuming 0 for this automatic process
      closingCash: totalRevenue, // Or just what's in cash
      expectedCash: totalRevenue,
      difference: 0,
      sales: {
        total: totalRevenue,
      },
      status: 'closed',
      notes: 'Cierre de día automático.',
      restaurant: restaurantId,
    });
    await endOfDayRecord.save();

    // 4. Soft-delete all active orders for the restaurant
    await Order.updateMany(
      { restaurant: restaurantId, isActive: true },
      { $set: { isActive: false } }
    );
    
    // Emit a socket event to notify clients that orders have been cleared
    req.io.to(`restaurant-${restaurantId}`).emit('orders-cleared');

    res.json({
      status: 'success',
      message: 'Día finalizado exitosamente. Los pedidos han sido archivados y las estadísticas guardadas.',
      data: {
        totalRevenue,
        totalOrders,
        endOfDayRecordId: endOfDayRecord._id
      }
    });

  } catch (error) {
    console.error('End of day error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor al finalizar el día.'
    });
  }
});

module.exports = router;
