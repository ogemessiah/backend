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
    const originalPrice = Number(orderData.originalPrice || 0);

    let finalPrice = originalPrice;

    if (orderData.voucherCode) {

      const voucherSnap = await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .get();

      if (!voucherSnap.exists) {
        return res.status(400).json({
          success: false,
          error: 'Invalid voucher'
        });
      }

      const voucher = voucherSnap.data();

      if (!voucher.active) {
        return res.status(400).json({
          success: false,
          error: 'Voucher is inactive'
        });
      }

      if (voucher.expiry.toDate() < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Voucher has expired'
        });
      }

      if (voucher.maxUses && voucher.timesUsed >= voucher.maxUses) {
        return res.status(400).json({
          success: false,
          error: 'Voucher usage limit reached'
        });
      }

      if (originalPrice < voucher.minimumOrder) {
        return res.status(400).json({
          success: false,
          error: 'Order does not meet minimum amount'
        });
      }

      // First order check
      const userSnap = await db
        .collection('users')
        .doc(orderData.userId)
        .get();

      const user = userSnap.data();

      if (
        voucher.firstTimeOnly &&
        user?.hasPlacedFirstOrder
      ) {
        return res.status(400).json({
          success: false,
          error: 'Voucher only valid for first order'
        });
      }

      // Calculate discount
      if (voucher.type === 'fixed') {

        finalPrice = Math.max(
          originalPrice - voucher.value,
          0
        );

      } else {

        let amountOff = originalPrice * (voucher.value / 100);

        if (
          voucher.maximumDiscount &&
          amountOff > voucher.maximumDiscount
        ) {
          amountOff = voucher.maximumDiscount;
        }
        finalPrice = Math.max(originalPrice - amountOff, 0);

      }

    }
    
    const customerPays = Number(payment.amount) / 100;

    const platformFee = Math.floor(originalPrice * 0.05) + 500;
    const driverEarning = originalPrice - platformFee;

    const voucherCost = originalPrice - finalPrice;

    

    if (Math.abs(customerPays - finalPrice) > 0.01) {
      return res.status(400).json({
        success: false,
        error: 'Payment amount mismatch'
      });
    }

    // =========================
    // CREATE ORDER
    // =========================
    const orderRef = await db.collection('orders').add({
      ...orderData,
      originalPrice,
      amountPaid: customerPays,
      voucherDiscount: voucherCost,
      driverEarning,
      platformFee,
      paymentReference: reference,
      paymentStatus: 'paid',
      status: 'assigned',
      reviewSubmitted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (orderData.userId) {
      await db
        .collection('users')
        .doc(orderData.userId)
        .set(
          {
            hasPlacedFirstOrder: true
          },
          {
            merge: true
          }
        );
    }

    if (orderData.voucherCode) {
      await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .update({
          timesUsed:
            admin.firestore.FieldValue.increment(1)
        });
    }

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
    console.error("========== FULL ERROR ==========");
    console.error(error);
    console.error("Code:", error.code);
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);

    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }

    return res.status(500).json({
      success: false,
      error: error.message
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



module.exports = router;