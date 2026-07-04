const admin = require('firebase-admin');

const processedKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
console.log('Processed key starts:', processedKey.slice(0, 30));
console.log('Processed key ends:', JSON.stringify(processedKey.slice(-40)));
console.log('Processed key line count:', processedKey.split('\n').length);


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


module.exports = {
  admin,
  db
};
