const express = require('express');
const router = express.Router();

const {
  sendPushNotification
} = require('../utils/pushNotifications');

const { admin } = require('../firebaseAdmin');

// ========================================
// SEND ADMIN NOTIFICATION
// ========================================
router.post('/send', async (req, res) => {

  try {

    const {
      type,
      title,
      body,
      data = {}
    } = req.body;

    if (!type || !title || !body) {
      return res.status(400).json({
        error: 'type, title and body are required'
      });
    }

    // Get all admin accounts
    const snapshot =
      await admin
        .firestore()
        .collection('admin')
        .get();

    if (snapshot.empty) {
      return res.json({
        success: true,
        sent: 0
      });
    }

    let sent = 0;

    for (const doc of snapshot.docs) {

      const adminData = doc.data();

      if (!adminData.pushToken) {
        continue;
      }

      await sendPushNotification({
        expoPushToken: adminData.pushToken,
        title,
        body,
        data: {
          type,
          ...data
        }
      });

      sent++;
    }

    return res.json({
      success: true,
      sent
    });

  } catch (error) {

    console.error(
      'Admin notification error:',
      error
    );

    return res.status(500).json({
      error: 'Failed to send admin notification'
    });
  }
});

// ========================================
// SEND DRIVER NOTIFICATION
// ========================================
router.post('/send-driver', async (req, res) => {

  try {

    const {
      expoPushToken,
      title,
      body,
      data = {}
    } = req.body;

    if (!expoPushToken || !title || !body) {
      return res.status(400).json({
        error:
          'expoPushToken, title and body are required'
      });
    }


    await sendPushNotification({
      expoPushToken,
      title,
      body,
      data
    });


    return res.json({
      success: true
    });

  } catch (error) {

    console.error(
      'Driver notification error:',
      error
    );

    return res.status(500).json({
      error:
        'Failed to send driver notification'
    });

  }

});

module.exports = router;