const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const db = admin.firestore();

// ===== TEMPORARY TEST =====
(async () => {
  try {
    const snap = await db.collection('users').limit(1).get();
    console.log("✅ READ SUCCESS:", snap.size);
  } catch (e) {
    console.error("❌ READ FAILED");
    console.error(e);
  }

  try {
    await db.collection('test').doc('ping').set({
      hello: 'world'
    });
    console.log("✅ WRITE SUCCESS");
  } catch (e) {
    console.error("❌ WRITE FAILED");
    console.error(e);
  }
})();
// ==========================

module.exports = {
  admin,
  db
};