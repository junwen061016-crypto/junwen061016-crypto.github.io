// ==========================================
// 1. Firebase 與第三方套件引入 (CDN 完整路徑，適用於 GitHub Pages)
// ==========================================
import { auth, db, rtdb } from "./firebase.js";
import { 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  deleteDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  update, 
  onValue 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

import { Html5QrcodeScanner } from 'https://esm.run/html5-qrcode';
import QRCode from 'https://esm.run/qrcode';

// ==========================================
// 2. 全域變數定義
// ==========================================
let currentUserId = null;
let isBingoInitialized = false;
let scannerInstance = null;
window.currentUserUid = null;     // 供小隊解鎖同步使用
window.currentBingoLines = 0;     // 記錄目前的賓果連線數

// 全域設定文件參照 (Firestore)
const globalRef = doc(db, 'settings', 'global'); 

// ==========================================
// 3. 監聽全域賽事狀態（支援後台重啟賓果、結束遊戲與最終結算）
// ==========================================
let lastResetTime = null; // 確保第一次讀取時能正確初始化

onSnapshot(globalRef, (docSnap) => {
  if (!docSnap.exists()) return;
  const status = docSnap.data();
  console.log("偵測到 Firestore 全域狀態變化:", status);

  // 初始化時記錄當下的 bingoResetAt，避免剛重新整理頁面就誤觸重置
  if (lastResetTime === null) {
    lastResetTime = status.bingoResetAt || 0;
    return;
  }

  // 檢查後台是否有發動「重新填寫/重啟賓果」的新時間戳記
  if (status.bingoResetAt && status.bingoResetAt !== lastResetTime) {
    lastResetTime = status.bingoResetAt;
    console.log("💡 偵測到新的重置時間戳記，準備完全清空與解鎖賓果！");

    if (currentUserId) {
      isBingoInitialized = false;

      // 寫入 RTDB：徹底回到初始狀態（清空答案、解除鎖定、歸零連線與匹配狀態）
      update(ref(rtdb, `users/${currentUserId}/bingoData`), {
        isLocked: false,
        answers: Array(25).fill(""),
        matched: Array(25).fill(false),
        lines: 0
      }).then(() => {
        window.currentBingoLines = 0;
        console.log("✨ 賓果遊戲已完全回到初始狀態！");
      }).catch((error) => {
        console.error("❌ 重置 RTDB 賓果失敗：", error);
      });
    }
  }

  // 處理「賓果遊戲結束」的畫面提示
  const bingoSection = document.getElementById("bingo-grid")?.closest(".card") || document.getElementById("game-section");
  if (status.isBingoEnded) {
    showGameNotice("bingo-notice", "🎯 賓果遊戲已結束！", bingoSection);
  } else {
    removeGameNotice("bingo-notice");
  }

  // 處理「掃碼交友結束」的畫面提示
  const scannerContainer = document.getElementById("reader");
  if (status.isScanEnded) {
    if (scannerContainer) scannerContainer.style.display = "none";
    showGameNotice("scan-notice", "📷 掃碼交友已結束！", document.getElementById("login-section")?.parentNode);
  } else {
    if (scannerContainer) scannerContainer.style.display = "block";
    removeGameNotice("scan-notice");
  }

  // 處理「最終結算」狀態
  if (status.isFinalResult) {
    document.body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f0f2f5; text-align: center; padding: 20px;">
        <h1 style="color: #333; font-size: 2.5rem;">🏆 賽事已進入最終結算</h1>
        <p style="color: #666; font-size: 1.2rem; margin-top: 10px;">感謝大家的熱情參與，請靜候頒獎與最終結果公布！</p>
      </div>
    `;
  }
});

// 輔助函式：動態顯示頂部提示條
function showGameNotice(id, message, parentElement) {
  let notice = document.getElementById(id);
  if (!notice && parentElement) {
    notice = document.createElement("div");
    notice.id = id;
    notice.style.cssText = "background: #ff4d4f; color: white; padding: 10px; text-align: center; font-weight: bold; margin-bottom: 10px; border-radius: 4px; z-index: 999;";
    parentElement.prepend(notice);
  }
  if (notice) notice.innerText = message;
}

// 輔助函式：移除提示條
function removeGameNotice(id) {
  const notice = document.getElementById(id);
  if (notice) notice.remove();
}

// ==========================================
// 4. 使用者登入狀態監聽
// ==========================================
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserId = user.uid;
    window.currentUserUid = user.uid;
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
    window.currentUserUid = null;
    isBingoInitialized = false;
    
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('game-section').style.display = 'none';
    
    if (scannerInstance) {
      scannerInstance.clear().catch((e) => console.error(e));
      scannerInstance = null;
    }
  }
});

// ==========================================
// 5. 初始化使用者資料與即時監聽
// ==========================================
function initUserData(uid) {
  const userRef = doc(db, 'users', uid);
  onSnapshot(userRef, (docSnap) => {
    if (!docSnap.exists()) return;
    const data = docSnap.data();

    const emailDisplay = document.getElementById('profile-email-display');
    if (emailDisplay) emailDisplay.innerText = data.email || '';
    
    const teamMap = {
      team_1: '第一小隊',
      team_2: '第二小隊',
      team_3: '第三小隊',
      team_4: '第四小隊',
      team_5: '第五小隊',
    };

    const lines = window.currentBingoLines || 0; 
    const teamDisplayEl = document.getElementById('profile-team-display');

    if (teamDisplayEl) {
      if (lines >= 5) {
        teamDisplayEl.innerText = `所屬小隊：${teamMap[data.teamId] || data.teamId}`;
      } else {
        teamDisplayEl.innerText = `所屬小隊：🔒 達成 5 條賓果連線後解鎖`;
      }
    }

    const scanCountEl = document.getElementById('stat-scan-count');
    if (scanCountEl) {
      scanCountEl.innerText = (data.scannedList || []).length;
    }

    const goalsEl = document.getElementById('goals-list');
    if (goalsEl) {
      goalsEl.innerHTML = '';
      (data.unlockedGoals || []).forEach((goal) => {
        const li = document.createElement('li');
        li.className = 'badge';
        li.innerText = goal;
        goalsEl.appendChild(li);
      });
    }
  });
}

// ==========================================
// 6. 初始化賓果遊戲與即時讀取 RTDB 題目 (config/bingo_questions)
// ==========================================
function initBingoGame(uid) {
  // 對齊後台儲存的 Realtime Database 路徑
  const questionsRef = ref(rtdb, "config/bingo_questions");
  
  onValue(questionsRef, (snapshot) => {
    let questions = [];
    if (snapshot.exists()) {
      questions = snapshot.val();
    } else {
      questions = Array(25).fill("預設題目");
    }

    const userBingoRef = ref(rtdb, `users/${uid}/bingoData`);
    onValue(userBingoRef, (userSnap) => {
      let bingoData = userSnap.val();
      if (!bingoData) {
        bingoData = {
          answers: Array(25).fill(""),
          isLocked: false,
          matched: Array(25).fill(false),
          lines: 0
        };
        set(userBingoRef, bingoData);
      }
      
      window.currentBingoLines = bingoData.lines || 0;
      renderBingoBoardUI(questions, bingoData, uid);
    });
  });
}

// ==========================================
// 7. 渲染 5x5 賓果盤介面
// ==========================================
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
        cell.style.background = ""; 
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

// ==========================================
// 8. 更新小隊解鎖狀態介面
// ==========================================
function updateTeamUnlockStatus(lines) {
  window.currentBingoLines = lines;
  if (window.currentUserUid && typeof initUserData === 'function') {
    initUserData(window.currentUserUid);
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

// ==========================================
// 9. 掃碼成功回呼函式
// ==========================================
function onScanSuccess(decodedText) {
  console.log("掃描成功：", decodedText);
}

// ==========================================
// 10. 小隊榮譽排行榜初始化與即時監聽
// ==========================================
function initLeaderboard() {
  let leaderboardEl = document.getElementById("leaderboard-container");
  if (!leaderboardEl) {
    leaderboardEl = document.createElement("div");
    leaderboardEl.id = "leaderboard-container";
    leaderboardEl.className = "card";
    leaderboardEl.style.cssText = "margin-top: 20px; padding: 15px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);";
    
    const gameSection = document.getElementById("game-section");
    if (gameSection) {
      gameSection.appendChild(leaderboardEl);
    }
  }

  const teamsCol = collection(db, "teams");
  onSnapshot(teamsCol, (snapshot) => {
    let teamsList = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      teamsList.push({
        id: docSnap.id,
        name: data.teamName || docSnap.id,
        score: data.score || 0
      });
    });

    teamsList.sort((a, b) => b.score - a.score);

    let html = `<h3 style="margin-top: 0; color: #333; font-size: 1.1rem;">🏆 小隊榮譽排行榜</h3>`;
    html += `<ul style="list-style: none; padding: 0; margin: 10px 0 0 0;">`;
    
    teamsList.forEach((team, index) => {
      let medal = "";
      if (index === 0) medal = "🥇 ";
      else if (index === 1) medal = "🥈 ";
      else if (index === 2) medal = "🥉 ";

      html += `
        <li style="display: flex; justify-content: space-between; padding: 8px 10px; margin-bottom: 5px; background: #f8f9fa; border-radius: 4px; font-size: 0.95rem;">
          <span>${medal}<b>${team.name}</b></span>
          <span style="color: #007bff; font-weight: bold;">${team.score} 分</span>
        </li>
      `;
    });
    html += `</ul>`;

    leaderboardEl.innerHTML = html;
  });
}