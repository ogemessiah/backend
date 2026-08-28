const express = require('express');
const cors = require('cors');

const paymentRoutes = require('./routes/payment');

const authRoutes = require('./routes/auth');

const terminalRoutes = require('./routes/terminal');

const tunnelmouthRoutes = require('./routes/tunnelmouth');

const app = express();

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

// =========================
// HEALTH CHECK
// =========================
app.get('/', (req, res) => {
  res.send('API running 🚀');
});



app.post('/distance', async (req, res) => {
  const {pickupCoords, dropoffCoords} = req.body;
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${pickupCoords.lat},${pickupCoords.lng}&destinations=${dropoffCoords.lat},${dropoffCoords.lng}&key=${process.env.GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  res.json(data);  
}
);

// =========================
// TEST PUSH NOTIFICATION
// =========================
app.post('/test-push', async (req, res) => {

  try {

    const { expoPushToken } = req.body;

    if (!expoPushToken) {
      return res.status(400).json({
        error: 'expoPushToken is required'
      });
    }

    const response = await fetch(
      'https://exp.host/--/api/v2/push/send',
      {
        method: 'POST',

        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          to: expoPushToken,
          sound: 'default',
          title: 'TunnelMouth 🚚',
          body: 'Push notifications are working!',
          data: {
            test: true
          }
        }),
      }
    );

    const result = await response.json();

    console.log('EXPO PUSH RESPONSE:', result);

    res.json(result);

  } catch (error) {

    console.error(
      'PUSH NOTIFICATION ERROR:',
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});