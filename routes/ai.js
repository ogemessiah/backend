const express = require('express');

const { admin, db } = require('../firebaseAdmin');

const router = express.Router();


// =====================================================
// CHECK ACTIVE TUNNELMOUTH PRO SUBSCRIPTION
// =====================================================

const isActiveProUser = (userData) => {

  if (
    userData?.proActive !== true ||
    !userData?.proStartedAt ||
    !userData?.proExpiresAt
  ) {
    return false;
  }

  const startedAt =
    typeof userData.proStartedAt.toDate === 'function'
      ? userData.proStartedAt.toDate()
      : new Date(userData.proStartedAt);

  const expiresAt =
    typeof userData.proExpiresAt.toDate === 'function'
      ? userData.proExpiresAt.toDate()
      : new Date(userData.proExpiresAt);

  const now = Date.now();

  if (
    isNaN(startedAt.getTime()) ||
    isNaN(expiresAt.getTime())
  ) {
    return false;
  }

  return (
    startedAt.getTime() <= now &&
    expiresAt.getTime() > now
  );
};


// =====================================================
// AI CHAT
// =====================================================

router.post('/chat', async (req, res) => {

  try {

    // =================================================
    // 1. VERIFY FIREBASE AUTHENTICATION
    // =================================================

    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {

      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });

    }

    const idToken =
      authHeader
        .substring(7)
        .trim();

    if (!idToken) {

      return res.status(401).json({
        success: false,
        message: 'Authentication token is missing.'
      });

    }


    // =================================================
    // 2. VERIFY FIREBASE ID TOKEN
    // =================================================

    let decodedToken;

    try {

      decodedToken =
        await admin
          .auth()
          .verifyIdToken(idToken);

    } catch (error) {

      console.error(
        'AI Firebase token verification error:',
        error
      );

      return res.status(401).json({
        success: false,
        message:
          'Invalid or expired authentication token.'
      });

    }


    // =================================================
    // 3. GET CUSTOMER UID
    // =================================================

    const userId =
      decodedToken.uid;


    // =================================================
    // 4. GET CUSTOMER PROFILE
    // =================================================

    const userRef =
      db
        .collection('users')
        .doc(userId);

    const userSnapshot =
      await userRef.get();


    if (!userSnapshot.exists) {

      return res.status(404).json({
        success: false,
        message: 'Customer account not found.'
      });

    }


    const userData =
      userSnapshot.data() || {};


    // =================================================
    // 5. VERIFY ACTIVE PRO
    // =================================================

    const proActive =
      isActiveProUser(userData);


    if (!proActive) {

      return res.status(403).json({
        success: false,
        message:
          'TunnelMouth AI is available exclusively to active TunnelMouth Pro members.',
        code: 'PRO_REQUIRED'
      });

    }


    // =================================================
    // 6. READ MESSAGE
    // =================================================

    const {
      message
    } = req.body;


    if (
      typeof message !== 'string' ||
      !message.trim()
    ) {

      return res.status(400).json({
        success: false,
        message: 'A message is required.'
      });

    }


    // =================================================
    // 7. TEMPORARY RESPONSE
    // =================================================
    //
    // We are deliberately NOT connecting OpenAI yet.
    //
    // This allows us to verify that:
    //
    // Firebase authentication
    // +
    // Pro verification
    // +
    // AI endpoint
    //
    // are all working correctly first.
    //

    return res.status(200).json({

      success: true,

      message:
        'AI access verified successfully.',

      userId,

      pro: true,

      receivedMessage:
        message.trim()

    });


  } catch (error) {

    console.error(
      'AI chat error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to process AI request.'
    });

  }

});


module.exports = router;