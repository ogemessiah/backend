const express =
  require('express');

const axios =
  require('axios');

const router =
  express.Router();

const {
  db,
  admin
} = require('../firebaseAdmin');

router.post(
  '/verify-payment',
  async (req, res) => {

    try {

      const {

        reference,

        pickup,

        dropoff,

        courierId,

        courierName,

        packageSize,

        distanceKm,

        price,

        driverEarning,

        platformFee,

        customerId,

        customerEmail

      } = req.body;

      // ✅ VERIFY WITH PAYSTACK
      const response =
        await axios.get(

          `https://api.paystack.co/transaction/verify/${reference}`,

          {

            headers: {

              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
          }
        );

      const data =
        response.data.data;

      // ✅ CHECK PAYMENT SUCCESS
      if (
        data.status !==
        'success'
      ) {

        return res.status(400)
          .json({

            error:
              'Payment not successful'
          });
      }

      // ✅ CREATE ORDER
      const orderRef =
        await db
          .collection('orders')
          .add({

            customerId,

            customerEmail,

            pickup,

            dropoff,

            courierId,

            courierName,

            packageSize,

            distanceKm,

            price,

            driverEarning,

            platformFee,

            paymentReference:
              reference,

            paymentProvider:
              'paystack',

            paymentStatus:
              'paid',

            status:
              'pending',

            createdAt:
              admin.firestore
                .FieldValue
                .serverTimestamp()
          });

      // ✅ CREATE TRANSACTION
      await db
        .collection(
          'transactions'
        )
        .add({

          orderId:
            orderRef.id,

          customerId,

          courierId,

          amount:
            price,

          driverEarning,

          platformFee,

          paymentReference:
            reference,

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp()
        });

      res.json({

        success: true,

        orderId:
          orderRef.id
      });

    } catch (error) {

      console.log(error);

      res.status(500)
        .json({

          error:
            error.message
        });
    }
  }
);

module.exports =
  router;