const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @route   POST /api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('El nombre debe tener entre 2 y 50 caracteres'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('restaurantName').trim().isLength({ min: 2, max: 100 }).withMessage('El nombre del restaurante es requerido'),
  body('restaurantAddress.street').trim().notEmpty().withMessage('La dirección es requerida'),
  body('restaurantAddress.city').trim().notEmpty().withMessage('La ciudad es requerida'),
  body('restaurantAddress.state').trim().notEmpty().withMessage('El estado es requerido'),
  body('restaurantAddress.zipCode').trim().notEmpty().withMessage('El código postal es requerido'),
  body('restaurantAddress.country').trim().notEmpty().withMessage('El país es requerido'),
  body('restaurantContact.phone').trim().notEmpty().withMessage('El teléfono es requerido'),
  body('restaurantContact.email').isEmail().normalizeEmail().withMessage('Email del restaurante inválido')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { name, email, password, restaurantName, restaurantAddress, restaurantContact } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'El usuario ya existe'
      });
    }

    // Create restaurant
    const restaurant = new Restaurant({
      name: restaurantName,
      address: restaurantAddress,
      contact: restaurantContact
    });

    await restaurant.save();

    // Create user
    const user = new User({
      name,
      email,
      password,
      role: 'admin',
      restaurant: restaurant._id
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      status: 'success',
      message: 'Usuario registrado exitosamente',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          restaurant: {
            id: restaurant._id,
            name: restaurant.name
          }
        },
        token
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').notEmpty().withMessage('La contraseña es requerida')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Datos inválidos',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Check if user exists and get password
    const user = await User.findOne({ email }).select('+password').populate('restaurant');
    
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Credenciales inválidas'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        status: 'error',
        message: 'Usuario inactivo'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Credenciales inválidas'
      });
    }

    // Update last login
    await user.updateLastLogin();

    // Generate token
    const token = generateToken(user._id);

    res.json({
      status: 'success',
      message: 'Login exitoso',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          restaurant: {
            id: user.restaurant._id,
            name: user.restaurant.name
          },
          preferences: user.preferences
        },
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('restaurant');
    
    res.json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          restaurant: {
            id: user.restaurant._id,
            name: user.restaurant.name
          },
          preferences: user.preferences,
          lastLogin: user.lastLogin
        }
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/auth/update-preferences
// @desc    Update user preferences
// @access  Private
router.put('/update-preferences', [
  auth,
  body('notifications').optional().isBoolean().withMessage('Notifications debe ser booleano'),
  body('darkMode').optional().isBoolean().withMessage('DarkMode debe ser booleano'),
  body('language').optional().isIn(['es', 'en']).withMessage('Idioma inválido'),
  body('lowStockThreshold').optional().isNumeric().withMessage('El umbral de stock bajo debe ser un número'),
  body('mediumStockThreshold').optional().isNumeric().withMessage('El umbral de stock medio debe ser un número')
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

    const { notifications, darkMode, language, lowStockThreshold, mediumStockThreshold } = req.body;
    const updateData = {};

    if (notifications !== undefined) updateData['preferences.notifications'] = notifications;
    if (darkMode !== undefined) updateData['preferences.darkMode'] = darkMode;
    if (language !== undefined) updateData['preferences.language'] = language;
    if (lowStockThreshold !== undefined) updateData['preferences.lowStockThreshold'] = lowStockThreshold;
    if (mediumStockThreshold !== undefined) updateData['preferences.mediumStockThreshold'] = mediumStockThreshold;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('restaurant');

    res.json({
      status: 'success',
      message: 'Preferencias actualizadas',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          restaurant: {
            id: user.restaurant._id,
            name: user.restaurant.name
          },
          preferences: user.preferences
        }
      }
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private
router.post('/change-password', [
  auth,
  body('currentPassword').notEmpty().withMessage('La contraseña actual es requerida'),
  body('newPassword').isLength({ min: 6 }).withMessage('La nueva contraseña debe tener al menos 6 caracteres')
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

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user._id).select('+password');

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        status: 'error',
        message: 'Contraseña actual incorrecta'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      status: 'success',
      message: 'Contraseña actualizada exitosamente'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
