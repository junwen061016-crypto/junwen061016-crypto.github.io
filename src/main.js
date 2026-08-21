import { auth, db, rtdb } from './firebase.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, query, orderBy, runTransaction,
} from 'firebase/firestore';
import { Html5QrcodeScanner } from 'html5-qrcode';
import QRCode from 'qrcode';
import { ref, get, set, update, onValue } from "firebase/database";


let scannerInstance = null;
let currentUserId = null;
let isBingoInitialized = false;
let ifScanProcessing = false;
let lastScannedId = null;
let lastScannedAt = 0;
const SCAN_COOLDOWN_MS = 3000;

const TEAM_MAP = {
  team_1: '第一小隊 🦁', team_2: '第二小隊 🐯', team_3: '第三小隊 🦅',
  team_4: '第四小隊 🦊', team_5: '第五小隊 🐼',
};

const ALL_GOALS = [
  '🌱 破冰者：初次啟航',
  '🥉 社交新星：結交第 1 位朋友',
  '🥈 破冰達人：結交 3 位朋友',
  '🥇 社交王者：結交 5 位朋友',
];

// --- 綁定靜態按鈕：不管 DOMContentLoaded 是否已經觸發過都能綁到 ---
function bindStaticButtons() {
  const loginBtn = document.getElementById('btn-login');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
      } catch (e) {
        console.error('登出失敗：', e);
        alert('登出失敗，請重新整理頁面再試一次');
      }
    });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindStaticButtons);
} else {
  bindStaticButtons();
}

async function ensureTeamDoc(teamId) {
  const teamRef = doc(db, 'teams', teamId);
  const snap = await getDoc(teamRef);
  if (!snap.exists()) {
    await setDoc(teamRef, { teamName: TEAM_MAP[teamId] || teamId, score: 0 });
  }
}

async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (!email || !password) return alert('請輸入完整資料');

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      const teams = ['team_1', 'team_2', 'team_3', 'team_4', 'team_5'];
      const randomTeam = teams[Math.floor(Math.random() * teams.length)];

      await setDoc(doc(db, 'users', res.user.uid), {
        email: email,
        teamId: randomTeam,
        teamRevealed: true,
        scannedList: [],
        unlockedGoals: ['🌱 破冰者：初次啟航'],
      });

      await set(ref(rtdb, `users/${res.user.uid}/bingoData`), {
        answers: Array(25).fill(""),
        isLocked: false,
        matched: Array(25).fill(false),
        lines: 0
      });

      // 確保排行榜一開始就看得到這個小隊
      await ensureTeamDoc(randomTeam);

    } catch (createErr) {
      alert('登入/註冊失敗：' + createErr.message);
    }
  }
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserId = user.uid;
    window.currentUserId = user.uid;
    isBingoInitialized = false;

    document.getElementById('login-section').style.display = 'none';
    document.getElementById('game-section').style.display = 'block';

    QRCode.toCanvas(document.getElementById('qr-canvas'), user.uid, { width: 160 });

    initUserData(user.uid);
    initBingoGame(user.uid);
    initLeaderboard();

    if (!scannerInstance) {
      scannerInstance = new Html5QrcodeScanner('reader', { fps: 10, qrbox: 250 });
      scannerInstance.render(onScanSuccess, () => {});
    }
  } else {
    currentUserId = null;
    window.currentUserId = null;
    isBingoInitialized = false;
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('game-section').style.display = 'none';
    if (scannerInstance) {
      scannerInstance.clear().catch((e) => console.error(e));
      scannerInstance = null;
    }
  }
});

