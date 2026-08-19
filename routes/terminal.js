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
// TEMPORARY BROWSER QUOTE TEST
// =========================

router.get('/quote-test', async (req, res) => {

  try {

    console.log(
      'Starting T-Ship quote test...'
    );


    // =========================
    // TEST DELIVERY
    // LEKKI → IKEJA
    // =========================

    const quoteRequest = {

      pickup_address: {

        city:
          'Lekki',

        state:
          'Lagos',

        country:
          'NG'

      },

      delivery_address: {

        city:
          'Ikeja',

        state:
          'Lagos',

        country:
          'NG'

      },

      currency:
        'NGN',

      parcel: {

        description:
          'Phone',

        items: [

          {

            description:
              'Phone',

            name:
              'Phone',

            currency:
              'NGN',

            value:
              10000,

            weight:
              0.5,

            quantity:
              1

          }

        ],

        weight:
          0.5,

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
    // SEND TO T-SHIP
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


    // =========================
    // READ RESPONSE
    // =========================

    const data =
      await response.json();


    console.log(
      'T-Ship quote response:',
      data
    );


    // =========================
    // TERMINAL ERROR
    // =========================

    if (!response.ok) {

      return res.status(
        response.status
      ).json({

        success:
          false,

        message:
          data.message ||
          'T-Ship quote request failed.',

        terminalResponse:
          data

      });

    }


    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success:
        true,

      message:
        'T-Ship quote request completed successfully.',

      testRoute:
        'Lekki → Ikeja',

      testWeight:
        '0.5 kg',

      testItem:
        'Phone',

      terminalResponse:
        data

    });


  } catch (error) {

    console.error(
      'T-Ship quote test error:',
      error
    );


    return res.status(
      500
    ).json({

      success:
        false,

      message:
        'Unable to connect to T-Ship quote service.',

      error:
        error.message

    });

  }

});


// =========================
// EXPORT ROUTER
// =========================

module.exports = router;