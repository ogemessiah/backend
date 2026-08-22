const express = require('express');
const axios = require('axios');

const { admin, db } = require('../firebaseAdmin');
const { firestore } = require('firebase-admin');

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
      pickup: orderData.pickup,
      delivery: orderData.dropoff,

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
          orderData.customerPhone ||
          '',

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

    // =========================
    // VERIFY PAYMENT WITH PAYSTACK
    // =========================
    const verify = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        },
        timeout: 15000
      }
    );

    const payment = verify?.data?.data;

    if (!payment || payment.status !== 'success') {
      return res.status(400).json({
        success: false,
        error: 'Payment not successful'
      });
    }

    // prevent double processing

    const existingOrderSnapshot = await db
      .collection('orders')
      .where('paymentReference', '==', reference)
      .limit(1)
      .get();

    if (!existingOrderSnapshot.empty) {

      const existingOrder =
        existingOrderSnapshot.docs[0];

        return res.json({
          success: true,
          orderId: existingOrder.id,
          alreadyProcessed: true
        });
    }

    // =========================
    // CALCULATE FEES
    // =========================
    const originalPrice = Number(orderData.originalPrice || 0);

    let finalPrice = originalPrice;


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

      const voucher = voucherSnap.data();

      if (!voucher.active) {
        return res.status(400).json({
          success: false,
          error: 'Voucher is inactive'
        });
      }

      if (voucher.expiry.toDate() < new Date()) {
        return res.status(400).json({
          success: false,
          error: 'Voucher has expired'
        });
      }

      if (voucher.maxUses && voucher.timesUsed >= voucher.maxUses) {
        return res.status(400).json({
          success: false,
          error: 'Voucher usage limit reached'
        });
      }

      if (originalPrice < voucher.minimumOrder) {
        return res.status(400).json({
          success: false,
          error: 'Order does not meet minimum amount'
        });
      }

      // First order check
      const userSnap = await db
        .collection('users')
        .doc(orderData.userId)
        .get();

      const user = userSnap.data();

      if (
        voucher.firstTimeOnly &&
        user?.hasPlacedFirstOrder
      ) {
        return res.status(400).json({
          success: false,
          error: 'Voucher only valid for first order'
        });
      }

      // Calculate discount
      if (voucher.type === 'fixed') {

        finalPrice = Math.max(
          originalPrice - voucher.value,
          0
        );

      } else {

        let amountOff = originalPrice * (voucher.value / 100);

        if (
          voucher.maximumDiscount &&
          amountOff > voucher.maximumDiscount
        ) {
          amountOff = voucher.maximumDiscount;
        }
        finalPrice = Math.max(originalPrice - amountOff, 0);

      }

    }
    
   
    const userRef = db.collection('users').doc(orderData.userId);
    const userSnap = await userRef.get();
    const walletBalance = Number(userSnap.data()?.walletBalance || 0);
    const walletUsed = Math.min(walletBalance, finalPrice);
    const amountExpected = finalPrice - walletUsed;
    const customerPays = Number(payment.amount) / 100;

    const isTerminal =
      orderData.courierType === 'terminal';

    const isTunnelMouth =
      orderData.courierType === 'tunnelmouth';

    let platformFee = 0;
    let driverEarning = 0;
    let terminalBasePrice = 0;

    if (isTerminal) {

      // Terminal quote already includes:
      // 5% TunnelMouth fee + N500 fixed fee

      terminalBasePrice =
        Number(orderData.terminalQuote?.basePrice || 0);

      platformFee =
        Number(orderData.terminalQuote?.platformFee || 0) +
        Number(orderData.terminalQuote?.fixedFee || 0);

      driverEarning =
        terminalBasePrice;

    } else if (isTunnelMouth) {

      // Tunnelmouth courier pricing
      platformFee =
        Math.floor(originalPrice * 0.05) + 500;

      driverEarning =
        originalPrice - platformFee;

    }

    const voucherCost =
      originalPrice - finalPrice;

    

    if (Math.abs(customerPays - amountExpected) > 0.01) {
      return res.status(400).json({
        success: false,
        error: 'Payment amount mismatch'
      });
    }

    // =========================
    // CREATE ORDER
    // =========================
   

    const orderRef =
      await db.collection('orders').add({

        ...orderData,

        originalPrice,

        terminalBasePrice:
         isTerminal
           ? terminalBasePrice
           : 0,

        amountPaid:
          customerPays,

        walletUsed,

        voucherDiscount:
          voucherCost,

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

        // terminal fields

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
          admin.firestore.FieldValue.serverTimestamp()

       
      });

    // =========================
    // TERMINAL SHIPMENT
    // =========================

   if (isTerminal) {

     try {

       console.log(
         'Terminal courier selected. Arranging shipment...',
         {
           orderId: orderRef.id,
           rateId: orderData.rateId
         }
       );

       // Validate rateId before calling Terminal
       if (!orderData.rateId) {

         await orderRef.update({

           status:
             'terminal_arrangement_failed',

           terminalStatus:
             'failed',

           terminalError:
             'Missing Terminal rate ID',

           terminalUpdatedAt:
             admin.firestore.FieldValue.serverTimestamp()

         });

         return res.status(400).json({

           success: false,

           error:
             'Terminal rate ID is missing.'

         });

       }


       const terminalResult =
         await arrangeTerminalShipment({

           orderId:
             orderRef.id,

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
       // TERMINAL ARRANGEMENT FAILED
       // =========================

       if (
         !terminalResult ||
         !terminalResult.success
       ) {

         const refundAmount = customerPays;

         await orderRef.update({

           status:
             'terminal_arrangement_failed',

           paymentStatus:
            'refunded',

           terminalStatus:
             'failed',

           terminalError:
             terminalResult?.message ||
             'Unable to arrange Terminal shipment.',

           terminalUpdatedAt:
             admin.firestore.FieldValue.serverTimestamp(),

           refundAmount,

           refundStatus:
             'completed',

           refundedAt:
             admin.firestore.FieldValue.serverTimestamp()

         });

         if (refundAmount > 0) {
            await userRef.set({

              walletBalance:
                admin.firestore.FieldValue.increment(
                  refundAmount
                ),

              walletLastUpdated:
                admin.firestore.FieldValue.serverTimestamp()
            }, {
              merge: true
            });

            await db
              .collection('wallet_transactions')
              .add({

                userId:
                  orderData.userId,

                type:
                  'refund',

                amount:
                  refundAmount,

                description:
                  'Terminal shipment arrangement failed. Payment refunded to wallet.',

                orderId:
                  orderRef.id,

                createdAt:
                  admin.firestore.FieldValue.serverTimestamp()

              });
         }

         return res.status(502).json({

           success: false,

           error:
             'Payment succeeded but Terminal shipment arrangement failed. Your payment has been refunded',

           orderId:
             orderRef.id,
          
           refunded:
             true,

           refundAmount

         });

       }


       // =========================
       // SAVE TERMINAL DETAILS
       // =========================

       await orderRef.update({

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
           admin.firestore.FieldValue.serverTimestamp()

       });


     } catch (terminalError) {

       console.error(
         'Terminal arrangement failed:',
         terminalError.response?.data ||
         terminalError.message
       );

       const refundAmount = customerPays;


       await orderRef.update({

         status:
           'terminal_arrangement_failed',

         terminalStatus:
           'failed',

         terminalError:
           terminalError.response?.data?.message ||
           terminalError.message ||
           'Terminal arrangement failed.',

         terminalUpdatedAt:
           admin.firestore.FieldValue.serverTimestamp(),

         paymentStatus:
           'refunded',

         refundAmount,

         refundStatus:
           'completed',

         refundedAt:
           admin.firestore.FieldValue.serverTimestamp()

       });

       if (refundAmount > 0) {

         await userRef.set({

           walletBalance:
             admin.firestore.FieldValue.increment(
              refundAmount
             ),

           walletLastUpdated:
             admin.firestore.FieldValue.serverTimestamp()

         }, {
           merge: true
         });

         await db 
           .collection('wallet_transactions')
           .add({

             userId:
               orderData.userId,

             type:
               'refund',

             amount:
               refundAmount,

             description:
               'Terminal shipment arrangement failed. Payment refunded to wallet',

             orderId:
               orderRef.id,

             createdAt:
               admin.firestore.FieldValue.serverTimestamp()

           });
       }


       return res.status(502).json({

         success: false,

         error:
           'Payment succeeded, but the Terminal shipment could not be arranged.',

         orderId:
           orderRef.id

       });

     }

   }



    // deduct customer wallet
    if (walletUsed> 0) {
      await userRef.update({
        walletBalance:
          admin.firestore.FieldValue.increment(-walletUsed)
      });
      await db.collection('wallet_transactions').add({
        userId: orderData.userId,
        type: 'debit',
        amount: walletUsed,
        description: 'Wallet payment',
        orderId: orderRef.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    if (orderData.userId) {
      await db
        .collection('users')
        .doc(orderData.userId)
        .set(
          {
            hasPlacedFirstOrder: true
          },
          {
            merge: true
          }
        );
    }

    if (orderData.voucherCode) {
      await db
        .collection('vouchers')
        .doc(orderData.voucherCode)
        .update({
          timesUsed:
            admin.firestore.FieldValue.increment(1)
        });
    }

    // =========================
    // UPDATE DRIVER WALLET ONLY FOR TUNNELMOUTH COURIERS
    // =========================
    if (isTunnelMouth) {

      const courierRef =
        db.collection('couriers_live')
          .doc(orderData.courierId);

      const courierSnap =
        await courierRef.get();

      if (courierSnap.exists) {
        await courierRef.update({
          walletBalance:
            admin.firestore.FieldValue.increment(
              driverEarning
            ),

          totalEarned:
            admin.firestore.FieldValue.increment(
              driverEarning
            ),

          totalDeliveries:
            admin.firestore.FieldValue.increment(
              1
            )
        });

        await db
          .collection('wallet_transactions')
          .add({

            userId:
              orderData.courierId,

            type:
              'credit',

            amount:
              driverEarning,

            description:
              'Delivery payment received',

            orderId:
              orderRef.id,

            createdAt:
              admin.firestore.FieldValue.serverTimestamp()
          });
      }
    }

    // =========================
    // SUCCESS RESPONSE
    // =========================
    return res.json({
      success: true,
      orderId: orderRef.id,
      courierType: orderData.courierType || 'tunnelmouth'
    });

  } catch (err) {

    console.error("FULL ERROR");
    console.error(err);

    
    console.error("CODE:",err.code);
    console.error("MESSAGE:", err.message)
    console.error("DETAILS:", err.details)
    console.error("METADATA:", err.metadata?.getMap?.());

    return res.status(500).json({
      success: false,
      message: "Internal server error"
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
                  'terminal_arrangement_failed',

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

    const orderSnap =
      await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const order =
      orderSnap.data();

    // =========================
    // PREVENT DOUBLE DECLINE
    // =========================

    if (order.status === 'declined') {

      return res.json({
        success: true,
        alreadyDeclined: true
      });

    }

    // =========================
    // ONLY THE ASSIGNED COURIER
    // CAN DECLINE
    // =========================

    if (
      order.courierType === 'tunnelmouth' &&
      order.courierId !== courierId
    ) {

      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this order.'
      });

    }

    // =========================
    // CALCULATE REFUND
    // =========================

    const amountPaid =
      Number(order.amountPaid || 0);

    const walletUsed =
      Number(order.walletUsed || 0);

    const refundAmount =
      amountPaid + walletUsed;

    // =========================
    // MARK ORDER DECLINED
    // =========================

    await orderRef.update({

      status:
        'declined',

      paymentStatus:
        'refunded',

      declinedAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    // =========================
    // REVERSE TUNNELMOUTH
    // DRIVER EARNINGS ONLY
    // =========================

    if (
      order.courierType === 'tunnelmouth' &&
      Number(order.driverEarning || 0) > 0
    ) {

      const driverEarning =
        Number(order.driverEarning);

      const courierRef =
        db
          .collection('couriers_live')
          .doc(courierId);

      const courierSnap =
        await courierRef.get();

      if (courierSnap.exists) {

        await courierRef.update({

          walletBalance:
            admin.firestore.FieldValue.increment(
              -driverEarning
            ),

          totalEarned:
            admin.firestore.FieldValue.increment(
              -driverEarning
            ),

          totalDeliveries:
            admin.firestore.FieldValue.increment(-1)

        });

        const updatedCourier =
          await courierRef.get();

        if (
          Number(
            updatedCourier.data()?.totalDeliveries || 0
          ) < 0
        ) {

          await courierRef.update({
            totalDeliveries: 0
          });

        }

      }

      // Record driver reversal

      await db
        .collection('wallet_transactions')
        .add({

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
            admin.firestore.FieldValue.serverTimestamp()

        });

    }

    // =========================
    // REFUND CUSTOMER
    // =========================

    if (refundAmount > 0) {

      const userRef =
        db
          .collection('users')
          .doc(order.userId);

      await userRef.set({

        walletBalance:
          admin.firestore.FieldValue.increment(
            refundAmount
          ),

        walletLastUpdated:
          admin.firestore.FieldValue.serverTimestamp()

      }, {
        merge: true
      });

      // Record refund

      await db
        .collection('wallet_transactions')
        .add({

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
            admin.firestore.FieldValue.serverTimestamp()

        });

    }

    // =========================
    // SUCCESS
    // =========================

    return res.json({

      success:
        true,

      refundAmount,

      courierType:
        order.courierType || 'tunnelmouth'

    });

  } catch (err) {

    console.error(
      'Decline order error:',
      err
    );

    return res.status(500).json({

      success:
        false,

      message:
        err.message

    });

  }

});




router.post('/updateCourierRating', async (req, res) => {

  try {

    const { courierId } = req.body;

    if (!courierId) {
      return res.status(400).json({
        success: false,
        message: 'Missing courierId'
      });
    }

    const reviewsSnapshot = await db
      .collection('courier_reviews')
      .where('courierId', '==', courierId)
      .get();

    let totalReviews = reviewsSnapshot.size;
    let totalRating = 0;

    reviewsSnapshot.forEach(doc => {
      totalRating += Number(doc.data().rating || 0);
    });

    const averageRating =
      totalReviews > 0
        ? Number((totalRating / totalReviews).toFixed(1))
        : 0;

    await db
      .collection('couriers_live')
      .doc(courierId)
      .update({
        averageRating,
        totalReviews
      });

    return res.json({
      success: true,
      averageRating,
      totalReviews
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
    });

  }

});



module.exports = router;