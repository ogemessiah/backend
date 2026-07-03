const admin = require('firebase-admin');



admin.initializeApp({

  credential:
    admin.credential.cert({

      projectId:
        process.env.FIREBASE_PROJECT_ID,

      clientEmail:
        process.env.FIREBASE_CLIENT_EMAIL,

      privateKey:
        process.env.FIREBASE_PRIVATE_KEY
          .replace(/\\n/g, '\n')
    })
});

const db =
  admin.firestore();
(async () => {
  try{
    const collections = await db.listCollections();
    console.log("firestore connected");
    console.log("Collections:", collections.map( c => c.id));
  }catch (e) {
    console.error("firestore connection failed");
    console.error(e);
  }
})();

module.exports = {
  admin,
  db
};