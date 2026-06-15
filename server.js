const express = require('express');
const cors = require('cors');

const paymentRoutes = require('./routes/payment');

const app = express();

// =========================
// MIDDLEWARE
// =========================
app.use(cors());
app.use(express.json());

// =========================
// ROUTES
// =========================
app.use('/payment', paymentRoutes);

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
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});