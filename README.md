# Restaurante Manager - Backend API

Backend API completo para el sistema de gestión de restaurante con MongoDB, Express.js y Socket.io.

## 🚀 Características

- **API REST completa** para gestión de inventario, pedidos, cierre de caja y usuarios
- **Base de datos MongoDB** con Mongoose ODM
- **Autenticación JWT** con roles de usuario
- **Tiempo real** con Socket.io
- **Validación de datos** con express-validator
- **Seguridad** con helmet, rate limiting y CORS
- **Analytics avanzados** con proyecciones y estadísticas
- **Manejo de errores** robusto

## 📋 Requisitos

- Node.js 16+
- MongoDB 4.4+
- npm o yarn

## 🛠️ Instalación

1. **Clonar el repositorio**
   ```bash
   git clone <repository-url>
   cd restaurante-manager/backend
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**
   ```bash
   cp config.env.example config.env
   ```
   
   Editar `config.env` con tus configuraciones:
   ```env
   MONGODB_URI=mongodb://localhost:27017/restaurante_manager
   PORT=5000
   JWT_SECRET=tu_jwt_secret_muy_seguro_aqui
   JWT_EXPIRE=7d
   CLIENT_URL=http://localhost:3000
   ```

4. **Iniciar MongoDB**
   ```bash
   mongod
   ```

5. **Ejecutar el servidor**
   ```bash
   # Desarrollo
   npm run dev
   
   # Producción
   npm start
   ```

## 📚 API Endpoints

### Autenticación
- `POST /api/auth/register` - Registro de usuario
- `POST /api/auth/login` - Inicio de sesión
- `GET /api/auth/me` - Obtener usuario actual
- `PUT /api/auth/update-preferences` - Actualizar preferencias

### Inventario
- `GET /api/inventory` - Listar productos
- `POST /api/inventory` - Crear producto
- `PUT /api/inventory/:id` - Actualizar producto
- `DELETE /api/inventory/:id` - Eliminar producto
- `POST /api/inventory/:id/update-quantity` - Actualizar cantidad
- `GET /api/inventory/low-stock` - Productos con stock bajo
- `GET /api/inventory/summary` - Resumen de inventario

### Pedidos
- `GET /api/orders` - Listar pedidos
- `POST /api/orders` - Crear pedido
- `PUT /api/orders/:id` - Actualizar pedido
- `PUT /api/orders/:id/status` - Cambiar estado
- `DELETE /api/orders/:id` - Eliminar pedido
- `GET /api/orders/summary/daily` - Resumen diario

### Cierre de Caja
- `GET /api/cash-close` - Listar cierres
- `POST /api/cash-close` - Abrir cierre
- `PUT /api/cash-close/:id/close` - Cerrar caja
- `PUT /api/cash-close/:id/verify` - Verificar cierre
- `POST /api/cash-close/:id/expenses` - Agregar gasto
- `GET /api/cash-close/current` - Cierre actual

### Analytics
- `GET /api/analytics/dashboard` - Datos del dashboard
- `GET /api/analytics/sales` - Análisis de ventas
- `GET /api/analytics/inventory` - Análisis de inventario
- `GET /api/analytics/orders` - Análisis de pedidos
- `GET /api/analytics/projections` - Proyecciones

### Usuarios
- `GET /api/users` - Listar usuarios
- `POST /api/users` - Crear usuario
- `PUT /api/users/:id` - Actualizar usuario
- `DELETE /api/users/:id` - Eliminar usuario
- `PUT /api/users/:id/change-password` - Cambiar contraseña

## 🗄️ Modelos de Datos

### User
- Información del usuario y autenticación
- Roles: admin, manager, employee
- Preferencias de usuario

### Restaurant
- Información del restaurante
- Configuraciones y horarios
- Datos de contacto

### InventoryItem
- Productos del inventario
- Control de stock y precios
- Categorización y proveedores

### Order
- Pedidos de clientes
- Estados y pagos
- Items y totales

### CashClose
- Cierres de caja por turno
- Control de efectivo y ventas
- Gastos y verificaciones

## 🔐 Autenticación

El API usa JWT (JSON Web Tokens) para autenticación:

1. **Registro/Login** - Obtener token
2. **Incluir token** en headers: `Authorization: Bearer <token>`
3. **Token expira** según configuración (default: 7 días)

## 📊 Tiempo Real

Socket.io está configurado para actualizaciones en tiempo real:

- **Inventario** - Cambios en productos
- **Pedidos** - Nuevos pedidos y cambios de estado
- **Cierre de caja** - Actualizaciones de caja

## 🛡️ Seguridad

- **Helmet** - Headers de seguridad
- **Rate Limiting** - Límite de requests
- **CORS** - Control de acceso
- **Validación** - Sanitización de datos
- **JWT** - Autenticación segura

## 📈 Monitoreo

- **Morgan** - Logging de requests
- **Health Check** - `/api/health`
- **Error Handling** - Manejo centralizado

## 🚀 Despliegue

1. **Configurar variables de entorno de producción**
2. **Configurar MongoDB Atlas o servidor**
3. **Usar PM2 para gestión de procesos**
4. **Configurar reverse proxy (nginx)**
5. **SSL/TLS para HTTPS**

## 📝 Scripts

```bash
npm start          # Iniciar en producción
npm run dev        # Iniciar en desarrollo
npm test           # Ejecutar tests
```

## 🤝 Contribución

1. Fork el proyecto
2. Crear feature branch
3. Commit cambios
4. Push al branch
5. Crear Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles.
