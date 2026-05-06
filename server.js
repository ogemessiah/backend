require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET;


// 🔥 INIT FIREBASE ADMIN
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();


// ✅ HEALTH CHECK (important for deployment)
app.get('/', (req, res) => {
  res.send('Backend running 🚀');
});


// 💳 VERIFY PAYMENT + CREATE ORDER (MANUAL COURIER)
app.post('/verify-payment', async (req, res) => {
  const { reference, orderData } = req.body;

  try {
    // 1️⃣ VERIFY PAYSTACK PAYMENT
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    const payment = response.data.data;

    if (payment.status !== 'success') {
      return res.json({ success: false, message: "Payment not successful" });
    }

    // 2️⃣ VALIDATE DATA
    if (!orderData || !orderData.courierId) {
      return res.status(400).json({ error: "Courier not selected" });
    }

    // 3️⃣ CHECK IF COURIER IS STILL AVAILABLE
    const courierRef = db.collection('couriers_live').doc(orderData.courierId);
    const courierSnap = await courierRef.get();

    if (!courierSnap.exists || courierSnap.data().available === false) {
      return res.status(400).json({ error: "Courier no longer available" });
    }

    // 4️⃣ CREATE ORDER
    const orderRef = await db.collection('orders').add({
      userId: orderData.userId,
      courierId: orderData.courierId,
      pickup: orderData.pickup,
      dropoff: orderData.dropoff,
      pickupCoords: orderData.pickupCoords || null,
      dropoffCoords: orderData.dropoffCoords || null,
      price: Number(orderData.price),
      driverEarning: Math.floor(Number(orderData.price) * 0.9),
      status: "assigned",
      createdAt: new Date()
    });

    // 5️⃣ MARK DRIVER AS BUSY
    await courierRef.update({
      available: false
    });

    // 6️⃣ GET DRIVER PUSH TOKEN
    const courier = courierSnap.data();

    // 7️⃣ SEND PUSH NOTIFICATION (Expo)
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
      orderId: orderRef.id
    });

  } catch (error) {
    console.log("ERROR:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});


// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});