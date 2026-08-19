const express = require('express');

const router = express.Router();


// =========================
// TEST TERMINAL CONNECTION
// =========================

router.get('/test', async (req, res) => {
  try {

    const response = await fetch(
      'https://api.terminal.africa/v1/carriers',
      {
        method: 'GET',

        headers: {
          'Authorization':
            `Bearer ${process.env.TERMINAL_SECRET_KEY}`,

          'Content-Type':
            'application/json'
        }
      }
    );

    const data = await response.json();

    console.log(
      'Terminal API response:',
      data
    );

    if (!response.ok) {

      return res.status(response.status).json({
        success: false,
        terminalConnected: false,
        message:
          data.message ||
          'Terminal API authentication failed.'
      });

    }

    return res.json({
      success: true,
      terminalConnected: true,
      message:
        'Terminal API connected successfully.'
    });

  } catch (error) {

    console.error(
      'Terminal API connection error:',
      error
    );

    return res.status(500).json({
      success: false,
      terminalConnected: false,
      message:
        'Unable to connect to Terminal API.'
    });

  }
});


// =========================
// GET AVAILABLE CARRIERS
// =========================

router.get('/carriers', async (req, res) => {

  try {

    const response = await fetch(
      'https://api.terminal.africa/v1/carriers?active=true&perPage=100&page=1',
      {
        method: 'GET',

        headers: {
          'Authorization':
            `Bearer ${process.env.TERMINAL_SECRET_KEY}`,

          'Content-Type':
            'application/json'
        }
      }
    );

    const data = await response.json();

    console.log(
      'Terminal carriers response:',
      data
    );

    if (!response.ok || data.status !== true) {

      return res.status(
        response.status || 400
      ).json({
        success: false,
        message:
          data.message ||
          'Unable to retrieve Terminal carriers.'
      });

    }

    const carriers =
      data.data?.carriers || [];

    return res.json({

      success: true,

      count:
        carriers.length,

      carriers:
        carriers.map((carrier) => ({

          name:
            carrier.name,

          carrierId:
            carrier.carrier_id,

          slug:
            carrier.slug,

          active:
            carrier.active,

          domestic:
            carrier.domestic,

          regional:
            carrier.regional,

          international:
            carrier.international,

          availableCountries:
            carrier.available_countries,

          logo:
            carrier.logo || null,

          requiresInvoice:
            carrier.requires_invoice,

          requiresWaybill:
            carrier.requires_waybill

        }))

    });

  } catch (error) {

    console.error(
      'Terminal carriers error:',
      error
    );

    return res.status(500).json({

      success: false,

      message:
        'Unable to retrieve Terminal carriers.'

    });

  }

});


// =========================
// PRODUCTION QUOTE ENDPOINT
// POST /terminal/quote
// =========================

