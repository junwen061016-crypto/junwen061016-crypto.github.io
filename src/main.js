import { auth, db } from './firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
} from 'firebase/firestore';
import { Html5QrcodeScanner } from 'html5-qrcode';
import QRCode from 'qrcode';

let scannerInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document
    .getElementById('btn-logout')
    .addEventListener('click', () => signOut(auth));
});

async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert('請輸入完整資料');

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      const teams = ['team_1', 'team_2', 'team_3'];
      const randomTeam = teams[Math.floor(Math.random() * teams.length)];

      await setDoc(doc(db, 'users', res.user.uid), {
        email: email,
        teamId: randomTeam,
        teamRevealed: true,
        answers: new Array(25).fill(false),
        scannedList: [],
        unlockedGoals: ['🌱 破冰者：初次啟航'],
      });
    } catch (createErr) {
      alert('登入/註冊失敗：' + createErr.message);
    }
  }
}

// 監聽登入狀態並初始化資料與即時更新
onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('game-section').style.display = 'block';

    QRCode.toCanvas(document.getElementById('qr-canvas'), user.uid, {
      width: 160,
    });

    // 即時監聽個人資料、成就與賓果
    initUserData(user.uid);
    // 即時監聽排行榜
    initLeaderboard();

    if (!scannerInstance) {
      scannerInstance = new Html5QrcodeScanner('reader', {
        fps: 10,
        qrbox: 250,
      });
      scannerInstance.render(onScanSuccess, () => {});
    }
  } else {
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('game-section').style.display = 'none';
    if (scannerInstance) {
      scannerInstance.clear().catch((e) => console.error(e));
      scannerInstance = null;
    }
  }
});

// 即時同步個人檔案與成就
function initUserData(uid) {
  const userRef = doc(db, 'users', uid);
  onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    // 1. 更新個人檔案卡
    document.getElementById('profile-email-display').innerText = data.email;
    const teamMap = {
      team_1: '第一小隊',
      team_2: '第二小隊',
      team_3: '第三小隊',
      team_4: '第四小隊',
      team_5: '第五小隊',
    };
    document.getElementById('profile-team-display').innerText = `所屬小隊：${
      teamMap[data.teamId] || data.teamId
    }`;

    const scanCount = (data.scannedList || []).length;
    const bingoCount = (data.answers || []).filter(Boolean).length;
    document.getElementById('stat-scan-count').innerText = scanCount;
    document.getElementById('stat-bingo-count').innerText = bingoCount;

    // 2. 渲染 5x5 賓果
    renderBingo(data.answers || new Array(25).fill(false), uid);

    // 3. 渲染解鎖成就清單
    const goalsEl = document.getElementById('goals-list');
    goalsEl.innerHTML = '';
    (data.unlockedGoals || []).forEach((goal) => {
      const li = document.createElement('li');
      li.className = 'badge';
      li.innerText = goal;
      goalsEl.appendChild(li);
    });
  });
}

// 渲染 5x5 賓果方格
function renderBingo(answers, uid) {
  const grid = document.getElementById('bingo-grid');
  grid.innerHTML = '';
  answers.forEach((checked, idx) => {
    const cell = document.createElement('div');
    cell.className = `bingo-cell ${checked ? 'matched' : ''}`;
    cell.innerText = `話題 #${idx + 1}`;
    cell.onclick = async () => {
      const newAnswers = [...answers];
      newAnswers[idx] = !newAnswers[idx];
      await updateDoc(doc(db, 'users', uid), { answers: newAnswers });
    };
    grid.appendChild(cell);
  });
}

