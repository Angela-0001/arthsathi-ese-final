require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const healthRoutes    = require('./routes/health');
const usersRoutes     = require('./routes/users');
const { schemesRouter, insuranceRouter } = require('./routes/schemes');
const documentsRoutes = require('./routes/documents');
const voiceRoutes     = require('./routes/voice');
const ivrRoutes       = require('./routes/ivr');
const ivrCallRoutes   = require('./routes/ivr_call');
const i18nRoutes      = require('./routes/i18n');
const errorHandler    = require('./middleware/errorHandler');
const telegramRoutes  = require('./routes/telegram');
const whatsappRoutes  = require('./routes/whatsapp');
const channelsRoutes  = require('./routes/channels');
const roadmapRoutes   = require('./routes/roadmap');

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));

if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 900000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

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
app.use('/api/roadmap',   roadmapRoutes);
app.use('/api/auth',      require('./routes/auth'));

app.get('/', (req, res) => res.json({ name: 'ArthSathi API', status: 'running' }));

app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } }));

app.use(errorHandler);

module.exports = app;
