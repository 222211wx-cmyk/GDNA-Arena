importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyDgro5MZqUTSrOzgJPRlEgve2j-88TDnFQ",
  authDomain: "helixly-b7653.firebaseapp.com",
  projectId: "helixly-b7653",
  storageBucket: "helixly-b7653.firebasestorage.app",
  messagingSenderId: "630195919424",
  appId: "1:630195919424:web:1693e46da2370942115da5"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "مكالمة جديدة";
  const options = { body: payload.notification?.body || "مكالمة فيديو فائتة", icon: "/icon.png" };
  self.registration.showNotification(title, options);
});