function initUserData(uid) {
  const userRef = doc(db, 'users', uid);
  onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    document.getElementById('profile-email-display').innerText = data.email;

    const lines = window.currentBingoLines || 0;
    const teamDisplayEl = document.getElementById('profile-team-display');
    if (teamDisplayEl) {
      teamDisplayEl.innerText = lines >= 5
        ? `所屬小隊：${TEAM_MAP[data.teamId] || data.teamId}`
        : `所屬小隊：🔒 達成 5 條賓果連線後解鎖`;
    }

    document.getElementById('stat-scan-count').innerText = (data.scannedList || []).length;

    // --- 成就列表：永遠顯示全部項目，已達成才變藍色 ---
    const goalsEl = document.getElementById('goals-list');
    if (goalsEl) {
      const unlocked = data.unlockedGoals || [];
      goalsEl.innerHTML = '';
      ALL_GOALS.forEach((goal) => {
        const isUnlocked = unlocked.includes(goal);
        const li = document.createElement('li');
        li.className = isUnlocked ? 'badge unlocked' : 'badge locked';
        li.innerText = goal;
        li.style.cssText = `
          padding: 8px 12px; margin-bottom: 6px; border-radius: 6px;
          font-weight: bold; transition: all 0.3s;
          background: ${isUnlocked ? '#007bff' : '#e0e0e0'};
          color: ${isUnlocked ? '#fff' : '#888'};
        `;
        goalsEl.appendChild(li);
      });
    }
  }, (err) => console.error('讀取個人資料失敗：', err));
}

function initBingoGame(userId) {
  let currentQuestions = Array(25).fill("靈魂共鳴題目");

  get(ref(rtdb, "config/bingo_questions")).then((questionsSnap) => {
    if (questionsSnap.exists()) currentQuestions = questionsSnap.val();
    setupListener();
  }).catch(() => setupListener());

  function setupListener() {
    const userBingoRef = ref(rtdb, `users/${userId}/bingoData`);
    onValue(userBingoRef, (snapshot) => {
      let bingoData = snapshot.val();
      if (!bingoData) {
        bingoData = { answers: Array(25).fill(""), isLocked: false, matched: Array(25).fill(false), lines: 0 };
        set(userBingoRef, bingoData);
      }
      renderBingoBoardUI(currentQuestions, bingoData, userId);
    });
  }
}

function renderBingoBoardUI(questions, bingoData, userId) {
  let boardContainer = document.getElementById("bingo-grid");
  if (!boardContainer) return;

  if (!isBingoInitialized || boardContainer.children.length === 0) {
    boardContainer.innerHTML = "";
    boardContainer.style.display = "grid";
    boardContainer.style.gridTemplateColumns = "repeat(5, 1fr)";
    boardContainer.style.gap = "8px";

    questions.forEach((qText, index) => {
      const cell = document.createElement("div");
      cell.className = "bingo-cell-item";

      const title = document.createElement("div");
      title.className = "cell-title";
      title.innerText = qText;
      title.style.fontSize = "11px";
      title.style.fontWeight = "bold";
      cell.appendChild(title);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "cell-input";
      input.dataset.index = index;
      input.placeholder = "填答案";

      input.addEventListener("input", (e) => {
        if (!bingoData.answers) bingoData.answers = Array(25).fill("");
        bingoData.answers[index] = e.target.value.trim();
        update(ref(rtdb, `users/${userId}/bingoData`), { answers: bingoData.answers });
      });

      cell.appendChild(input);
      boardContainer.appendChild(cell);
    });
    isBingoInitialized = true;
  }

  const cells = boardContainer.children;
  questions.forEach((qText, index) => {
    if (cells[index]) {
      const cell = cells[index];
      const title = cell.querySelector(".cell-title");
      const input = cell.querySelector(".cell-input");

      if (title) title.innerText = qText;
      if (input && document.activeElement !== input) {
        input.value = (bingoData.answers && bingoData.answers[index]) ? bingoData.answers[index] : "";
      }

      if (bingoData.isLocked) {
        if (input) input.disabled = true;
        cell.style.background = "#e0e0e0";
      } else if (input) {
        input.disabled = false;
      }

      if (bingoData.matched && bingoData.matched[index]) {
        cell.style.background = "#ffeb3b";
        cell.style.boxShadow = "0 0 10px #ff9800";
      }
    }
  });

  let lockBtn = document.getElementById("btn-lock-bingo");
  const parentCard = boardContainer.closest(".card");

  if (!bingoData.isLocked) {
    if (!lockBtn && parentCard) {
      lockBtn = document.createElement("button");
      lockBtn.id = "btn-lock-bingo";
      lockBtn.innerText = "🔒 確認並鎖定賓果答案";
      lockBtn.style.cssText = "margin-top:15px; background:#28a745; color:#fff; padding:10px; width:100%; border:none; border-radius:5px; cursor:pointer;";
      lockBtn.onclick = async () => {
        if (!bingoData.answers || bingoData.answers.some(a => !a)) {
          return alert("請把 25 格的答案都填滿才可以鎖定！");
        }
        if (confirm("答案鎖定後將無法修改，直到控制台重置，確定送出嗎？")) {
          await update(ref(rtdb, `users/${userId}/bingoData`), { answers: bingoData.answers, isLocked: true });
          alert("答案鎖定成功！");
        }
      };
      parentCard.appendChild(lockBtn);
    }
    if (lockBtn) lockBtn.style.display = "block";
  } else if (lockBtn) {
    lockBtn.style.display = "none";
  }

  updateTeamUnlockStatus(bingoData.lines || 0);

  const bingoCountEl = document.getElementById('stat-bingo-count');
  if (bingoCountEl && bingoData.matched) {
    bingoCountEl.innerText = bingoData.matched.filter(Boolean).length;
  }
}

