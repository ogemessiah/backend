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

          'Content-Type': 'application/json'
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


    // =========================
    // RETURN ONLY USEFUL CARRIER DATA
    // =========================

    const carriers =
      data.data?.carriers || [];


    return res.json({

      success: true,

      count: carriers.length,

      carriers: carriers.map((carrier) => ({

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


module.exports = router;