const express = require('express');
const axios = require('axios');

const { admin, db } = require('../firebaseAdmin');
const { firestore } = require('firebase-admin');

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
    
   
    const userRef = db.collection('users').doc(orderData.userId);
    const userSnap = await userRef.get();
    const walletBalance = Number(userSnap.data()?.walletBalance || 0);
    const walletUsed = Math.min(walletBalance, finalPrice);
    const amountExpected = finalPrice - walletUsed;
    const customerPays = Number(payment.amount) / 100;
    const platformFee = Math.floor(originalPrice * 0.05) + 500;
    const driverEarning = originalPrice - platformFee;
    const voucherCost = originalPrice - finalPrice;

    

    if (Math.abs(customerPays - amountExpected) > 0.01) {
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
      walletUsed,
      voucherDiscount: voucherCost,
      driverEarning,
      platformFee,
      paymentReference: reference,
      paymentStatus: 'paid',
      status: 'assigned',
      reviewSubmitted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // deduct customer wallet
    if (walletUsed> 0) {
      await userRef.update({
        walletBalance:
          admin.firestore.FieldValue.increment(-walletUsed)
      });
      await db.collection('wallet_transactions').add({
        userId: orderData.userId,
        type: 'debit',
        amount: walletUsed,
        description: 'Wallet payment',
        orderId: orderRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

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
        walletBalance: admin.firestore.FieldValue.increment(driverEarning),
        totalEarned: admin.firestore.FieldValue.increment(driverEarning),
        totalDeliveries: admin.firestore.FieldValue.increment(1)
        
      });

      await db.collection('wallet_transactions').add({

        userId: orderData.courierId,
        type: 'credit',
        amount: driverEarning,
        description: 'Delivery payment received',
        orderId: orderRef.id,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp()

      });

      

     
    }

    // =========================
    // SUCCESS RESPONSE
    // =========================
    return res.json({
      success: true,
      orderId: orderRef.id
    });

  } catch (err) {

    console.error("FULL ERROR");
    console.error(err);

    
    console.error("CODE:",err.code);
    console.error("MESSAGE:", err.message)
    console.error("DETAILS:", err.details)
    console.error("METADATA:", err.metadata?.getMap?.());

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
    
  }
});