function calculateBingoLines(matchedArray) {
  const winningPatterns = [
    [0,1,2,3,4], [5,6,7,8,9], [10,11,12,13,14], [15,16,17,18,19], [20,21,22,23,24],
    [0,5,10,15,20], [1,6,11,16,21], [2,7,12,17,22], [3,8,13,18,23], [4,9,14,19,24],
    [0,6,12,18,24], [4,8,12,16,20]
  ];
  let lineCount = 0;
  winningPatterns.forEach(pattern => {
    if (pattern.every(index => matchedArray[index])) lineCount++;
  });
  return lineCount;
}

function updateTeamUnlockStatus(lines) {
  window.currentBingoLines = lines;
  if (window.currentUserId) initUserData(window.currentUserId);

  let teamInfoEl = document.getElementById("hidden-team-info");
  if (!teamInfoEl) {
    teamInfoEl = document.createElement("div");
    teamInfoEl.id = "hidden-team-info";
    teamInfoEl.style.cssText = "margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px; text-align: center; font-weight: bold;";
    const gameSection = document.getElementById('game-section');
    if (gameSection) gameSection.appendChild(teamInfoEl);
  }
  if (lines >= 5) {
    teamInfoEl.innerHTML = `🏆 恭喜達成 ${lines} 條線！小隊已解鎖：<span style="color:#d9534f;font-size:1.2rem;">神祕小隊</span>`;
    teamInfoEl.style.border = "2px solid #ffc107";
  } else {
    teamInfoEl.innerHTML = `🔒 目前已達成連線：${lines} / 5 條 (達成 5 條線即可解鎖神祕小隊)`;
    teamInfoEl.style.border = "1px dashed #ccc";
  }
}

function initLeaderboard() {
  const q = query(collection(db, 'teams'), orderBy('score', 'desc'));
  onSnapshot(q, (snapshot) => {
    const list = document.getElementById('leaderboard');
    if (!list) return;
    list.innerHTML = '';
    if (snapshot.empty) {
      list.innerHTML = '<li>目前尚無積分紀錄</li>';
      return;
    }
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const li = document.createElement('li');
      li.innerHTML = `<span>${TEAM_MAP[docSnap.id] || docSnap.id}</span> <strong>${data.score || 0} 分</strong>`;
      list.appendChild(li);
    });
  }, (err) => {
    console.error('讀取排行榜失敗：', err);
    const list = document.getElementById('leaderboard');
    if (list) list.innerHTML = '<li>排行榜載入失敗，請稍後再試</li>';
  });
}

async function onScanSuccess(decodedText) {
  if (!currentUserId) return;
  if (decodedText === currentUserId) return alert("不能掃描自己！");
  if (isScanProcessing) return;

  const now = Date.now();
  if(decodedText === lastScannedId && (now - lastScannedAt) < SCAN_COOLDOWN_MS){
    return;
  }

  isScanProcessing = true;
  lastScannedId = decodedText;
  lastScannedAt = now;

  try{
    await handleScanLogic(decodedText);
  }catch(err){
    console.error('掃描處理失敗:', err);
    alert('掃描時發生錯誤，請重新掃描一次!');
  }finally{
    isScanProcessing = false;
  }
}

