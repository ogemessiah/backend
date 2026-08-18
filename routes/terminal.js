const express = require('express');

const router = express.Router();

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
      message: 'Terminal API connected successfully.'
    });

  } catch (error) {

    console.error(
      'Terminal API connection error:',
      error
    );

    return res.status(500).json({
      success: false,
      terminalConnected: false,
      message: 'Unable to connect to Terminal API.'
    });
  }
});

module.exports = router;