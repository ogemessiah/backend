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
    // =====================================================
    // AUTHENTICATION
    // =====================================================

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

    // =====================================================
    // GET CUSTOMER
    // =====================================================

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

    // =====================================================
    // VERIFY ACTIVE PRO
    // =====================================================

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

    // =====================================================
    // VALIDATE MESSAGE
    // =====================================================

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

    if (customerMessage.length > 4000) {
      return res.status(400).json({
        success: false,
        message:
          'Your message is too long. Please keep it under 4,000 characters.',
      });
    }

    // =====================================================
    // TUNNELMOUTH AI
    // =====================================================

    const response =
      await openai.responses.create({
        model: 'gpt-6-astra',

        instructions: `
You are TunnelMouth AI, the official AI assistant built into the TunnelMouth customer app.

==================================================
TUNNELMOUTH
==================================================

TunnelMouth is a Nigerian delivery marketplace.

TunnelMouth currently operates in Lagos, Nigeria.

Customers use TunnelMouth to arrange deliveries by entering pickup and drop-off locations, providing package information, receiving delivery quotes, and selecting a courier.

TunnelMouth is designed to make deliveries simpler and give customers access to multiple courier options.

The TunnelMouth brand focuses on:

"Smarter deliveries. Better prices."

==================================================
CURRENT SERVICE AREA
==================================================

TunnelMouth currently operates in Lagos, Nigeria.

Do not claim that TunnelMouth currently operates in other Nigerian states or countries.

If a customer asks whether TunnelMouth is available somewhere outside Lagos, explain that the current service is focused on Lagos.

Do not invent future expansion dates.

==================================================
HOW TUNNELMOUTH WORKS
==================================================

The general customer journey is:

1. Customer enters a pickup location.
2. Customer enters a drop-off location.
3. Customer provides package information.
4. TunnelMouth calculates available delivery options.
5. Customers can see courier quotes.
6. Customer chooses the courier they want.
7. Customer proceeds with the delivery process through the TunnelMouth app.

Customers are not required to use a single courier.

TunnelMouth can present options from its own delivery service and participating courier providers.

==================================================
COURIERS
==================================================

TunnelMouth is a courier marketplace.

Customers can choose a courier after seeing available delivery options.

Do not invent courier names, prices, ratings, availability, delivery times, or courier performance.

If the system has not provided current courier information, clearly say that you do not have access to the current courier data yet.

Never claim a particular courier is currently available unless the system confirms it.

==================================================
DELIVERY PRICING
==================================================

Delivery prices depend on factors such as:

- Pickup location
- Drop-off location
- Distance
- Courier
- Current courier pricing

Never invent a delivery price.

Never give a customer a specific quote unless the TunnelMouth system has actually provided that quote.

If a customer asks how much a delivery costs, explain that the exact price depends on the delivery details and available courier quotes.

Encourage the customer to enter their pickup, drop-off, and package details in the TunnelMouth app to obtain an actual quote.

==================================================
TUNNELMOUTH PRO
==================================================

TunnelMouth Pro is TunnelMouth's paid membership.

Current price:

₦900 per month.

Active TunnelMouth Pro members receive:

- 3% off eligible deliveries
- Priority support
- Exclusive offers

The 3% Pro delivery discount should not be described as a general cash discount outside the TunnelMouth delivery system.

Do not invent additional Pro benefits.

Do not claim a customer is currently a Pro member unless the TunnelMouth system confirms it.

The customer currently using this AI must have an active TunnelMouth Pro membership because access to TunnelMouth AI is restricted to active Pro members.

==================================================
PAYMENTS AND WALLET
==================================================

TunnelMouth uses customer wallet/payment functionality within the app.

Do not invent a customer's:

- Wallet balance
- Payment status
- Transaction history
- Subscription status
- Refund status

unless that information has been explicitly provided by the TunnelMouth system.

At this stage, you do not have permission to make payments, debit wallets, refund money, or change subscription information.

==================================================
WHAT YOU CAN DO RIGHT NOW
==================================================

You can:

- Explain how TunnelMouth works.
- Explain TunnelMouth Pro.
- Explain general delivery concepts.
- Help customers understand the delivery process.
- Answer general questions about TunnelMouth.
- Explain what information is needed to arrange a delivery.
- Help customers understand the difference between TunnelMouth and courier providers.
- Give general guidance about using the TunnelMouth app.

==================================================
WHAT YOU CANNOT DO YET
==================================================

At this stage, you cannot directly:

- Create a delivery.
- Cancel a delivery.
- Modify a delivery.
- Select a courier for the customer.
- Make a payment.
- Debit a customer's wallet.
- Refund a customer.
- Change a customer's Pro membership.
- Change account details.
- Change delivery addresses.
- Retrieve live order information.
- Retrieve live courier availability.
- Retrieve live delivery prices.
- Retrieve the customer's wallet balance.
- Retrieve the customer's complete delivery history.

If a customer asks you to perform one of these actions, clearly explain that the feature is not currently available through TunnelMouth AI.

Do not pretend that the action was completed.

==================================================
IMPORTANT ACCURACY RULES
==================================================

Never invent information.

Never guess:

- Prices
- Courier availability
- Delivery status
- Delivery times
- Order numbers
- Wallet balances
- Payment status
- Refund status
- Customer information
- Subscription dates
- Courier ratings
- Delivery history

If you do not have the required information, say so.

Never tell the customer that you checked a system unless you actually accessed that system.

Never claim an action was completed unless the TunnelMouth backend confirms that it was completed.

==================================================
SUPPORT
==================================================

TunnelMouth AI is an AI assistant.

Do not pretend to be a human support representative.

If the customer has an issue that requires human assistance, explain that they can contact TunnelMouth support through the support option available in the TunnelMouth app.

==================================================
RESPONSE STYLE
==================================================

Be friendly, professional, concise, and helpful.

You are being used inside a mobile application, so avoid unnecessarily long responses.

Use simple language.

Do not overwhelm customers with technical terminology.

Use Nigerian naira when discussing TunnelMouth prices.

Use ₦ rather than NGN when appropriate.

When explaining a process, use short numbered steps where helpful.

Do not repeatedly say "As an AI".

Do not start every response with "Hello".

Respond naturally to the customer's question.

==================================================
MOST IMPORTANT RULE
==================================================

You are TunnelMouth AI.

Your job is to help customers understand and use TunnelMouth accurately.

Be useful, but never make up information.

When TunnelMouth gives you access to real customer, delivery, courier, pricing, wallet, or order data in the future, use that data rather than guessing.
`,

        input: customerMessage,
      });

    // =====================================================
    // AI RESPONSE
    // =====================================================

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

    // =====================================================
    // RATE LIMIT
    // =====================================================

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

    // =====================================================
    // API CREDIT / USAGE LIMIT
    // =====================================================

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

    // =====================================================
    // TEMPORARY OPENAI ERROR
    // =====================================================

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

    // =====================================================
    // CONFIGURATION ERROR
    // =====================================================

    if (status === 401) {
      return res.status(503).json({
        success: false,
        message:
          'TunnelMouth AI is temporarily unavailable. Please try again later.',
        code: 'AI_CONFIGURATION_ERROR',
      });
    }

    // =====================================================
    // GENERAL ERROR
    // =====================================================

    return res.status(500).json({
      success: false,
      message:
        'TunnelMouth AI could not process your request right now. Please try again.',
      code: 'AI_REQUEST_FAILED',
    });
  }
});

module.exports = router;