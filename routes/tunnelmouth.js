const express = require('express');

const { admin, db } = require('../firebaseAdmin');

const router = express.Router();


// =========================
// TUNNELMOUTH COURIER QUOTE
// POST /tunnelmouth/quote
// =========================

router.post('/quote', async (req, res) => {

  try {

    const {
      distanceKm,
      packageSize
    } = req.body;


    // =========================
    // VALIDATE REQUEST
    // =========================

    if (
      distanceKm === undefined ||
      distanceKm === null ||
      !packageSize
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Missing distanceKm or packageSize'

      });

    }


    const distance =
      Number(distanceKm);


    if (
      !Number.isFinite(distance) ||
      distance < 0
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Invalid distance'

      });

    }


    if (
      packageSize !== 'small' &&
      packageSize !== 'large'
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Invalid package size'

      });

    }


    // =========================
    // GET AVAILABLE TUNNELMOUTH
    // COURIERS
    // =========================

    const snapshot =
      await db
        .collection('couriers_live')
        .where(
          'available',
          '==',
          true
        )
        .get();


    const couriers = [];


    // =========================
    // BUILD QUOTES
    // =========================

    snapshot.forEach((doc) => {

      const courier =
        doc.data();


      let price = 0;


      // =========================
      // SMALL PACKAGE
      // =========================

      if (
        packageSize === 'small'
      ) {

        if (
          distance <= 10
        ) {

          price =
            Number(
              courier.small0to10km
            ) || 0;

        } else if (
          distance <= 20
        ) {

          price =
            Number(
              courier.small10to20km
            ) || 0;

        } else if (
          distance <= 30
        ) {

          price =
            Number(
              courier.small20to30km
            ) || 0;

        } else {

          price =
            Number(
              courier.smallAbove30km
            ) || 0;

        }

      }


      // =========================
      // LARGE PACKAGE
      // =========================

      else {

        if (
          distance <= 10
        ) {

          price =
            Number(
              courier.large0to10km
            ) || 0;

        } else if (
          distance <= 20
        ) {

          price =
            Number(
              courier.large10to20km
            ) || 0;

        } else if (
          distance <= 30
        ) {

          price =
            Number(
              courier.large20to30km
            ) || 0;

        } else {

          price =
            Number(
              courier.largeAbove30km
            ) || 0;

        }

      }


      // =========================
      // IGNORE COURIERS WITHOUT
      // A VALID PRICE
      // =========================

      if (
        price <= 0
      ) {

        return;

      }


      // =========================
      // ADD COURIER QUOTE
      // =========================

      couriers.push({

        id:
          doc.id,

        name:
          courier.name ||
          'TunnelMouth Courier',

        photoURL:
          courier.photoURL ||
          courier.profileImage ||
          null,

        averageRating:
          Number(
            courier.averageRating || 0
          ),

        totalReviews:
          Number(
            courier.totalReviews || 0
          ),

        totalDeliveries:
          Number(
            courier.totalDeliveries || 0
          ),

        finalPrice:
          price,

        deliveryTime:
          'Within 1 business day',

        courierType:
          'tunnelmouth'

      });

    });


    // =========================
    // SORT CHEAPEST FIRST
    // =========================

    couriers.sort(
      (a, b) =>
        a.finalPrice -
        b.finalPrice
    );


    // =========================
    // RESPONSE
    // =========================

    return res.json({

      success:
        true,

      count:
        couriers.length,

      couriers:
        couriers

    });


  } catch (error) {

    console.error(
      'TunnelMouth courier quote error:',
      error
    );


    return res.status(500).json({

      success:
        false,

      message:
        'Unable to retrieve TunnelMouth courier quotes'

    });

  }

});


module.exports = router;