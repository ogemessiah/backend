const express = require('express');
const axios = require('axios');

const { admin, db } = require('../firebaseAdmin');

const router = express.Router();


// =========================
// HEALTH CHECK
// =========================
router.get('/', (req, res) => {
  res.json({
    status: 'API is running',
    service: 'payment routes active'
  });
});


// =========================
// VERIFY PAYMENT (PAYSTACK)
// =========================
router.post('/verify-payment', async (req, res) => {
  try {
    const { reference, orderData } = req.body;

    // =========================
    // VALIDATION
    // =========================
    if (!reference || !orderData) {
      return res.status(400).json({
        success: false,
        error: 'Missing reference or orderData'
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Server misconfigured: missing PAYSTACK_SECRET_KEY'
      });
    }

    // =========================
    // VERIFY PAYMENT WITH PAYSTACK
    // =========================
    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        },
        timeout: 15000
      }
    );

    const payment = verify?.data?.data;

    if (!payment || payment.status !== 'success') {
      return res.status(400).json({
        success: false,
        error: 'Payment not successful'
      });
    }

    // =========================
    // CALCULATE FEES
    // =========================
    const basePrice = Number(orderData.price || 0);

    if (!basePrice) {
      return res.status(400).json({
        success: false,
        error: 'Invalid price in orderData'
      });
    }

    const platformFee = Math.floor(basePrice * 0.05) + 500;
    const driverEarning = basePrice - platformFee;

    // =========================
    // CREATE ORDER
    // =========================
    const orderRef = await db.collection('orders').add({
      ...orderData,
      driverEarning,
      platformFee,
      paymentReference: reference,
      paymentStatus: 'paid',
      status: 'assigned',
      reviewSubmitted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // =========================
    // UPDATE DRIVER WALLET
    // =========================
    const courierRef = db.collection('couriers_live').doc(orderData.courierId);

    const courierSnap = await courierRef.get();

    if (courierSnap.exists) {
      const courierData = courierSnap.data();

      await courierRef.update({
        walletBalance: Number(courierData.walletBalance || 0) + driverEarning,
        totalEarned: Number(courierData.totalEarned || 0) + driverEarning,
        totalDeliveries: Number(courierData.totalDeliveries || 0) + 1
      });
    }

    // =========================
    // SUCCESS RESPONSE
    // =========================
    return res.json({
      success: true,
      orderId: orderRef.id
    });

  } catch (error) {
    console.log('PAYMENT ERROR:', error?.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: 'Payment verification failed',
      details: error.message
    });
  }
});

router.post('/updateCourierRating', async (req, res) => {

  try {

    const { courierId } = req.body;

    if (!courierId) {
      return res.status(400).json({
        success: false,
        message: 'Missing courierId'
      });
    }

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

router.get('/migrateCourierRatings', async (req, res) => {

  try {

    const couriers = await db
      .collection('couriers_live')
      .get();

    for (const courier of couriers.docs) {

      const courierId = courier.id;

      const reviews = await db
        .collection('courier_reviews')
        .where('courierId', '==', courierId)
        .get();

      let totalReviews = reviews.size;
      let totalRating = 0;

      reviews.forEach(doc => {
        totalRating += Number(doc.data().rating || 0);
      });

      const averageRating =
        totalReviews > 0
          ? Number((totalRating / totalReviews).toFixed(1))
          : 0;

      await db
        .collection('couriers_live')
        .doc(courierId)
        .update({
          averageRating,
          totalReviews
        });
    }

    res.json({
      success: true,
      message: 'Migration complete'
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message
    });

  }

});

module.exports = router;