// 即時小隊排行榜
function initLeaderboard() {
  const q = query(collection(db, 'teams'), orderBy('score', 'desc'));
  onSnapshot(q, (snapshot) => {
    const list = document.getElementById('leaderboard');
    list.innerHTML = '';
    if (snapshot.empty) {
      list.innerHTML = '<li>目前尚無積分紀錄</li>';
      return;
    }
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const teamMap = {
        team_1: '第一小隊 🦁',
        team_2: '第二小隊 🐯',
        team_3: '第三小隊 🦅',
      };
      const li = document.createElement('li');
      li.innerHTML = `<span>${
        teamMap[docSnap.id] || docSnap.id
      }</span> <strong>${data.score || 0} 分</strong>`;
      list.appendChild(li);
    });
  });
}

// 掃描成功：階段性成就與小隊加分
async function onScanSuccess(decodedText) {
  const currentUid = auth.currentUser.uid;
  if (decodedText === currentUid) return;

  const userRef = doc(db, 'users', currentUid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const userData = userSnap.data();
  const scannedList = userData.scannedList || [];
  if (scannedList.includes(decodedText)) {
    alert('這位新朋友已經解鎖過了哦！');
    return;
  }

  const newScannedList = [...scannedList, decodedText];
  const count = newScannedList.length;
  let newGoals = [...(userData.unlockedGoals || [])];
  let points = 0;

  if (count === 1 && !newGoals.includes('🥉 社交新星：結交第 1 位朋友')) {
    newGoals.push('🥉 社交新星：結交第 1 位朋友');
    points = 10;
  } else if (count === 3 && !newGoals.includes('🥈 破冰達人：結交 3 位朋友')) {
    newGoals.push('🥈 破冰達人：結交 3 位朋友');
    points = 30;
  } else if (count === 5 && !newGoals.includes('🥇 社交王者：結交 5 位朋友')) {
    newGoals.push('🥇 社交王者：結交 5 位朋友');
    points = 50;
  }

  await updateDoc(userRef, {
    scannedList: newScannedList,
    unlockedGoals: newGoals,
  });

  if (points > 0 && userData.teamId) {
    const teamRef = doc(db, 'teams', userData.teamId);
    const teamSnap = await getDoc(teamRef);
    const currentScore = teamSnap.exists() ? teamSnap.data().score || 0 : 0;
    await setDoc(teamRef, { score: currentScore + points }, { merge: true });
    alert(`🎉 恭喜解鎖新成就！小隊獲得 +${points} 積分！`);
  } else {
    alert('成功解鎖新朋友！');
  }
}

// 三階段開關即時監聽
onSnapshot(doc(db, 'gameStatus', 'global'), (docSnap) => {
  if (!docSnap.exists()) return;
  const status = docSnap.data();

  // 1. 如果賓果結束：鎖定 5x5 賓果格子，不能再點擊
  if (status.isBingoEnded) {
    const bingoGrid = document.getElementById('bingo-grid');
    if (bingoGrid) {
      bingoGrid.style.pointerEvents = 'none';
      bingoGrid.style.opacity = '0.5';
    }
  }

  // 2. 如果掃碼結束：關閉相機掃描器
  if (status.isScanEnded) {
    const readerEl = document.getElementById('reader');
    if (readerEl) {
      readerEl.innerHTML =
        "<p style='text-align:center; color:#e74c3c; font-weight:bold; padding: 20px;'>📷 掃碼交友時間已截止！</p>";
    }
  }

  // 3. 如果進入最終結算：隱藏遊戲畫面，顯示全場結算提示
  if (status.isFinalResult) {
    const gameSection = document.getElementById('game-section');
    if (gameSection) gameSection.style.display = 'none';

    let finalDiv = document.getElementById('final-screen');
    if (!finalDiv) {
      finalDiv = document.createElement('div');
      finalDiv.id = 'final-screen';
      finalDiv.className = 'card';
      finalDiv.innerHTML = `
        <h1 style="color: #e74c3c; text-align: center;">🏆 靈魂共鳴大賽・最終結算</h1>
        <p style="text-align: center; font-size: 1.1rem;">活動圓滿結束！請看大螢幕揭曉最終冠軍小隊！</p>
      `;
      document.body.appendChild(finalDiv);
    }
    finalDiv.style.display = 'block';
  }
});
