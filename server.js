require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


// 🔥 INIT FIREBASE ADMIN
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();


// ✅ HEALTH CHECK
app.get('/', (req, res) => {
  res.send('Backend running 🚀');
});


// 💳 VERIFY PAYMENT + CREATE ORDER
app.post('/verify-payment', async (req, res) => {
  const { reference, orderData } = req.body;

  try {
    // 1️⃣ VERIFY PAYSTACK
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`
        }
      }
    );

    const payment = response.data.data;

    if (payment.status !== 'success') {
      return res.json({ success: false, message: "Payment not successful" });
    }

    // 2️⃣ VALIDATE INPUT
    if (!orderData || !orderData.courierId) {
      return res.status(400).json({ error: "Courier not selected" });
    }

    const price = Number(orderData.price);

    if (!price || price <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // 💰 3️⃣ CALCULATE BUSINESS LOGIC
    const platformFee = Math.floor(price * 0.05) + 500;
    const driverEarning = price - platformFee;

    // 4️⃣ CHECK COURIER AVAILABILITY
    const courierRef = db.collection('couriers_live').doc(orderData.courierId);
    const courierSnap = await courierRef.get();

    if (!courierSnap.exists || courierSnap.data().available === false) {
      return res.status(400).json({ error: "Courier not available" });
    }

    // 5️⃣ CREATE ORDER
    const orderRef = await db.collection('orders').add({
      userId: orderData.userId,
      courierId: orderData.courierId,

      pickup: orderData.pickup,
      dropoff: orderData.dropoff,

      pickupCoords: orderData.pickupCoords || null,
      dropoffCoords: orderData.dropoffCoords || null,

      price: price,

      // 💰 FINANCIAL BREAKDOWN
      platformFee: platformFee,
      driverEarning: driverEarning,

      status: "assigned",
      createdAt: new Date()
    });

    // 6️⃣ MARK COURIER AS BUSY
    await courierRef.update({
      available: false
    });

    // 7️⃣ SEND PUSH NOTIFICATION
    const courier = courierSnap.data();

    if (courier?.pushToken) {
      await axios.post('https://exp.host/--/api/v2/push/send', {
        to: courier.pushToken,
        title: "New Delivery Assigned 🚚",
        body: `${orderData.pickup} → ${orderData.dropoff}`
      });
    }

    // ✅ SUCCESS RESPONSE
    return res.json({
      success: true,
      orderId: orderRef.id,
      breakdown: {
        price,
        platformFee,
        driverEarning
      }
    });

  } catch (error) {
    console.log("ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});


// 💰 DRIVER WITHDRAWAL REQUEST (optional but useful)
app.post('/payout', async (req, res) => {
  const { courierId, amount } = req.body;

  try {
    if (!courierId || !amount) {
      return res.status(400).json({ error: "Missing data" });
    }

    await db.collection('withdrawals').add({
      courierId,
      amount,
      status: "pending",
      createdAt: new Date()
    });

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});


// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});