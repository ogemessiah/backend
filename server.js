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

app.get('/migrateCourierRatings', async (req, res) => {

  try {

    // Get every courier
    const couriersSnapshot = await db
      .collection('couriers_live')
      .get();

    let updated = 0;

    for (const courierDoc of couriersSnapshot.docs) {

      const courierId = courierDoc.id;

      // Get all reviews for this courier
      const reviewsSnapshot = await db
        .collection('courier_reviews')
        .where('courierId', '==', courierId)
        .get();

      const totalReviews = reviewsSnapshot.size;

      let totalRating = 0;

      reviewsSnapshot.forEach(reviewDoc => {
        totalRating += Number(reviewDoc.data().rating || 0);
      });

      const averageRating =
        totalReviews > 0
          ? Number((totalRating / totalReviews).toFixed(1))
          : 0;

      // Update courier document
      await db
        .collection('couriers_live')
        .doc(courierId)
        .update({

          averageRating,
          totalReviews

        });

      updated++;

    }

    return res.json({

      success: true,
      message: `Updated ${updated} couriers.`

    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      success: false,
      message: error.message

    });

  }

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

app.post('/updateCourierRating', async (req, res) => {

  try {

    const { courierId } = req.body;

    if (!courierId) {
      return res.status(400).json({
        success: false,
        message: 'Missing courierId'
      });
    }

    // Get all reviews for this courier
    const reviewsSnapshot = await db
      .collection('courier_reviews')
      .where('courierId', '==', courierId)
      .get();

    let totalReviews = reviewsSnapshot.size;
    let totalRating = 0;

    reviewsSnapshot.forEach(doc => {
      totalRating += Number(doc.data().rating || 0);
    });

    const averageRating =
      totalReviews > 0
        ? Number((totalRating / totalReviews).toFixed(1))
        : 0;

    // Update courier profile
    await db
      .collection('couriers_live')
      .doc(courierId)
      .update({

        averageRating,

        totalReviews

      });

    return res.json({
      success: true,
      averageRating,
      totalReviews
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
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