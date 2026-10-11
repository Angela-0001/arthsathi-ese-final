/**
 * ArthSathi — Express Application
 *
 * This file configures and exports the Express app instance.
 * It is kept separate from server.js so the app can be imported
 * in tests without starting a listening socket.
 */

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const healthRoutes  = require('./routes/health');
const usersRoutes   = require('./routes/users');
const { schemesRouter, insuranceRouter } = require('./routes/schemes');
const documentsRoutes = require('./routes/documents');
const voiceRoutes   = require('./routes/voice');
const ivrRoutes    = require('./routes/ivr');
const ivrCallRoutes = require('./routes/ivr_call');
const i18nRoutes    = require('./routes/i18n');
const { isEngineHealthy } = require('./services/engineService');
const errorHandler  = require('./middleware/errorHandler');
const telegramRoutes  = require('./routes/telegram');
const whatsappRoutes  = require('./routes/whatsapp');
const channelsRoutes  = require('./routes/channels');

const app = express();

// Trust proxy — required when running behind ngrok/reverse proxy
// This fixes express-rate-limit's X-Forwarded-For validation error
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.use(helmet());

// CORS — allow the Next.js frontend (adjust origins in production)
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// Rate limiting — protects against abuse
// ---------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '100',    10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } },
});
app.use('/api/', limiter);

// ---------------------------------------------------------------------------
// Static file serving for uploaded documents
// ---------------------------------------------------------------------------
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/health',    healthRoutes);
app.use('/api/users',     usersRoutes);
app.use('/api/schemes',   schemesRouter);
app.use('/api/insurance', insuranceRouter);
app.use('/api/documents', documentsRoutes);
app.use('/api/voice',     voiceRoutes);
app.use('/api/ivr',       ivrRoutes);
app.use('/api/ivr',       ivrCallRoutes);
app.use('/api/i18n',      i18nRoutes);
app.use('/api/telegram',  telegramRoutes);
app.use('/api/whatsapp',  whatsappRoutes);
app.use('/api/channels',  channelsRoutes);

// Root — simple info response
app.get('/', (req, res) => {
  res.json({
    name:    'ArthSathi API',
    version: '1.0.0',
    status:  'running',
    docs:    '/api/health',
  });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
});

// ---------------------------------------------------------------------------
// Global error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