async function handleScanLogic(decodedText) {
  const myUid = currentUserId;
  const otherUid = decodedText;

  const myRef = doc(db, 'users', myUid);
  const otherRef = doc(db, 'users', otherUid);

  const otherUserSnapCheck = await getDoc(otherRef);
  if (!otherUserSnapCheck.exists()) {
    return alert('掃描失敗：對方的帳號資料不存在！');
  }

  let resultMessage = '';

  try {
    await runTransaction(db, async (transaction) => {
      const mySnap = await transaction.get(myRef);
      const otherSnap = await transaction.get(otherRef);

      if (!mySnap.exists() || !otherSnap.exists()) {
        throw new Error('使用者資料不存在');
      }

      const myData = mySnap.data();
      const otherData = otherSnap.data();

      const myScanned = myData.scannedList || [];

      if (myScanned.includes(otherUid)) {
        resultMessage = '這位新朋友已經掃描過了哦！';
        return;
      }

      const newMyScanned = [...myScanned, otherUid];
      const newOtherScanned = [...(otherData.scannedList || []), myUid];

      const myResult = computeGoalsAndPoints(myData.unlockedGoals || [], newMyScanned.length);
      const otherResult = computeGoalsAndPoints(otherData.unlockedGoals || [], newOtherScanned.length);

      transaction.update(myRef, {
        scannedList: newMyScanned,
        unlockedGoals: myResult.goals,
      });
      transaction.update(otherRef, {
        scannedList: newOtherScanned,
        unlockedGoals: otherResult.goals,
      });

      // 先把「小隊 -> 要加的分數」彙整起來，同隊的話分數會自動加總，
      // 避免對同一份小隊文件 get() 兩次
      const teamPointsMap = {};
      if (myData.teamId) {
        teamPointsMap[myData.teamId] = (teamPointsMap[myData.teamId] || 0) + myResult.points;
      }
      if (otherData.teamId) {
        teamPointsMap[otherData.teamId] = (teamPointsMap[otherData.teamId] || 0) + otherResult.points;
      }

      for (const teamId of Object.keys(teamPointsMap)) {
        const teamRef = doc(db, 'teams', teamId);
        const teamSnap = await transaction.get(teamRef);
        const currentScore = teamSnap.exists() ? (teamSnap.data().score || 0) : 0;
        transaction.set(teamRef, {
          score: currentScore + teamPointsMap[teamId],
          teamName: TEAM_MAP[teamId],
        }, { merge: true });
      }

      resultMessage = `🤝 成功解鎖新朋友！你和對方的小隊都獲得了積分！`;
    });
  } catch (err) {
    console.error('交友交易失敗：', err);
    alert('掃描時發生錯誤，請重新掃描一次！');
    return;
  }

  // --- 賓果比對邏輯（維持原本，只影響掃描者自己） ---
  const mySnap = await get(ref(rtdb, `users/${myUid}/bingoData`));
  const targetSnap = await get(ref(rtdb, `users/${otherUid}/bingoData`));

  if (mySnap.exists() && targetSnap.exists()) {
    const myBingoData = mySnap.val();
    const targetBingoData = targetSnap.val();

    if (myBingoData.isLocked && targetBingoData.isLocked) {
      let updatedMatched = myBingoData.matched || Array(25).fill(false);
      let otherUpdatedMatched = targetBingoData.matched || Array(25).fill(false);
      let hasNewMatch = false;

      for (let i = 0; i < 25; i++) {
        if (myBingoData.answers[i] === targetBingoData.answers[i] && myBingoData.answers[i] !== "") {
          if (!updatedMatched[i]) {
            updatedMatched[i] = true;
            hasNewMatch = true;
          }
          if (!otherUpdatedMatched[i]) {
            otherUpdatedMatched[i] = true;
          }
        }
      }

      if (hasNewMatch) {
        const myLines = calculateBingoLines(myUpdateMatched);
        const otherLines = calculateBingoLines(otherUpdatedMatched);

        await Promise.all([
          update(ref(rtdb,'user/${myUid}/bingoData'),{matched: myUpdateMatched, lines: myLines}),
          update(ref(rtdb,'user/${otherUid}/bingoData'),{matched: otherUpdateMatched, lines: otherLines})
        ]);

        alert("掃描成功!(噴花 噴花");
        return;
      }
    }
  }

  alert(resultMessage);
}

