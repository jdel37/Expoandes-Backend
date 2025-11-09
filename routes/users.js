const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/users
// @desc    Get all users
// @access  Private (Admin/Manager only)
router.get('/', [
  auth,
  authorize('admin', 'manager'),
  query('page').optional().isInt({ min: 1 }).withMessage('Página debe ser un número positivo'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Límite debe ser entre 1 y 100'),
  query('role').optional().isIn(['admin', 'manager', 'employee']).withMessage('Rol inválido'),
  query('isActive').optional().isBoolean().withMessage('isActive debe ser booleano')
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
      restaurant: req.restaurant
    };

    if (req.query.role) {
      filter.role = req.query.role;
    }

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    // Get users
    const users = await User.find(filter)
      .populate('restaurant', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count
    const total = await User.countDocuments(filter);

    res.json({
      status: 'success',
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   GET /api/users/:id
// @desc    Get single user
// @access  Private
router.get('/:id', auth, async (req, res) => {
  try {
    // Users can only see their own profile unless they're admin/manager
    const canViewOther = req.user.role === 'admin' || req.user.role === 'manager';
    const userId = canViewOther ? req.params.id : req.user._id;

    const user = await User.findOne({
      _id: userId,
      restaurant: req.restaurant
    }).populate('restaurant', 'name');

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      status: 'success',
      data: { user }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   POST /api/users
// @desc    Create user
// @access  Private (Admin/Manager only)
router.post('/', [
  auth,
  authorize('admin', 'manager'),
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('El nombre debe tener entre 2 y 50 caracteres'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('role').isIn(['admin', 'manager', 'employee']).withMessage('Rol inválido')
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

    const { name, email, password, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'El usuario ya existe'
      });
    }

    // Create user
    const userData = {
      name,
      email,
      password,
      role,
      restaurant: req.restaurant
    };

    const user = new User(userData);
    await user.save();

    // Populate for response
    await user.populate('restaurant', 'name');

    res.status(201).json({
      status: 'success',
      message: 'Usuario creado exitosamente',
      data: { user }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private
router.put('/:id', [
  auth,
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('El nombre debe tener entre 2 y 50 caracteres'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Email inválido'),
  body('role').optional().isIn(['admin', 'manager', 'employee']).withMessage('Rol inválido'),
  body('isActive').optional().isBoolean().withMessage('isActive debe ser booleano')
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

    // Users can only update their own profile unless they're admin/manager
    const canUpdateOther = req.user.role === 'admin' || req.user.role === 'manager';
    const userId = canUpdateOther ? req.params.id : req.user._id;

    // Check if user exists
    const existingUser = await User.findOne({
      _id: userId,
      restaurant: req.restaurant
    });

    if (!existingUser) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    // Regular users can't change role or active status
    if (req.user.role === 'employee' && (req.body.role || req.body.isActive !== undefined)) {
      return res.status(403).json({
        status: 'error',
        message: 'No tienes permisos para cambiar el rol o estado del usuario'
      });
    }

    // Check if email is being changed and if it's already taken
    if (req.body.email && req.body.email !== existingUser.email) {
      const emailExists = await User.findOne({ 
        email: req.body.email,
        _id: { $ne: userId }
      });
      
      if (emailExists) {
        return res.status(400).json({
          status: 'error',
          message: 'El email ya está en uso'
        });
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      req.body,
      { new: true, runValidators: true }
    ).populate('restaurant', 'name');

    res.json({
      status: 'success',
      message: 'Usuario actualizado exitosamente',
      data: { user: updatedUser }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   DELETE /api/users/:id
// @desc    Delete user
// @access  Private (Admin only)
router.delete('/:id', [auth, authorize('admin')], async (req, res) => {
  try {
    // Can't delete yourself
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        status: 'error',
        message: 'No puedes eliminar tu propia cuenta'
      });
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        restaurant: req.restaurant
      },
      { isActive: false },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    res.json({
      status: 'success',
      message: 'Usuario eliminado exitosamente'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

// @route   PUT /api/users/:id/change-password
// @desc    Change user password
// @access  Private
router.put('/:id/change-password', [
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

    // Users can only change their own password unless they're admin
    const canChangeOther = req.user.role === 'admin';
    const userId = canChangeOther ? req.params.id : req.user._id;

    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    // Check current password (only if not admin changing someone else's password)
    if (!canChangeOther) {
      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          status: 'error',
          message: 'Contraseña actual incorrecta'
        });
      }
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

// @route   PUT /api/users/:id/toggle-status
// @desc    Toggle user active status
// @access  Private (Admin/Manager only)
router.put('/:id/toggle-status', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    // Can't deactivate yourself
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        status: 'error',
        message: 'No puedes desactivar tu propia cuenta'
      });
    }

    const user = await User.findOne({
      _id: req.params.id,
      restaurant: req.restaurant
    });

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'Usuario no encontrado'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      status: 'success',
      message: `Usuario ${user.isActive ? 'activado' : 'desactivado'} exitosamente`,
      data: { user }
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor'
    });
  }
});

module.exports = router;
