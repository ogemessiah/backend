const express = require('express');
const axios = require('axios');

const { admin, db } = require('../firebaseAdmin');
const { firestore } = require('firebase-admin');

const {
  mapTerminalStatus
} = require('../utils/terminalStatus');

// format number

const formatNigerianPhone = (phone) => {
  const cleaned = String(phone || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '');

  if (cleaned.startsWith('+234')) {
    return cleaned;
  }

  if (cleaned.startsWith('234')) {
    return `+${cleaned}`;
  }

  if (cleaned.startsWith('0')) {
    return `+234${cleaned.slice(1)}`;
  }

  return cleaned;
};

const router = express.Router();

// =========================
// ARRANGE TERMINAL SHIPMENT
// =========================

const arrangeTerminalShipment = async ({
  orderId,
  orderData
}) => {

  const response = await axios.post(
    'https://api.tunnelmouth.com/terminal/arrange',
    {
      pickup: orderData.pickupAddress,
      delivery: orderData.dropoffAddress,

      weight:
        orderData.weight ||
        orderData.packageWeight ||
        1,

      itemName:
        orderData.packageItem ||
        'Package',

      itemValue:
        orderData.itemValue ||
        10000,

      rateId:
        orderData.rateId,

      orderId,

      customer: {
        firstName:
          orderData.customerName?.split(' ')[0] ||
          'TunnelMouth',

        lastName:
          orderData.customerName
            ?.split(' ')
            .slice(1)
            .join(' ') ||
          'Customer',

        phone:
          formatNigerianPhone(
            orderData.customerPhone || ''

          ),
          

        email:
          orderData.customerEmail ||
          ''
      }
    },
    {
      timeout: 30000
    }
  );

  return response.data;
};


// =========================
// HEALTH CHECK
// =========================
router.get('/', (req, res) => {
  res.json({
    status: 'API is running',
    service: 'payment routes active'
  });
});


// =========================
// INITIALIZE PAYMENT
// PAYSTACK
// =========================