// 計算成就清單與這次獲得的積分（純函式，不做任何 Firestore 寫入）
function computeGoalsAndPoints(currentGoals, newFriendCount) {
  let goals = [...currentGoals];
  let points = 50; // 每次成功交友的基本分

  if (newFriendCount === 1 && !goals.includes('🥉 社交新星：結交第 1 位朋友')) {
    goals.push('🥉 社交新星：結交第 1 位朋友');
    points += 10;
  } else if (newFriendCount === 3 && !goals.includes('🥈 破冰達人：結交 3 位朋友')) {
    goals.push('🥈 破冰達人：結交 3 位朋友');
    points += 30;
  } else if (newFriendCount === 5 && !goals.includes('🥇 社交王者：結交 5 位朋友')) {
    goals.push('🥇 社交王者：結交 5 位朋友');
    points += 50;
  }

  return { goals, points };
}

// --- 全域賽事狀態監聽：新增邊緣觸發彈窗 + 可逆的 UI 開關 ---
let prevBingoEnded = false;
let prevScanEnded = false;

function ensureScanOverlay() {
  let overlay = document.getElementById('scan-ended-overlay');
  const readerEl = document.getElementById('reader');
  if (!overlay && readerEl && readerEl.parentNode) {
    overlay = document.createElement('p');
    overlay.id = 'scan-ended-overlay';
    overlay.style.cssText = "text-align:center; color:#e74c3c; font-weight:bold; padding:20px; display:none;";
    overlay.innerText = "📷 掃碼交友時間已截止！";
    readerEl.parentNode.insertBefore(overlay, readerEl.nextSibling);
  }
  return overlay;
}

onSnapshot(doc(db, 'gameStatus', 'global'), (docSnap) => {
  if (!docSnap.exists()) return;
  const status = docSnap.data();

  // 賓果遊戲開關（可逆）
  const bingoGrid = document.getElementById('bingo-grid');
  if (bingoGrid) {
    bingoGrid.style.pointerEvents = status.isBingoEnded ? 'none' : '';
    bingoGrid.style.opacity = status.isBingoEnded ? '0.5' : '';
  }
  if (status.isBingoEnded && !prevBingoEnded) alert('🎯 賓果遊戲時間已結束！');
  prevBingoEnded = !!status.isBingoEnded;

  // 掃碼交友開關（可逆，不破壞掃描器 DOM）
  const overlay = ensureScanOverlay();
  const readerEl = document.getElementById('reader');
  if (overlay && readerEl) {
    overlay.style.display = status.isScanEnded ? 'block' : 'none';
    readerEl.style.display = status.isScanEnded ? 'none' : 'block';
  }
  if (status.isScanEnded && !prevScanEnded) alert('📷 掃碼交友時間已截止！');
  prevScanEnded = !!status.isScanEnded;

  // 最終結算（可逆）
  const gameSection = document.getElementById('game-section');
  let finalDiv = document.getElementById('final-screen');
  if (status.isFinalResult) {
    if (gameSection) gameSection.style.display = 'none';
    if (!finalDiv) {
      finalDiv = document.createElement('div');
      finalDiv.id = 'final-screen';
      finalDiv.className = 'card';
      finalDiv.innerHTML = `
        <h1 style="color:#e74c3c;text-align:center;">🏆 靈魂共鳴大賽・最終結算</h1>
        <p style="text-align:center;font-size:1.1rem;">活動圓滿結束！請看大螢幕揭曉最終冠軍小隊！</p>
      `;
      document.body.appendChild(finalDiv);
    }
    finalDiv.style.display = 'block';
  } else {
    if (finalDiv) finalDiv.style.display = 'none';
    if (gameSection && currentUserId) gameSection.style.display = 'block';
  }
}, (err) => console.error('讀取賽事狀態失敗：', err));