router.post('/quote', async (req, res) => {

  try {

    const {
      pickup,
      delivery,
      weight,
      itemName,
      itemValue
    } = req.body;


    // =========================
    // VALIDATE REQUEST
    // =========================

    if (!pickup || !delivery) {

      return res.status(400).json({

        success: false,

        message:
          'Pickup and delivery addresses are required.'

      });

    }


    if (
      !pickup.city ||
      !pickup.state ||
      !pickup.country
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Pickup address must include city, state and country.'

      });

    }


    if (
      !delivery.city ||
      !delivery.state ||
      !delivery.country
    ) {

      return res.status(400).json({

        success: false,

        message:
          'Delivery address must include city, state and country.'

      });

    }


    const parcelWeight =
      Number(weight);


    if (
      !Number.isFinite(parcelWeight) ||
      parcelWeight <= 0
    ) {

      return res.status(400).json({

        success: false,

        message:
          'A valid parcel weight is required.'

      });

    }


    // =========================
    // DEFAULT VALUES
    // =========================

    const name =
      itemName ||
      'Package';

    const value =
      Number(itemValue) > 0
        ? Number(itemValue)
        : 10000;


    // =========================
    // T-SHIP REQUEST
    // =========================

    const quoteRequest = {

      pickup_address: {

        city:
          pickup.city,

        state:
          pickup.state,

        country:
          pickup.country,

        zip:
          pickup.zip ||
          ''

      },

      delivery_address: {

        city:
          delivery.city,

        state:
          delivery.state,

        country:
          delivery.country,

        zip:
          delivery.zip ||
          ''

      },

      currency:
        'NGN',

      parcel: {

        description:
          name,

        items: [

          {

            description:
              name,

            name:
              name,

            currency:
              'NGN',

            value:
              value,

            weight:
              parcelWeight,

            quantity:
              1

          }

        ],

        weight:
          parcelWeight,

        weight_unit:
          'kg'

      },

      persist_data:
        false

    };


    console.log(
      'T-Ship quote request:',
      quoteRequest
    );


    // =========================
    // CALL T-SHIP
    // =========================

    const response = await fetch(
      'https://api.terminal.africa/v1/rates/shipment/quotes',
      {

        method:
          'POST',

        headers: {

          'Authorization':
            `Bearer ${process.env.TERMINAL_SECRET_KEY}`,

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify(
            quoteRequest
          )

      }
    );


    const data =
      await response.json();


    console.log(
      'T-Ship quote response:',
      data
    );


    // =========================
    // T-SHIP ERROR
    // =========================

    if (
      !response.ok ||
      data.status !== true
    ) {

      return res.status(
        response.status || 400
      ).json({

        success:
          false,

        message:
          data.message ||
          'Unable to retrieve delivery quotes.'

      });

    }


    // =========================
    // EXTRACT RATES
    // =========================

    const rates =
      Array.isArray(data.data)
        ? data.data
        : [];


    // =========================
    // ADD TUNNELMOUTH FEE
    //
    // 5% + ₦500
    // =========================

    const quotes =
      rates

        .filter((rate) => {

          return (
            rate.pickup_available !== false &&
            Number.isFinite(
              Number(rate.amount)
            )
          );

        })

        .map((rate) => {

          const basePrice =
            Number(rate.amount);

          const platformFee =
            basePrice * 0.05;

          const fixedFee =
            500;

          const tunnelMouthPrice =
            basePrice +
            platformFee +
            fixedFee;


          return {

            courierName:
              rate.carrier_name,

            courierLogo:
              rate.carrier_logo ||
              null,

            courierSlug:
              rate.carrier_slug ||
              null,

            carrierId:
              rate.carrier_id ||
              rate.carrier_reference ||
              null,

            rateId:
              rate.id ||
              null,

            basePrice:
              Number(
                basePrice.toFixed(2)
              ),

            platformFee:
              Number(
                platformFee.toFixed(2)
              ),

            fixedFee:
              fixedFee,

            price:
              Number(
                tunnelMouthPrice.toFixed(2)
              ),

            currency:
              rate.currency ||
              'NGN',

            deliveryTime:
              rate.delivery_time ||
              null,

            deliveryTimeline:
              rate.delivery_timeline ||
              null,

            pickupTime:
              rate.pickup_time ||
              null,

            pickupTimeline:
              rate.pickup_timeline ||
              null,

            deliveryDate:
              rate.delivery_date ||
              null,

            pickupDate:
              rate.pickup_date ||
              null,

            recommended:
              rate.metadata?.recommended === true ||
              rate.recommended === true,

            dropoffRequired:
              rate.dropoff_required === true,

            dropoffAvailable:
              rate.dropoff_available !== false

          };

        });


    // =========================
    // SORT CHEAPEST FIRST
    // =========================

    quotes.sort(
      (a, b) =>
        a.price - b.price
    );


    // =========================
    // RESPONSE
    // =========================

    return res.json({

      success:
        true,

      count:
        quotes.length,

      pickup:
        pickup,

      delivery:
        delivery,

      weight:
        parcelWeight,

      itemName:
        name,

      quotes:
        quotes

    });


  } catch (error) {

    console.error(
      'T-Ship quote error:',
      error
    );

    return res.status(500).json({

      success:
        false,

      message:
        'Unable to retrieve delivery quotes.',

      error:
        error.message

    });

  }

});


// =========================
// EXPORT
// =========================

module.exports = router;