router.post('/initialize-payment', async (req, res) => {

  try {

    const {
      orderData,
      amount
    } = req.body;


    // =========================
    // VALIDATION
    // =========================

    if (!orderData) {

      return res.status(400).json({
        success: false,
        error: 'Missing orderData'
      });

    }


    if (!orderData.userId) {

      return res.status(400).json({
        success: false,
        error: 'Missing userId'
      });

    }


    const numericAmount =
      Number(amount);


    if (
      !numericAmount ||
      numericAmount <= 0
    ) {

      return res.status(400).json({
        success: false,
        error: 'Invalid payment amount'
      });

    }


    if (
      !process.env.PAYSTACK_SECRET_KEY
    ) {

      return res.status(500).json({
        success: false,
        error:
          'Server misconfigured: missing PAYSTACK_SECRET_KEY'
      });

    }


    // =========================
    // GET CUSTOMER EMAIL
    // =========================

    const userSnap =
      await db
        .collection('users')
        .doc(orderData.userId)
        .get();


    if (!userSnap.exists) {

      return res.status(404).json({
        success: false,
        error: 'User account not found'
      });

    }


    const user =
      userSnap.data();


    const email =
      user?.email ||
      orderData.customerEmail ||
      '';


    if (!email) {

      return res.status(400).json({
        success: false,
        error: 'Customer email is required'
      });

    }


    // =========================
    // UNIQUE REFERENCE
    // =========================

    const reference =
      `TM_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 8)}`;


    // =========================
    // PAYSTACK INITIALIZATION
    // =========================

    const paystackResponse =
      await axios.post(
        'https://api.paystack.co/transaction/initialize',
        {

          email,

          amount:
            Math.round(
              numericAmount * 100
            ).toString(),

          currency:
            'NGN',

          reference,

          callback_url:
            'https://api.tunnelmouth.com/payment/paystack-callback',

          metadata: {

            userId:
              orderData.userId,

            courierId:
              orderData.courierId || '',

            courierType:
              orderData.courierType || '',

            amount:
              numericAmount,

            cancel_action:
              'https://api.tunnelmouth.com/payment/paystack-cancel'

          }

        },
        {

          headers: {

            Authorization:
              `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

            'Content-Type':
              'application/json'

          },

          timeout: 15000

        }
      );


    const paystackData =
      paystackResponse?.data;


    if (
      !paystackData?.status ||
      !paystackData?.data?.authorization_url
    ) {

      console.error(
        'Paystack initialization failed:',
        paystackData
      );

      return res.status(400).json({

        success: false,

        error:
          paystackData?.message ||
          'Paystack could not initialize payment'

      });

    }


    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success: true,

      authorization_url:
        paystackData.data.authorization_url,

      access_code:
        paystackData.data.access_code,

      reference:
        paystackData.data.reference ||
        reference

    });


  } catch (err) {

    console.error(
      'Initialize payment error:',
      err.response?.data ||
      err.message ||
      err
    );


    return res.status(500).json({

      success: false,

      error:
        err.response?.data?.message ||
        err.message ||
        'Unable to initialize payment'

    });

  }

});

// =========================
// VERIFY PAYMENT (PAYSTACK)
// =========================
router.post('/verify-payment', async (req, res) => {

  try {

    const { reference, orderData } = req.body;

    // =========================
    // VALIDATION
    // =========================

    if (!reference || !orderData) {
      return res.status(400).json({
        success: false,
        error: 'Missing reference or orderData'
      });
    }

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Server misconfigured: missing PAYSTACK_SECRET_KEY'
      });
    }

    if (!orderData.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId'
      });
    }

    // =========================
    // VERIFY PAYMENT WITH PAYSTACK
    // =========================

    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        },
        timeout: 15000
      }
    );

    const payment = verify?.data?.data;

    if (
      !payment ||
      payment.status !== 'success'
    ) {
      return res.status(400).json({
        success: false,
        error: 'Payment not successful'
      });
    }

    // =========================
    // CALCULATE PRICE
    // =========================

    const originalPrice =
      Number(orderData.originalPrice || 0);

    if (originalPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order price'
      });
    }

    let finalPrice = originalPrice;

    let voucher = null;

    // =========================
    // VALIDATE VOUCHER
    // =========================

    if (orderData.voucherCode) {

      const voucherSnap = await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .get();

      if (!voucherSnap.exists) {
        return res.status(400).json({
          success: false,
          error: 'Invalid voucher'
        });
      }

      voucher = voucherSnap.data();

      if (!voucher.active) {
        return res.status(400).json({
          success: false,
          error: 'Voucher is inactive'
        });
      }

      if (
        voucher.expiry &&
        voucher.expiry.toDate() < new Date()
      ) {
        return res.status(400).json({
          success: false,
          error: 'Voucher has expired'
        });
      }

      if (
        voucher.maxUses &&
        voucher.timesUsed >= voucher.maxUses
      ) {
        return res.status(400).json({
          success: false,
          error: 'Voucher usage limit reached'
        });
      }

      if (
        originalPrice <
        Number(voucher.minimumOrder || 0)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Order does not meet minimum amount'
        });
      }

      // =========================
      // CALCULATE DISCOUNT
      // =========================

      if (voucher.type === 'fixed') {

        finalPrice =
          Math.max(
            originalPrice -
            Number(voucher.value || 0),
            0
          );

      } else {

        let amountOff =
          originalPrice *
          (Number(voucher.value || 0) / 100);

        if (
          voucher.maximumDiscount &&
          amountOff >
          Number(voucher.maximumDiscount)
        ) {

          amountOff =
            Number(voucher.maximumDiscount);

        }

        finalPrice =
          Math.max(
            originalPrice -
            amountOff,
            0
          );
      }
    }

    // =========================
    // COURIER TYPE
    // =========================

    const isTerminal =
      orderData.courierType === 'terminal';

    const isTunnelMouth =
      orderData.courierType === 'tunnelmouth';

    // =========================
    // CALCULATE EARNINGS
    // =========================

    let platformFee = 0;
    let driverEarning = 0;
    let terminalBasePrice = 0;

    if (isTerminal) {

      terminalBasePrice =
        Number(
          orderData.terminalQuote?.basePrice || 0
        );

      platformFee =
        Number(
          orderData.terminalQuote?.platformFee || 0
        ) +
        Number(
          orderData.terminalQuote?.fixedFee || 0
        );

      driverEarning =
        terminalBasePrice;

    } else if (isTunnelMouth) {

      platformFee =
        Math.floor(
          originalPrice * 0.05
        ) + 500;

      driverEarning =
        originalPrice -
        platformFee;
    }

    // =========================
    // VOUCHER DISCOUNT
    // =========================

    const voucherDiscount =
      originalPrice - finalPrice;

    // =========================
    // REFERENCES
    // =========================

    const userRef =
      db
        .collection('users')
        .doc(orderData.userId);

    /*
     * IMPORTANT:
     *
     * Use the payment reference as the order ID.
     *
     * This gives us an idempotency mechanism.
     */
    const orderRef =
      db
        .collection('orders')
        .doc(reference);

    // =========================
    // ATOMIC TRANSACTION
    // =========================
    //
    // This transaction:
    //
    // 1. Checks whether the payment was already processed
    // 2. Reads the user's wallet
    // 3. Calculates walletUsed
    // 4. Verifies the amount Paystack charged
    // 5. Deducts walletUsed atomically
    // 6. Creates the order
    // 7. Marks first order
    // 8. Increments voucher usage
    // 9. Creates wallet transaction
    //
    // This prevents two simultaneous requests from
    // spending the same wallet balance.
    // =========================

    const transactionResult =
      await db.runTransaction(
        async (transaction) => {

          // =========================
          // CHECK DUPLICATE PAYMENT
          // =========================

          const existingOrder =
            await transaction.get(orderRef);

          if (existingOrder.exists) {

            return {
              alreadyProcessed: true,
              orderId: orderRef.id
            };
          }

          // =========================
          // READ USER
          // =========================

          const userSnap =
            await transaction.get(userRef);

          if (!userSnap.exists) {

            throw new Error(
              'User account not found'
            );
          }

          const user =
            userSnap.data();

          // =========================
          // FIRST-TIME VOUCHER CHECK
          // =========================

          if (
            voucher &&
            voucher.firstTimeOnly &&
            user.hasPlacedFirstOrder
          ) {

            throw new Error(
              'Voucher only valid for first order'
            );
          }

          // =========================
          // READ WALLET
          // =========================

          const walletBalance =
            Number(
              user.walletBalance || 0
            );

          // =========================
          // CALCULATE WALLET USAGE
          // =========================

          const walletUsed =
            Math.min(
              walletBalance,
              finalPrice
            );

          // =========================
          // AMOUNT CUSTOMER SHOULD
          // PAY THROUGH PAYSTACK
          // =========================

          const amountExpected =
            finalPrice -
            walletUsed;

          const customerPays =
            Number(payment.amount) / 100;

          // =========================
          // VERIFY PAYMENT AMOUNT
          // =========================
          //
          // This prevents someone from paying
          // less than the amount actually required.
          // =========================

          if (
            Math.abs(
              customerPays -
              amountExpected
            ) > 0.01
          ) {

            throw new Error(
              'Payment amount mismatch'
            );
          }

          // =========================
          // CREATE ORDER
          // =========================

          transaction.set(
            orderRef,
            {

              ...orderData,

              originalPrice,

              terminalBasePrice:
                isTerminal
                  ? terminalBasePrice
                  : 0,

              amountPaid:
                customerPays,

              walletUsed,

              voucherDiscount,

              driverEarning:
                isTunnelMouth
                  ? driverEarning
                  : 0,

              platformFee,

              paymentReference:
                reference,

              paymentStatus:
                'paid',

              status:
                isTerminal
                  ? 'terminal_arranging'
                  : 'assigned',

              reviewSubmitted:
                false,

              // =========================
              // TERMINAL FIELDS
              // =========================

              terminalShipmentId:
                null,

              terminalTrackingNumber:
                null,

              terminalTrackingUrl:
                null,

              terminalStatus:
                isTerminal
                  ? 'pending'
                  : null,

              terminalRateId:
                isTerminal
                  ? orderData.rateId || null
                  : null,

              terminalPickupDate:
                null,

              terminalDeliveryDate:
                null,

              createdAt:
                admin.firestore.FieldValue
                  .serverTimestamp()
            }
          );

          // =========================
          // DEDUCT WALLET ATOMICALLY
          // =========================

          if (walletUsed > 0) {

            transaction.update(
              userRef,
              {

                walletBalance:
                  admin.firestore.FieldValue
                    .increment(-walletUsed),

                walletLastUpdated:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

          }

          // =========================
          // MARK FIRST ORDER
          // =========================

          transaction.set(
            userRef,
            {
              hasPlacedFirstOrder:
                true
            },
            {
              merge: true
            }
          );

          // =========================
          // WALLET TRANSACTION
          // =========================

          if (walletUsed > 0) {

            const walletTransactionRef =
              db
                .collection('wallet_transactions')
                .doc();

            transaction.set(
              walletTransactionRef,
              {

                userId:
                  orderData.userId,

                type:
                  'debit',

                amount:
                  walletUsed,

                description:
                  'Wallet used toward delivery payment',

                orderId:
                  orderRef.id,

                createdAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );
          }

          // =========================
          // VOUCHER USAGE
          // =========================

          if (orderData.voucherCode) {

            const voucherRef =
              db
                .collection('vouchers')
                .doc(
                  orderData.voucherCode
                );

            transaction.update(
              voucherRef,
              {

                timesUsed:
                  admin.firestore.FieldValue
                    .increment(1)

              }
            );
          }

          return {
            alreadyProcessed: false,
            orderId: orderRef.id,
            walletUsed,
            customerPays,
            amountExpected
          };
        }
      );

    // =========================
    // ALREADY PROCESSED
    // =========================

    if (
      transactionResult.alreadyProcessed
    ) {

      return res.json({

        success:
          true,

        orderId:
          transactionResult.orderId,

        alreadyProcessed:
          true

      });
    }

    // =========================
    // VALUES FROM TRANSACTION
    // =========================

    const orderId =
      transactionResult.orderId;

    const walletUsed =
      Number(
        transactionResult.walletUsed || 0
      );

    const customerPays =
      Number(
        transactionResult.customerPays || 0
      );

    // =========================
    // TERMINAL SHIPMENT
    // =========================

    if (isTerminal) {

      try {

        // =========================
        // RATE ID REQUIRED
        // =========================

        if (!orderData.rateId) {

          throw new Error(
            'Missing Terminal rate ID'
          );
        }

        // =========================
        // ARRANGE SHIPMENT
        // =========================

        const terminalResult =
          await arrangeTerminalShipment({

            orderId,

            orderData

          });

        console.log(
          'Terminal arrangement result:',
          JSON.stringify(
            terminalResult,
            null,
            2
          )
        );

        // =========================
        // ARRANGEMENT FAILED
        // =========================

        if (
          !terminalResult ||
          !terminalResult.success
        ) {

          throw new Error(
            terminalResult?.message ||
            'Unable to arrange Terminal shipment.'
          );
        }

        // =========================
        // SAVE TERMINAL DETAILS
        // =========================

        await db
          .collection('orders')
          .doc(orderId)
          .update({

            status:
              'assigned',

            terminalShipmentId:
              terminalResult.shipmentId ||
              null,

            terminalTrackingNumber:
              terminalResult.trackingNumber ||
              null,

            terminalTrackingUrl:
              terminalResult.trackingUrl ||
              null,

            terminalStatus:
              terminalResult.status ||
              'confirmed',

            terminalRateId:
              terminalResult.rateId ||
              orderData.rateId,

            terminalPickupDate:
              terminalResult.pickupDate ||
              null,

            terminalDeliveryDate:
              terminalResult.deliveryDate ||
              null,

            terminalUpdatedAt:
              admin.firestore.FieldValue
                .serverTimestamp()

          });

      } catch (terminalError) {

        console.error(
          'Terminal arrangement failed:',
          terminalError.response?.data ||
          terminalError.message
        );

        // =========================
        // REFUND EVERYTHING
        // =========================
        //
        // Because walletUsed has already been
        // deducted atomically, we must refund:
        //
        // Paystack payment
        // +
        // wallet amount
        //
        // back into the customer's wallet.
        // =========================

        const refundAmount =
          customerPays +
          walletUsed;

        await db.runTransaction(
          async (transaction) => {

            const refundOrderRef =
              db
                .collection('orders')
                .doc(orderId);

            const refundUserRef =
              db
                .collection('users')
                .doc(orderData.userId);

            const orderSnap =
              await transaction.get(
                refundOrderRef
              );

            if (!orderSnap.exists) {

              throw new Error(
                'Order not found during refund'
              );
            }

            const order =
              orderSnap.data();

            // =========================
            // PREVENT DOUBLE REFUND
            // =========================

            if (
              order.paymentStatus ===
              'refunded'
            ) {

              return;
            }

            // =========================
            // REFUND CUSTOMER WALLET
            // =========================

            if (refundAmount > 0) {

              transaction.update(
                refundUserRef,
                {

                  walletBalance:
                    admin.firestore.FieldValue
                      .increment(
                        refundAmount
                      ),

                  walletLastUpdated:
                    admin.firestore.FieldValue
                      .serverTimestamp()

                }
              );
            }

            // =========================
            // UPDATE ORDER
            // =========================

            transaction.update(
              refundOrderRef,
              {

                status:
                  'failed',

                terminalStatus:
                  'failed',

                paymentStatus:
                  'refunded',

                terminalError:
                  terminalError.message,

                refundAmount,

                refundMethod:
                  'wallet',

                refundedAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

            // =========================
            // REFUND TRANSACTION
            // =========================

            if (refundAmount > 0) {

              const refundTransactionRef =
                db
                  .collection(
                    'wallet_transactions'
                  )
                  .doc();

              transaction.set(
                refundTransactionRef,
                {

                  userId:
                    orderData.userId,

                  type:
                    'refund',

                  amount:
                    refundAmount,

                  description:
                    'Terminal shipment failed. Payment refunded to wallet.',

                  orderId,

                  createdAt:
                    admin.firestore.FieldValue
                      .serverTimestamp()

                }
              );
            }
          }
        );

        return res.status(502).json({

          success:
            false,

          error:
            'Terminal shipment could not be arranged. Your payment has been refunded to your wallet.',

          orderId,

          refunded:
            true,

          refundAmount

        });
      }
    }

    // =========================
    // TUNNELMOUTH DRIVER WALLET
    // =========================
    //
    // Only TunnelMouth couriers receive
    // driver earnings.
    // =========================

    if (isTunnelMouth) {

      const courierRef =
        db
          .collection('couriers_live')
          .doc(
            orderData.courierId
          );

      const courierSnap =
        await courierRef.get();

      if (courierSnap.exists) {

        await courierRef.update({

          walletBalance:
            admin.firestore.FieldValue
              .increment(
                driverEarning
              ),

          totalEarned:
            admin.firestore.FieldValue
              .increment(
                driverEarning
              ),

          totalDeliveries:
            admin.firestore.FieldValue
              .increment(1)

        });

        await db
          .collection(
            'wallet_transactions'
          )
          .add({

            userId:
              orderData.courierId,

            type:
              'credit',

            amount:
              driverEarning,

            description:
              'Delivery payment received',

            orderId,

            createdAt:
              admin.firestore.FieldValue
                .serverTimestamp()

          });
      }
    }

    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success:
        true,

      orderId,

      courierType:
        orderData.courierType ||
        'tunnelmouth'

    });

  } catch (err) {

    console.error(
      'Verify payment error:',
      err
    );

    return res.status(400).json({

      success:
        false,

      message:
        err.message ||
        'Payment verification failed'

    });
  }

});

// =========================
// WALLET PAYMENT
// =========================

router.post('/wallet-payment', async (req, res) => {

  try {

    const { orderData } = req.body;

    if (!orderData) {
      return res.status(400).json({
        success: false,
        message: 'Missing orderData'
      });
    }

    if (!orderData.userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId'
      });
    }

    const originalPrice =
      Number(orderData.originalPrice || 0);

    if (originalPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order price'
      });
    }


    // =========================
    // CALCULATE PRICE
    // =========================

    let finalPrice = originalPrice;

    let voucher = null;

    if (orderData.voucherCode) {

      const voucherSnap = await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .get();

      if (!voucherSnap.exists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid voucher'
        });
      }

      voucher = voucherSnap.data();

      if (!voucher.active) {
        return res.status(400).json({
          success: false,
          message: 'Voucher is inactive'
        });
      }

      if (
        voucher.expiry &&
        voucher.expiry.toDate() < new Date()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Voucher has expired'
        });
      }

      if (
        voucher.maxUses &&
        voucher.timesUsed >= voucher.maxUses
      ) {
        return res.status(400).json({
          success: false,
          message: 'Voucher usage limit reached'
        });
      }

      if (
        originalPrice <
        Number(voucher.minimumOrder || 0)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Order does not meet minimum amount'
        });
      }

      if (voucher.type === 'fixed') {

        finalPrice = Math.max(
          originalPrice -
          Number(voucher.value || 0),
          0
        );

      } else {

        let amountOff =
          originalPrice *
          (Number(voucher.value || 0) / 100);

        if (
          voucher.maximumDiscount &&
          amountOff >
          Number(voucher.maximumDiscount)
        ) {
          amountOff =
            Number(voucher.maximumDiscount);
        }

        finalPrice =
          Math.max(
            originalPrice - amountOff,
            0
          );

      }

    }


    // =========================
    // COURIER TYPE
    // =========================

    const isTerminal =
      orderData.courierType === 'terminal';

    const isTunnelMouth =
      orderData.courierType === 'tunnelmouth';


    // =========================
    // EARNINGS
    // =========================

    let platformFee = 0;
    let driverEarning = 0;
    let terminalBasePrice = 0;

    if (isTerminal) {

      terminalBasePrice =
        Number(
          orderData.terminalQuote?.basePrice || 0
        );

      platformFee =
        Number(
          orderData.terminalQuote?.platformFee || 0
        ) +
        Number(
          orderData.terminalQuote?.fixedFee || 0
        );

      driverEarning =
        terminalBasePrice;

    } else if (isTunnelMouth) {

      platformFee =
        Math.floor(
          originalPrice * 0.05
        ) + 500;

      driverEarning =
        originalPrice -
        platformFee;

    }


    const voucherDiscount =
      originalPrice - finalPrice;


    // =========================
    // IDEMPOTENCY KEY
    // =========================

    if (!orderData.paymentReference) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment reference'
      });
    }

    const paymentReference =
      orderData.paymentReference;


    const orderRef =
      db
        .collection('orders')
        .doc(paymentReference);


    // =========================
    // ATOMIC WALLET TRANSACTION
    // =========================
    const userRef =
      db 
        .collection('users')
        .doc(orderData.userId);

    const result =
      await db.runTransaction(
        async (transaction) => {

          // -------------------------
          // CHECK IF ALREADY PROCESSED
          // -------------------------

          const existingOrder =
            await transaction.get(orderRef);

          if (existingOrder.exists) {

            return {
              alreadyProcessed: true,
              orderId: orderRef.id
            };

          }


          // -------------------------
          // READ USER
          // -------------------------

          const userSnap =
            await transaction.get(userRef);

          if (!userSnap.exists) {

            throw new Error(
              'User account not found'
            );

          }

          const user =
            userSnap.data();

          const walletBalance =
            Number(
              user.walletBalance || 0
            );


          // -------------------------
          // FIRST-TIME VOUCHER
          // -------------------------

          if (
            voucher &&
            voucher.firstTimeOnly &&
            user.hasPlacedFirstOrder
          ) {

            throw new Error(
              'Voucher only valid for first order'
            );

          }


          // -------------------------
          // CHECK WALLET
          // -------------------------

          if (
            walletBalance <
            finalPrice
          ) {

            throw new Error(
              'Insufficient wallet balance'
            );

          }


          // -------------------------
          // DEDUCT WALLET
          // -------------------------

          transaction.update(
            userRef,
            {

              walletBalance:
                admin.firestore.FieldValue
                  .increment(-finalPrice),

              hasPlacedFirstOrder:
                true,

              walletLastUpdated:
                admin.firestore.FieldValue
                  .serverTimestamp()

            }
          );


          // -------------------------
          // CREATE ORDER
          // -------------------------

          transaction.set(
            orderRef,
            {

              ...orderData,

              originalPrice,

              amountPaid:
                0,

              walletUsed:
                finalPrice,

              voucherDiscount,

              driverEarning,

              platformFee,

              paymentReference,

              paymentStatus:
                'wallet',

              status:
                isTerminal
                  ? 'terminal_arranging'
                  : 'assigned',

              reviewSubmitted:
                false,

              terminalBasePrice:
                isTerminal
                  ? terminalBasePrice
                  : 0,

              terminalShipmentId:
                null,

              terminalTrackingNumber:
                null,

              terminalTrackingUrl:
                null,

              terminalStatus:
                isTerminal
                  ? 'pending'
                  : null,

              terminalRateId:
                isTerminal
                  ? orderData.rateId || null
                  : null,

              terminalPickupDate:
                null,

              terminalDeliveryDate:
                null,

              createdAt:
                admin.firestore.FieldValue
                  .serverTimestamp()

            }
          );


          // -------------------------
          // WALLET TRANSACTION
          // -------------------------

          const walletTransactionRef =
            db
              .collection('wallet_transactions')
              .doc();

          transaction.set(
            walletTransactionRef,
            {

              userId:
                orderData.userId,

              type:
                'debit',

              amount:
                finalPrice,

              description:
                'Wallet payment',

              orderId:
                orderRef.id,

              createdAt:
                admin.firestore.FieldValue
                  .serverTimestamp()

            }
          );


          // -------------------------
          // VOUCHER USAGE
          // -------------------------

          if (orderData.voucherCode) {

            const voucherRef =
              db
                .collection('vouchers')
                .doc(
                  orderData.voucherCode
                );

            transaction.update(
              voucherRef,
              {

                timesUsed:
                  admin.firestore.FieldValue
                    .increment(1)

              }
            );

          }


          return {
            alreadyProcessed: false,
            orderId: orderRef.id
          };

        }
      );


    // =========================
    // ALREADY PROCESSED
    // =========================

    if (result.alreadyProcessed) {

      return res.json({

        success:
          true,

        orderId:
          result.orderId,

        alreadyProcessed:
          true

      });

    }


    const orderId =
      result.orderId;


    // =========================
    // TERMINAL ARRANGEMENT
    // =========================

    if (isTerminal) {

      try {

        // -------------------------
        // RATE ID REQUIRED
        // -------------------------

        if (!orderData.rateId) {

          throw new Error(
            'Missing Terminal rate ID'
          );

        }


        const terminalResult =
          await arrangeTerminalShipment({

            orderId,

            orderData

          });


        console.log(
          'Terminal wallet arrangement result:',
          JSON.stringify(
            terminalResult,
            null,
            2
          )
        );


        // -------------------------
        // TERMINAL FAILED
        // -------------------------

        if (
          !terminalResult ||
          !terminalResult.success
        ) {

          throw new Error(
            terminalResult?.message ||
            'Unable to arrange Terminal shipment.'
          );

        }


        // -------------------------
        // SAVE TERMINAL DETAILS
        // -------------------------

        await db
          .collection('orders')
          .doc(orderId)
          .update({

            status:
              'assigned',

            terminalShipmentId:
              terminalResult.shipmentId ||
              null,

            terminalTrackingNumber:
              terminalResult.trackingNumber ||
              null,

            terminalTrackingUrl:
              terminalResult.trackingUrl ||
              null,

            terminalStatus:
              terminalResult.status ||
              'confirmed',

            terminalRateId:
              terminalResult.rateId ||
              orderData.rateId,

            terminalPickupDate:
              terminalResult.pickupDate ||
              null,

            terminalDeliveryDate:
              terminalResult.deliveryDate ||
              null,

            terminalUpdatedAt:
              admin.firestore.FieldValue
                .serverTimestamp()

          });


      } catch (terminalError) {

        console.error(
          'Terminal wallet arrangement failed:',
          terminalError.response?.data ||
          terminalError.message
        );


        // =========================
        // REFUND WALLET
        // =========================

        await db.runTransaction(
          async (transaction) => {

            const orderRef =
              db
                .collection('orders')
                .doc(orderId);

            const orderSnap =
              await transaction.get(
                orderRef
              );

            if (!orderSnap.exists) {
              throw new Error(
                'Order not found during refund'
              );
            }

            const order =
              orderSnap.data();


            // Prevent double refund

            if (
              order.paymentStatus ===
              'refunded'
            ) {

              return;

            }


            const refundAmount =
              Number(
                order.walletUsed || 0
              );


            const customerRef =
              db
                .collection('users')
                .doc(
                  order.userId
                );


            // Refund wallet

            transaction.update(
              customerRef,
              {

                walletBalance:
                  admin.firestore.FieldValue
                    .increment(
                      refundAmount
                    ),

                walletLastUpdated:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );


            // Update order

            transaction.update(
              orderRef,
              {

                status:
                  'failed',

                terminalStatus:
                  'failed',

                paymentStatus:
                  'refunded',

                terminalError:
                  terminalError.message,

                refundAmount,

                refundMethod:
                  'wallet',

                refundedAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );


            // Wallet refund transaction

            const refundTransactionRef =
              db
                .collection(
                  'wallet_transactions'
                )
                .doc();

            transaction.set(
              refundTransactionRef,
              {

                userId:
                  order.userId,

                type:
                  'refund',

                amount:
                  refundAmount,

                description:
                  'Terminal shipment failed. Wallet payment refunded.',

                orderId,

                createdAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

          }
        );


        return res.status(502).json({

          success:
            false,

          error:
            'Terminal shipment could not be arranged. Your wallet payment has been refunded.',

          orderId

        });

      }

    }


    // =========================
    // TUNNELMOUTH DRIVER WALLET
    // =========================

    if (isTunnelMouth) {

      const courierRef =
        db
          .collection('couriers_live')
          .doc(
            orderData.courierId
          );

      const courierSnap =
        await courierRef.get();

      if (courierSnap.exists) {

        await courierRef.update({

          walletBalance:
            admin.firestore.FieldValue
              .increment(
                driverEarning
              ),

          totalEarned:
            admin.firestore.FieldValue
              .increment(
                driverEarning
              ),

          totalDeliveries:
            admin.firestore.FieldValue
              .increment(1)

        });


        await db
          .collection(
            'wallet_transactions'
          )
          .add({

            userId:
              orderData.courierId,

            type:
              'credit',

            amount:
              driverEarning,

            description:
              'Delivery payment received',

            orderId,

            createdAt:
              admin.firestore.FieldValue
                .serverTimestamp()

          });

      }

    }


    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success:
        true,

      orderId,

      courierType:
        orderData.courierType ||
        'tunnelmouth'

    });


  } catch (err) {

    console.error(
      'Wallet payment error:',
      err
    );

    return res.status(400).json({

      success:
        false,

      message:
        err.message

    });

  }

});


// =========================
// DRIVER DECLINES ORDER
// =========================
router.post('/decline-order', async (req, res) => {

  try {

    const { orderId, courierId } = req.body;

    if (!orderId || !courierId) {
      return res.status(400).json({
        success: false,
        message: 'Missing orderId or courierId'
      });
    }

    const orderRef =
      db.collection('orders').doc(orderId);

    const courierRef =
      db.collection('couriers_live').doc(courierId);

    const result =
      await db.runTransaction(
        async (transaction) => {

          // =========================
          // READ ORDER
          // =========================

          const orderSnap =
            await transaction.get(orderRef);

          if (!orderSnap.exists) {
            throw new Error('Order not found');
          }

          const order =
            orderSnap.data();

          // =========================
          // VERIFY COURIER
          // =========================

          if (
            order.courierType === 'tunnelmouth' &&
            order.courierId !== courierId
          ) {

            throw new Error(
              'You are not assigned to this order.'
            );

          }

          // =========================
          // ONLY ASSIGNED ORDERS
          // CAN BE DECLINED
          // =========================

          if (
            order.status !== 'assigned' &&
            order.status !== undefined &&
            order.status !== null &&
            order.status !== ''
          ) {

            if (order.status === 'declined') {

              return {
                alreadyDeclined: true
              };

            }

            throw new Error(
              `This order cannot be declined because it is already ${order.status}.`
            );

          }

          // =========================
          // READ COURIER
          // =========================

          const courierSnap =
            await transaction.get(courierRef);

          // =========================
          // CALCULATE AMOUNTS
          // =========================

          const amountPaid =
            Number(order.amountPaid || 0);

          const walletUsed =
            Number(order.walletUsed || 0);

          const refundAmount =
            amountPaid + walletUsed;

          const driverEarning =
            Number(order.driverEarning || 0);

          // =========================
          // MARK ORDER DECLINED
          // =========================

          transaction.update(
            orderRef,
            {

              status:
                'declined',

              paymentStatus:
                'refunded',

              declinedAt:
                admin.firestore.FieldValue
                  .serverTimestamp(),

              refundAmount,

              refundMethod:
                'wallet'

            }
          );

          // =========================
          // REVERSE DRIVER EARNINGS
          // =========================

          if (
            order.courierType === 'tunnelmouth' &&
            driverEarning > 0 &&
            courierSnap.exists
          ) {

            const courier =
              courierSnap.data();

            const currentBalance =
              Number(
                courier.walletBalance || 0
              );

            const currentTotalEarned =
              Number(
                courier.totalEarned || 0
              );

            const currentDeliveries =
              Number(
                courier.totalDeliveries || 0
              );

            transaction.update(
              courierRef,
              {

                walletBalance:
                  Math.max(
                    currentBalance -
                    driverEarning,
                    0
                  ),

                totalEarned:
                  Math.max(
                    currentTotalEarned -
                    driverEarning,
                    0
                  ),

                totalDeliveries:
                  Math.max(
                    currentDeliveries - 1,
                    0
                  )

              }
            );

            // =========================
            // DRIVER REVERSAL RECORD
            // =========================

            const driverTransactionRef =
              db
                .collection(
                  'wallet_transactions'
                )
                .doc();

            transaction.set(
              driverTransactionRef,
              {

                userId:
                  courierId,

                type:
                  'debit',

                amount:
                  driverEarning,

                description:
                  'Delivery declined - earnings reversed',

                orderId,

                createdAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

          }

          // =========================
          // REFUND CUSTOMER
          // =========================

          if (refundAmount > 0) {

            const customerRef =
              db
                .collection('users')
                .doc(order.userId);

            transaction.update(
              customerRef,
              {

                walletBalance:
                  admin.firestore.FieldValue
                    .increment(
                      refundAmount
                    ),

                walletLastUpdated:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

            // =========================
            // REFUND RECORD
            // =========================

            const refundTransactionRef =
              db
                .collection(
                  'wallet_transactions'
                )
                .doc();

            transaction.set(
              refundTransactionRef,
              {

                userId:
                  order.userId,

                type:
                  'refund',

                amount:
                  refundAmount,

                description:
                  'Driver declined your delivery. Amount refunded to wallet.',

                orderId,

                createdAt:
                  admin.firestore.FieldValue
                    .serverTimestamp()

              }
            );

          }

          return {
            alreadyDeclined: false,
            refundAmount,
            driverEarning
          };

        }
      );

    // =========================
    // ALREADY DECLINED
    // =========================

    if (
      result.alreadyDeclined
    ) {

      return res.json({

        success:
          true,

        alreadyDeclined:
          true

      });

    }

    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success:
        true,

      refundAmount:
        result.refundAmount,

      driverEarningReversed:
        result.driverEarning,

      courierType:
        'tunnelmouth'

    });

  } catch (err) {

    console.error(
      'Decline order error:',
      err
    );

    return res.status(400).json({

      success:
        false,

      message:
        err.message ||
        'Unable to decline order'

    });

  }

});




// =========================
// SUBMIT COURIER REVIEW
// =========================
router.post('/submit-review', async (req, res) => {

  try {

    const {
      courierId,
      courierName,
      customerId,
      customerName,
      orderId,
      rating,
      review
    } = req.body;


    // =========================
    // VALIDATION
    // =========================

    if (
      !courierId ||
      !orderId ||
      !customerId
    ) {

      return res.status(400).json({
        success: false,
        message:
          'Missing required review information'
      });

    }


    const numericRating =
      Number(rating);


    if (
      numericRating < 1 ||
      numericRating > 5
    ) {

      return res.status(400).json({
        success: false,
        message:
          'Rating must be between 1 and 5'
      });

    }


    const cleanReview =
      String(review || '').trim();


    if (!cleanReview) {

      return res.status(400).json({
        success: false,
        message:
          'Review cannot be empty'
      });

    }


    // =========================
    // REFERENCES
    // =========================

    const orderRef =
      db
        .collection('orders')
        .doc(orderId);


    const courierRef =
      db
        .collection('couriers_live')
        .doc(courierId);


    const reviewRef =
      db
        .collection('courier_reviews')
        .doc();


    // =========================
    // TRANSACTION
    // =========================

    const result =
      await db.runTransaction(
        async (transaction) => {

          // =========================
          // READ ORDER
          // =========================

          const orderSnap =
            await transaction.get(
              orderRef
            );


          if (!orderSnap.exists) {

            throw new Error(
              'Order not found'
            );

          }


          const order =
            orderSnap.data();


          // =========================
          // VERIFY COURIER
          // =========================

          if (
            order.courierId !== courierId
          ) {

            throw new Error(
              'This courier is not assigned to this order'
            );

          }


          // =========================
          // VERIFY CUSTOMER
          // =========================

          if (
            order.userId !== customerId
          ) {

            throw new Error(
              'You are not authorized to review this order'
            );

          }


          // =========================
          // CHECK EXISTING REVIEW
          // =========================

          if (
            order.reviewSubmitted === true
          ) {

            return {
              alreadyReviewed: true
            };

          }


          // =========================
          // CREATE REVIEW
          // =========================

          transaction.set(
            reviewRef,
            {

              courierId,

              courierName:
                courierName ||
                order.courierName ||
                '',

              customerId,

              customerName:
                customerName ||
                '',

              orderId,

              rating:
                numericRating,

              review:
                cleanReview,

              createdAt:
                admin.firestore.FieldValue
                  .serverTimestamp()

            }
          );


          // =========================
          // MARK ORDER REVIEWED
          // =========================

          transaction.update(
            orderRef,
            {

              reviewSubmitted:
                true,

              reviewSubmittedAt:
                admin.firestore.FieldValue
                  .serverTimestamp()

            }
          );


          return {
            alreadyReviewed: false
          };

        }
      );


    // =========================
    // ALREADY REVIEWED
    // =========================

    if (
      result.alreadyReviewed
    ) {

      return res.status(409).json({

        success: false,

        message:
          'You have already reviewed this delivery.'

      });

    }


    // =========================
    // RECALCULATE COURIER RATING
    // =========================

    const reviewsSnapshot =
      await db
        .collection('courier_reviews')
        .where(
          'courierId',
          '==',
          courierId
        )
        .get();


    let totalRating = 0;

    reviewsSnapshot.forEach(
      (reviewDoc) => {

        totalRating +=
          Number(
            reviewDoc.data().rating || 0
          );

      }
    );


    const totalReviews =
      reviewsSnapshot.size;


    const averageRating =
      totalReviews > 0

        ? Number(
            (
              totalRating /
              totalReviews
            ).toFixed(1)
          )

        : 0;


    // =========================
    // UPDATE COURIER
    // =========================

    await courierRef.update({

      averageRating,

      totalReviews

    });


    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success: true,

      message:
        'Review submitted successfully',

      reviewId:
        reviewRef.id,

      averageRating,

      totalReviews

    });


  } catch (err) {

    console.error(
      'Submit review error:',
      err
    );


    return res.status(400).json({

      success: false,

      message:
        err.message ||
        'Unable to submit review'

    });

  }

});

router.get('/paystack-callback', (req, res) => {

  const reference =
    req.query.reference ||
    req.query.trxref ||
    '';

  console.log(
    'Paystack callback:',
    reference
  );

  res.status(200).send('OK');

});

// =========================
// PAYSTACK CANCEL CALLBACK
// =========================

router.get('/paystack-cancel', (req, res) => {

  console.log(
    'Paystack payment cancelled.'
  );

  res.status(200).send('PAYMENT_CANCELLED');

});



module.exports = router;