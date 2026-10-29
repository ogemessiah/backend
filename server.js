const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const paymentRoutes = require('./routes/payment');

const authRoutes = require('./routes/auth');

const terminalRoutes = require('./routes/terminal');

const tunnelmouthRoutes = require('./routes/tunnelmouth');

const adminNotificationsRoutes = require('./routes/adminNotifications');

const aiRoutes = require('./routes/ai');

const app = express();

app.set('trust proxy', 1);

// =========================
// RATE LIMITERS
// =========================

// Distance Matrix: 15 requests per IP per hour
const distanceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  }
});

// Google Places Autocomplete: 30 requests per IP per 15 minutes
const placesAutocompleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many address searches. Please try again later.'
  }
});

// Google Places Details: 30 requests per IP per 15 minutes
const placesDetailsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many address detail requests. Please try again later.'
  }
});

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {

      if (
        req.originalUrl ===
        '/terminal/webhook'
      ) {

        req.rawBody =
          buf.toString('utf8');
      }
    }
  })
);

// =========================
// ROUTES
// =========================
app.use('/payment', paymentRoutes);
app.use('/auth', authRoutes);
app.use('/terminal', terminalRoutes);
app.use('/tunnelmouth', tunnelmouthRoutes);
app.use('/admin-notifications', adminNotificationsRoutes);
app.use('/ai', aiRoutes);

// =========================
// HEALTH CHECK
// =========================
app.get('/', (req, res) => {
  res.send('API running 🚀');
});

// =========================
// APP VERSION CHECK
// =========================
app.get('/app/version', (req, res) => {
  res.json({
    ios: {
      minimumVersion: '1.0.0',
      latestVersion: '1.0.0',
      storeUrl: 'https://apps.apple.com/app/tunnelmouth/id6811357387'
    },

    android: {
      minimumVersion: '1.0.0',
      latestVersion: '1.0.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.tunnelmouth.customer'
    }
  });
});

app.post('/distance', distanceLimiter, async (req, res) => {
  const {pickupCoords, dropoffCoords} = req.body;
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${pickupCoords.lat},${pickupCoords.lng}&destinations=${dropoffCoords.lat},${dropoffCoords.lng}&key=${process.env.GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  res.json(data);  
}
);

// =========================
// GOOGLE PLACES AUTOCOMPLETE
// =========================
app.get(
  '/places/autocomplete',
  placesAutocompleteLimiter,
  async (req, res) => {
    try {
      const input = String(req.query.input || '').trim();

      if (input.length < 2 || input.length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid address search.'
        });
      }

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;

      if (!apiKey) {
        console.error('GOOGLE_PLACES_API_KEY is not configured.');

        return res.status(500).json({
          success: false,
          message: 'Address search is temporarily unavailable.'
        });
      }

      const url = new URL(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json'
      );

      url.searchParams.set('input', input);
      url.searchParams.set('components', 'country:ng');
      url.searchParams.set('language', 'en');
      url.searchParams.set('key', apiKey);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok || data.status === 'REQUEST_DENIED') {
        console.error('Google Places Autocomplete request failed:', {
          httpStatus: response.status,
          googleStatus: data.status,
          errorMessage: data.error_message
        });

        return res.status(502).json({
          success: false,
          message: 'Address search is temporarily unavailable.'
        });
      }

      return res.json({
        success: true,
        predictions: data.predictions || []
      });
    } catch (error) {
      console.error('Places autocomplete error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Unable to search for addresses.'
      });
    }
  }
);

// =========================
// GOOGLE PLACES DETAILS
// =========================
app.get(
  '/places/details',
  placesDetailsLimiter,
  async (req, res) => {
    try {
      const placeId = String(req.query.place_id || '').trim();

      if (
        !placeId ||
        placeId.length > 500 ||
        !/^[A-Za-z0-9_-]+$/.test(placeId)
      ) {
        return res.status(400).json({
          success: false,
          message: 'A valid place ID is required.'
        });
      }

      const apiKey = process.env.GOOGLE_PLACES_API_KEY;

      if (!apiKey) {
        console.error('GOOGLE_PLACES_API_KEY is not configured.');

        return res.status(500).json({
          success: false,
          message: 'Address details are temporarily unavailable.'
        });
      }

      const url = new URL(
        'https://maps.googleapis.com/maps/api/place/details/json'
      );

      url.searchParams.set('place_id', placeId);
      url.searchParams.set(
        'fields',
        'place_id,formatted_address,geometry,address_component,name'
      );
      url.searchParams.set('key', apiKey);

      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok || data.status !== 'OK') {
        console.error('Google Places Details request failed:', {
          httpStatus: response.status,
          googleStatus: data.status,
          errorMessage: data.error_message
        });

        return res.status(502).json({
          success: false,
          message: 'Unable to retrieve the selected address.'
        });
      }

      return res.json({
        success: true,
        result: data.result
      });
    } catch (error) {
      console.error('Places details error:', error.message);

      return res.status(500).json({
        success: false,
        message: 'Unable to retrieve address details.'
      });
    }
  }
);

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});