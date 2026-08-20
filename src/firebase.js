import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 你的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyCAvKqi10XSSVGDAHPrLb-cN-_h6XYFtW4",
  authDomain: "break-the-ice-fa6cf.firebaseapp.com",
  projectId: "break-the-ice-fa6cf",
  storageBucket: "break-the-ice-fa6cf.firebasestorage.app",
  messagingSenderId: "174016834092",
  appId: "1:174016834092:web:9eba73e3c1a9f070ac7f89",
  measurementId: "G-NRP4PJQGF1",
  databaseURL: "https://break-the-ice-fa6cf-default-rtdb.asia-southeast1.firebasedatabase.app"
}

// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 匯出我們遊戲需要的 Auth 與 Firestore 功能
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);