const express = require('express');
const OpenAI = require('openai');

const { admin, db } = require('../firebaseAdmin');

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

router.post('/chat', async (req, res) => {
  try {
    // --------------------------------------------------
    // 1. Verify Firebase authentication
    // --------------------------------------------------

    const authHeader =
      req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const idToken =
      authHeader
        .substring(7)
        .trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is missing.',
      });
    }

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
          'Invalid or expired authentication token.',
      });
    }

    const userId =
      decodedToken.uid;

    // --------------------------------------------------
    // 2. Get customer profile
    // --------------------------------------------------

    const userRef =
      db
        .collection('users')
        .doc(userId);

    const userSnapshot =
      await userRef.get();

    if (!userSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: 'Customer account not found.',
      });
    }

    const userData =
      userSnapshot.data() || {};

    // --------------------------------------------------
    // 3. Verify active TunnelMouth Pro
    // --------------------------------------------------

    const proActive =
      isActiveProUser(userData);

    if (!proActive) {
      return res.status(403).json({
        success: false,
        message:
          'TunnelMouth AI is available exclusively to active TunnelMouth Pro members.',
        code: 'PRO_REQUIRED',
      });
    }

    // --------------------------------------------------
    // 4. Validate customer message
    // --------------------------------------------------

    const {
      message,
    } = req.body;

    if (
      typeof message !== 'string' ||
      !message.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'A message is required.',
      });
    }

    const customerMessage =
      message.trim();

    // --------------------------------------------------
    // 5. Protect against unnecessarily large requests
    // --------------------------------------------------

    if (customerMessage.length > 4000) {
      return res.status(400).json({
        success: false,
        message:
          'Your message is too long. Please keep it under 4,000 characters.',
      });
    }

    // --------------------------------------------------
    // 6. Send request to OpenAI
    // --------------------------------------------------

    const response =
      await openai.responses.create({
        model: 'gpt-6-astra',

        instructions: `
You are TunnelMouth AI, the official AI assistant for TunnelMouth.

TunnelMouth is a Nigerian delivery marketplace currently focused on Lagos.

You are available exclusively to active TunnelMouth Pro customers.

Your job is to:
- Help customers understand TunnelMouth.
- Answer questions about deliveries, couriers, pricing, orders, payments, and TunnelMouth Pro.
- Give clear, concise and friendly answers.
- Never claim that you completed an action unless the TunnelMouth system actually confirms that action.
- Never invent delivery prices, courier availability, order statuses, payment statuses, or other account information.
- If you do not have access to information, clearly say so.
- Do not pretend to be a human support agent.
- Do not create, cancel, modify, or arrange deliveries yet.
- If a customer asks you to perform an action that you cannot currently perform, explain that the feature is not yet available through TunnelMouth AI.
- Keep responses reasonably concise and useful for a mobile app.
`,

        input: customerMessage,
      });

    const aiMessage =
      response.output_text?.trim();

    if (!aiMessage) {
      console.error(
        'OpenAI returned no output text.'
      );

      return res.status(502).json({
        success: false,
        message:
          'TunnelMouth AI could not generate a response right now. Please try again.',
        code: 'AI_EMPTY_RESPONSE',
      });
    }

    // --------------------------------------------------
    // 7. Return AI response
    // --------------------------------------------------

    return res.status(200).json({
      success: true,
      message: aiMessage,
      pro: true,
    });

  } catch (error) {
    console.error(
      'AI chat error:',
      error
    );

    // --------------------------------------------------
    // 8. Handle OpenAI rate/quota/credit limits
    // --------------------------------------------------

    const status =
      error?.status;

    const errorCode =
      error?.code ||
      error?.error?.code;

    const errorType =
      error?.type ||
      error?.error?.type;

    console.error(
      'OpenAI error details:',
      {
        status,
        errorCode,
        errorType,
      }
    );

    // Temporary rate limit / traffic limit
    if (
      status === 429 &&
      (
        errorCode === 'rate_limit_exceeded' ||
        errorCode === 'rate_limit_reached' ||
        errorCode === 'slow_down' ||
        errorType === 'rate_limit_error'
      )
    ) {
      return res.status(503).json({
        success: false,
        message:
          'TunnelMouth AI is temporarily busy. Please try again in a moment.',
        code: 'AI_RATE_LIMITED',
      });
    }

    // No available API credits / quota
    if (
      status === 429 &&
      (
        errorCode === 'credit_balance_exhausted' ||
        errorCode === 'insufficient_quota' ||
        errorCode === 'organization_usage_limit_exceeded' ||
        errorCode === 'project_spend_limit_exceeded' ||
        errorCode === 'organization_spend_limit_exceeded'
      )
    ) {
      return res.status(503).json({
        success: false,
        message:
          'TunnelMouth AI is temporarily unavailable. Please try again later.',
        code: 'AI_LIMIT_REACHED',
      });
    }

    // Temporary OpenAI service overload
    if (
      status === 503 ||
      errorCode === 'server_is_overloaded'
    ) {
      return res.status(503).json({
        success: false,
        message:
          'TunnelMouth AI is temporarily unavailable. Please try again shortly.',
        code: 'AI_TEMPORARILY_UNAVAILABLE',
      });
    }

    // Invalid/revoked API key
    if (
      status === 401
    ) {
      return res.status(503).json({
        success: false,
        message:
          'TunnelMouth AI is temporarily unavailable. Please try again later.',
        code: 'AI_CONFIGURATION_ERROR',
      });
    }

    // General AI failure
    return res.status(500).json({
      success: false,
      message:
        'TunnelMouth AI could not process your request right now. Please try again.',
      code: 'AI_REQUEST_FAILED',
    });
  }
});

module.exports = router;