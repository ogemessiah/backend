const express =
  require('express');

const axios =
  require('axios');

const {
  admin,
  db
} = require('../firebaseAdmin');

const router =
  express.Router();


router.get('/', (req, res) => {
  res.json({
    status: 'API is running',
    service: 'payment routes active'
  });
});


// =========================
// VERIFY PAYMENT
// =========================

router.post(
  '/verify-payment',

  async (req, res) => {

    try {

      const {
        reference,
        orderData
      } = req.body;

      // =========================
      // VERIFY WITH PAYSTACK
      // =========================

      const verify =
        await axios.get(

          `https://api.paystack.co/transaction/verify/${reference}`,

          {
            headers: {
              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
          }
        );

      const payment =
        verify.data.data;

      // PAYMENT FAILED
      if (
        payment.status !==
        'success'
      ) {

        return res.status(400).json({

          success: false,

          error:
            'Payment not successful'
        });
      }

      // =========================
      // PRICE
      // =========================

      const basePrice =
        Number(orderData.price);

      // 5% + 500
      const platformFee =

        Math.floor(
          basePrice * 0.05
        ) + 500;

      const driverEarning =

        basePrice -
        platformFee;

      // =========================
      // CREATE ORDER
      // =========================

      const orderRef =
        await db.collection('orders').add({

          ...orderData,

          driverEarning,

          platformFee,

          paymentReference:
            reference,

          paymentStatus:
            'paid',

          status:
            'assigned',

          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        });

      // =========================
      // UPDATE DRIVER
      // =========================

      const courierRef =
        db.collection(
          'couriers_live'
        ).doc(
          orderData.courierId
        );

      const courierSnap =
        await courierRef.get();

      if (courierSnap.exists) {

        const courierData =
          courierSnap.data();

        await courierRef.update({

          walletBalance:

            Number(
              courierData.walletBalance || 0
            ) +

            driverEarning,

          totalEarned:

            Number(
              courierData.totalEarned || 0
            ) +

            driverEarning,

          totalDeliveries:

            Number(
              courierData.totalDeliveries || 0
            ) + 1
        });
      }

      // =========================
      // SUCCESS
      // =========================

      return res.json({

        success: true,

        orderId:
          orderRef.id
      });

    } catch (error) {

      console.log(error);

      return res.status(500).json({

        success: false,

        error:
          error.message
      });
    }
  }
);

module.exports =
  router;