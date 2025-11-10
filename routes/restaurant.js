const express = require('express');
const { auth } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/restaurant
// @desc    Get restaurant data
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    res.json({
      status: 'success',
      data: {
        restaurant: req.restaurant
      }
    });
  } catch (error) {
    console.error('Get restaurant error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