// =========================
// WALLET PAYMENT (100% Wallet)
// =========================
router.post('/wallet-payment', async (req, res) => {

  try {

    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        success: false,
        message: 'Missing orderData'
      });
    }

    const originalPrice = Number(orderData.originalPrice || 0);

    let finalPrice = originalPrice;

    const userRef =
      db.collection('users').doc(orderData.userId);

    const userSnap =
      await userRef.get();

    const walletBalance =
      Number(userSnap.data()?.walletBalance || 0);

    // -------------------------
    // Apply voucher (if any)
    // -------------------------
    if (orderData.voucherCode) {

      const voucherSnap = await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .get();

      if (!voucherSnap.exists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid voucher'
        });
      }

      const voucher = voucherSnap.data();

      if (!voucher.active) {
        return res.status(400).json({
          success: false,
          message: 'Voucher is inactive'
        });
      }

      if (voucher.expiry.toDate() < new Date()) {
        return res.status(400).json({
          success: false,
          message: 'Voucher has expired'
        });
      }

      if (voucher.maxUses && voucher.timesUsed >= voucher.maxUses) {
        return res.status(400).json({
          success: false,
          message: 'Voucher usage limit reached'
        });
      }

      if (originalPrice < voucher.minimumOrder) {
        return res.status(400).json({
          success: false,
          message: 'Order does not meet minimum amount'
        });
      }

      const userSnap = await userRef.get();
      const user = userSnap.data();

      if (
        voucher.firstTimeOnly &&
        user?.hasPlacedFirstOrder
      ) {
        return res.status(400).json({
          success: false,
          message: 'Voucher only valid for first order'
        });
      }

      if (voucher.type === 'fixed') {

        finalPrice = Math.max(
          originalPrice - voucher.value,
          0
        );

      } else {

        let amountOff =
          originalPrice * (voucher.value / 100);

        if (
          voucher.maximumDiscount &&
          amountOff > voucher.maximumDiscount
        ) {
          amountOff = voucher.maximumDiscount;
        }

        finalPrice = Math.max(
          originalPrice - amountOff,
          0
        );

      }

    }

    // -------------------------
    // Customer wallet
    // -------------------------

    

    if (walletBalance < finalPrice) {

      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });

    }

    // Deduct wallet

    await userRef.update({

      walletBalance:
        admin.firestore.FieldValue.increment(
          -finalPrice
        ),

      hasPlacedFirstOrder: true

    });

    

    

    // -------------------------
    // Earnings
    // -------------------------

    const platformFee =
      Math.floor(originalPrice * 0.05) + 500;

    const driverEarning =
      originalPrice - platformFee;

    const voucherDiscount =
      originalPrice - finalPrice;

    // -------------------------
    // Create Order
    // -------------------------

    const orderRef =
      await db.collection('orders').add({

        ...orderData,

        originalPrice,

        amountPaid: 0,

        walletUsed: finalPrice,

        voucherDiscount,

        driverEarning,

        platformFee,

        paymentStatus: 'wallet',

        paymentReference: orderData.paymentReference || null,

        status: 'assigned',

        reviewSubmitted: false,

        createdAt:
          admin.firestore.FieldValue.serverTimestamp()

      });

    await db.collection('wallet_transactions').add({

      userId: orderData.userId,

      type: 'debit',

      amount: finalPrice,

      description: 'Wallet payment',

      orderId: orderRef.id,

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    // -------------------------
    // Driver Wallet
    // -------------------------

    const courierRef =
      db.collection('couriers_live').doc(orderData.courierId);

    await courierRef.update({

      walletBalance:
        admin.firestore.FieldValue.increment(
          driverEarning
        ),

      totalEarned:
        admin.firestore.FieldValue.increment(
          driverEarning
        ),

      totalDeliveries:
        admin.firestore.FieldValue.increment(1)

    });

    await db.collection('wallet_transactions').add({

      userId: orderData.courierId,

      type: 'credit',

      amount: driverEarning,

      description: 'Delivery payment received',

      orderId: orderRef.id,

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    // -------------------------
    // Voucher usage
    // -------------------------

    if (orderData.voucherCode) {

      await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .update({

          timesUsed:
            admin.firestore.FieldValue.increment(1)

        });

    }

    return res.json({

      success: true,

      orderId: orderRef.id

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
// DRIVER DECLINES ORDER
// =========================
router.post('/decline-order', async (req, res) => {

  try {

    const { orderId, courierId } = req.body;

    if (!orderId || !courierId) {
      return res.status(400).json({
        success: false,
        message: 'Missing orderId or courierId'
      });
    }

    const orderRef = db.collection('orders').doc(orderId);

    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order = orderSnap.data();

    const refundAmount =
      (order.amountPaid || 0) +
      (order.walletUsed || 0);

    // Prevent declining twice
    if (order.status === 'declined') {
      return res.status(400).json({
        success: false,
        message: 'Order already declined'
      });
    }

    // Update order status
    await orderRef.update({
      status: 'declined',
      declinedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Remove driver's earnings
    const courierRef = db
      .collection('couriers_live')
      .doc(courierId);
    

    await courierRef.update({

      walletBalance:
        admin.firestore.FieldValue.increment(
          -order.driverEarning
        ),

      totalEarned:
        admin.firestore.FieldValue.increment(
          -order.driverEarning
        ),

      totalDeliveries: admin.firestore.FieldValue.increment(-1)

      
        
    });

    const updatedCourier = await courierRef.get();

    if ((updatedCourier.data().totalDeliveries || 0) < 0) {
      await courierRef.update({
        totalDeliveries: 0
      });
    }

    

    await db.collection('wallet_transactions').add({

      userId: courierId,
      type: 'debit',
      amount: order.driverEarning,
      description: 'Delivery declined',
      orderId,
      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    // Refund customer to wallet
    const userRef = db
      .collection('users')
      .doc(order.userId);

    await userRef.set({

      walletBalance:
        admin.firestore.FieldValue.increment(
          refundAmount
        ),

      walletLastUpdated:
        admin.firestore.FieldValue.serverTimestamp()

    }, { merge: true });

    // Save wallet transaction
    await db.collection('wallet_transactions').add({

      userId: order.userId,

      type: 'refund',

      amount: refundAmount,

      description:
        'Driver declined your delivery. Amount refunded to wallet.',

      orderId,

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    return res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
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