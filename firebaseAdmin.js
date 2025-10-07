// Firebase Admin SDK setup for backend
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://bms-pro-e3125.firebaseio.com',
  storageBucket: 'bms-pro-e3125.appspot.com',
});

module.exports = admin;
