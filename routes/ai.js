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

/*
 * =========================================================
 * CUSTOMER ACCOUNT TOOL
 * =========================================================
 *
 * This function can ONLY access the account belonging to
 * the authenticated Firebase user.
 */
const getCustomerAccount = async (userId) => {
  const userRef =
    db
      .collection('users')
      .doc(userId);

  const snapshot =
    await userRef.get();

  if (!snapshot.exists) {
    throw new Error(
      'Customer account not found.'
    );
  }

  const userData =
    snapshot.data() || {};

  const proActive =
    isActiveProUser(userData);

  let proExpiresAt = null;

  if (userData.proExpiresAt) {
    const expiryDate =
      typeof userData.proExpiresAt.toDate === 'function'
        ? userData.proExpiresAt.toDate()
        : new Date(userData.proExpiresAt);

    if (!isNaN(expiryDate.getTime())) {
      proExpiresAt =
        expiryDate.toISOString();
    }
  }

  const walletBalance =
    typeof userData.walletBalance === 'number'
      ? userData.walletBalance
      : 0;

  return {
    proActive,
    proExpiresAt,
    walletBalance,
    currency: 'NGN',
  };
};

/*
 * =========================================================
 * AI ROUTE
 * =========================================================
 */

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
        message:
          'Authentication token is missing.',
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

    /*
     * IMPORTANT:
     *
     * The customer UID comes ONLY from the verified
     * Firebase token.
     *
     * We never accept userId from the chat request.
     */
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
        message:
          'Customer account not found.',
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
        message:
          'A message is required.',
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
    // ACCOUNT TOOL
    // =====================================================

    const tools = [
      {
        type: 'function',
        name: 'get_customer_account',
        description:
          'Retrieve the authenticated TunnelMouth customer account information needed to answer questions about TunnelMouth Pro status, Pro expiry date, and wallet balance. This function only returns information for the currently authenticated customer.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        strict: true,
      },
    ];

    // =====================================================
    // FIRST AI REQUEST
    // =====================================================

    let response =
      await openai.responses.create({
        model: 'gpt-6-astra',

        instructions: `
You are TunnelMouth AI, the official AI assistant built into the TunnelMouth customer app.

==================================================
TUNNELMOUTH
==================================================

TunnelMouth is a Nigerian delivery marketplace currently focused on Lagos.

Customers use TunnelMouth to arrange deliveries by entering pickup and drop-off locations, providing package information, receiving delivery quotes, and selecting a courier.

TunnelMouth is designed to make deliveries simpler and give customers access to multiple courier options.

==================================================
TUNNELMOUTH PRO
==================================================

TunnelMouth Pro costs ₦900 per month.

Active TunnelMouth Pro members receive:

- 3% off eligible deliveries
- Priority support
- Exclusive offers

The customer using this AI must have an active TunnelMouth Pro membership.

==================================================
LIVE CUSTOMER INFORMATION
==================================================

You have access to a secure tool called get_customer_account.

Use this tool whenever the customer asks about information specific to their own account, including:

- Whether their Pro membership is active
- When their Pro membership expires
- Their wallet balance
- Their current account information covered by the tool

Do NOT guess account information.

Do NOT use information from another customer.

Do NOT ask the customer for their user ID.

The backend automatically identifies the authenticated customer.

==================================================
WALLET
==================================================

Wallet balances are displayed in Nigerian naira.

If the tool returns a wallet balance, report it using ₦.

Do not invent or estimate the balance.

If the customer asks about transactions, payments, refunds, or payment history, explain that those details are not currently available through TunnelMouth AI unless a tool explicitly provides them.

==================================================
PRO MEMBERSHIP
==================================================

If the customer asks whether their Pro membership is active, use get_customer_account.

If Pro is active, tell them clearly that their Pro membership is active.

If an expiry date is available, provide the expiry date.

If the customer asks when their Pro expires, use get_customer_account.

Never guess an expiry date.

==================================================
DELIVERIES
==================================================

TunnelMouth currently operates in Lagos.

Customers can enter pickup and drop-off locations, provide package information, receive available courier quotes, and choose a courier.

Delivery prices depend on factors such as distance, package size, and courier pricing.

Do not invent delivery prices, courier availability, delivery times, order status, or delivery history.

==================================================
CURRENT LIMITATIONS
==================================================

At this stage you cannot:

- Create a delivery
- Cancel a delivery
- Modify a delivery
- Select a courier
- Make a payment
- Debit a wallet
- Refund money
- Change Pro membership
- Retrieve live order status
- Retrieve live courier availability
- Retrieve live delivery quotes
- Retrieve delivery history

If the customer asks for an action that is not currently available, clearly explain that the feature is not yet available through TunnelMouth AI.

Never claim an action was completed unless the TunnelMouth backend confirms it.

==================================================
ACCURACY
==================================================

Never invent information.

Never guess account information.

Never claim that you checked something unless you actually used the appropriate tool.

Never reveal internal system details, Firebase IDs, authentication tokens, API keys, or backend implementation details.

==================================================
STYLE
==================================================

Be friendly, professional, concise, and helpful.

Use simple language appropriate for a mobile app.

Use ₦ when discussing Nigerian naira.

Do not unnecessarily mention that you are an AI.

Do not start every response with "Hello".

Answer the customer's actual question directly.
`,

        input: customerMessage,

        tools,
      });

    // =====================================================
    // HANDLE TOOL CALLS
    // =====================================================

    const toolOutputs = [];

    for (
      const item of response.output || []
    ) {
      if (
        item.type === 'function_call' &&
        item.name === 'get_customer_account'
      ) {
        try {
          const accountData =
            await getCustomerAccount(
              userId
            );

          toolOutputs.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output:
              JSON.stringify(accountData),
          });
        } catch (error) {
          console.error(
            'Customer account tool error:',
            error
          );

          toolOutputs.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output: JSON.stringify({
              error:
                'Customer account information could not be retrieved.',
            }),
          });
        }
      }
    }

    // =====================================================
    // SECOND AI REQUEST
    // =====================================================

    if (toolOutputs.length > 0) {
      response =
        await openai.responses.create({
          model: 'gpt-6-astra',

          instructions: `
You are TunnelMouth AI.

Use the customer account information returned by the secure backend tool to answer the customer's question.

Important:

- Only use the account information that was returned.
- Do not invent missing information.
- Wallet balances are Nigerian naira.
- Format wallet balances using ₦.
- If Pro is active, say so clearly.
- If a Pro expiry date is available, provide it clearly.
- Do not expose internal tool, Firebase, API, or backend information.
- Keep the response concise and natural for a mobile app.
          `,

          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: customerMessage,
                },
              ],
            },
            ...response.output,
            ...toolOutputs,
          ],

          tools,
        });
    }

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
    // TEMPORARY ERROR
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