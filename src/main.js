import { auth, db, rtdb } from './firebase.js';
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
import { getDatabase, ref, get, set, update, onValue } from "firebase/database";

// 這裡使用 rtdb 避免與 Firestore 的 db 撞名
let scannerInstance = null;
let currentUserId = null;
let isBingoInitialized = false;

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

    QRCode.toCanvas(document.getElementById('qr-canvas'), user.uid, {
      width: 160,
    });

    initUserData(user.uid);
    initBingoGame(user.uid);
    initLeaderboard();

    if (!scannerInstance) {
      scannerInstance = new Html5QrcodeScanner('reader', {
        fps: 10,
        qrbox: 250,
      });
      scannerInstance.render(onScanSuccess, () => {});
    }
  } else {
    currentUserId = null;
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
    
    const teamMap = {
      team_1: '第一小隊',
      team_2: '第二小隊',
      team_3: '第三小隊',
      team_4: '第四小隊',
      team_5: '第五小隊',
    };

    // 💡 關鍵修改：檢查賓果連線數（假設你的連線數變數叫做 currentLines 或 lines）
    // 如果你計算連線數的變數叫其他名字，可以替換掉下方判斷中的 currentLines
    const lines = window.currentBingoLines || 0; 
    const teamDisplayEl = document.getElementById('profile-team-display');

    if (lines >= 5) {
      // 達成 5 條線以上，才顯示真實小隊
      teamDisplayEl.innerText = `所屬小隊：${teamMap[data.teamId] || data.teamId}`;
    } else {
      // 未達成前，顯示鎖定或提示
      teamDisplayEl.innerText = `所屬小隊：🔒 達成 5 條賓果連線後解鎖`;
    }

    const scanCount = (data.scannedList || []).length;
    document.getElementById('stat-scan-count').innerText = scanCount;

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

function initBingoGame(userId) {
  let currentQuestions = Array(25).fill("靈魂共鳴題目");

  get(ref(rtdb, "config/bingo_questions")).then((questionsSnap) => {
    if (questionsSnap.exists()) {
      currentQuestions = questionsSnap.val();
    }
    setupListener();
  }).catch(() => {
    setupListener();
  });

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
      } else {
        if (input) input.disabled = false;
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
      lockBtn.style.marginTop = "15px";
      lockBtn.style.background = "#28a745";
      lockBtn.style.color = "#fff";
      lockBtn.style.padding = "10px";
      lockBtn.style.width = "100%";
      lockBtn.style.border = "none";
      lockBtn.style.borderRadius = "5px";
      lockBtn.style.cursor = "pointer";
      
      lockBtn.onclick = async () => {
        if (!bingoData.answers || bingoData.answers.some(a => !a)) {
          return alert("請把 25 格的答案都填滿才可以鎖定！");
        }
        if (confirm("答案鎖定後將無法修改，直到控制台重置，確定送出嗎？")) {
          await update(ref(rtdb, `users/${userId}/bingoData`), {
            answers: bingoData.answers,
            isLocked: true
          });
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
    if (pattern.every(index => matchedArray[index])) {
      lineCount++;
    }
  });
  return lineCount;
}

function updateTeamUnlockStatus(lines) {
  window.currentBingoLines = lines;

  if(window.currentUserId && typeof initUserData == 'function'){
    initUserData(window.currentUserId);
  }

  let teamInfoEl = document.getElementById("hidden-team-info");
  if (!teamInfoEl) {
    teamInfoEl = document.createElement("div");
    teamInfoEl.id = "hidden-team-info";
    teamInfoEl.style.cssText = "margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px; text-align: center; font-weight: bold;";
    const gameSection = document.getElementById('game-section');
    if (gameSection) gameSection.appendChild(teamInfoEl);
  }

  if (teamInfoEl) {
    if (lines >= 5) {
      teamInfoEl.innerHTML = `🏆 恭喜達成 ${lines} 條線！小隊已解鎖：<span style="color: #d9534f; font-size: 1.2rem;">神祕小隊</span>`;
      teamInfoEl.style.border = "2px solid #ffc107";
    } else {
      teamInfoEl.innerHTML = `🔒 目前已達成連線：${lines} / 5 條 (達成 5 條線即可解鎖神祕小隊)`;
      teamInfoEl.style.border = "1px dashed #ccc";
    }
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
      const teamMap = {
        team_1: '第一小隊 🦁',
        team_2: '第二小隊 🐯',
        team_3: '第三小隊 🦅',
        team_4: '第四小隊 🦊',
        team_5: '第五小隊 🐼',
      };
      const li = document.createElement('li');
      li.innerHTML = `<span>${
        teamMap[docSnap.id] || docSnap.id
      }</span> <strong>${data.score || 0} 分</strong>`;
      list.appendChild(li);
    });
  });
}

async function onScanSuccess(decodedText) {
  if (!currentUserId) return;
  if (decodedText === currentUserId) return alert("不能掃描自己！");

  const userRef = doc(db, 'users', currentUserId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return;

  const userData = userSnap.data();
  const scannedList = userData.scannedList || [];
  let isNewFriend = false;
  let points = 0;
  let newGoals = [...(userData.unlockedGoals || [])];

  if (!scannedList.includes(decodedText)) {
    isNewFriend = true;
    const newScannedList = [...scannedList, decodedText];
    const count = newScannedList.length;

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
    }
  }

  const mySnap = await get(ref(rtdb, `users/${currentUserId}/bingoData`));
  const targetSnap = await get(ref(rtdb, `users/${decodedText}/bingoData`));

  if (mySnap.exists() && targetSnap.exists()) {
    const myData = mySnap.val();
    const targetData = targetSnap.val();

    if (myData.isLocked && targetData.isLocked) {
      let updatedMatched = myData.matched || Array(25).fill(false);
      let hasNewMatch = false;

      for (let i = 0; i < 25; i++) {
        if (myData.answers[i] === targetData.answers[i] && myData.answers[i] !== "") {
          if (!updatedMatched[i]) {
            updatedMatched[i] = true;
            hasNewMatch = true;
          }
        }
      }

      if (hasNewMatch) {
        const lines = calculateBingoLines(updatedMatched);
        await update(ref(rtdb, `users/${currentUserId}/bingoData`), {
          matched: updatedMatched,
          lines: lines
        });
        alert("🎉 掃描成功！發現與對方的答案有重疊，賓果格子已點亮！");
        return;
      }
    }
  }

  if (isNewFriend) {
    alert(`🤝 成功解鎖新朋友！小隊獲得 +${points || 10} 積分！`);
  } else {
    alert('這位新朋友已經掃描過了哦！');
  }
}

onSnapshot(doc(db, 'gameStatus', 'global'), (docSnap) => {
  if (!docSnap.exists()) return;
  const status = docSnap.data();

  if (status.isBingoEnded) {
    const bingoGrid = document.getElementById('bingo-grid');
    if (bingoGrid) {
      bingoGrid.style.pointerEvents = 'none';
      bingoGrid.style.opacity = '0.5';
    }
  }

  if (status.isScanEnded) {
    const readerEl = document.getElementById('reader');
    if (readerEl) {
      readerEl.innerHTML =
        "<p style='text-align:center; color:#e74c3c; font-weight:bold; padding: 20px;'>📷 掃碼交友時間已截止！</p>";
    }
  }

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