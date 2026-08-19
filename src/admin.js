import { auth, db, rtdb } from "./firebase.js";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, collection, deleteDoc, onSnapshot } from "firebase/firestore";
import { getDatabase, ref, set, get } from "firebase/database";

// 後台登入
document.getElementById("btn-admin-login").addEventListener("click", async () => {
  const email = document.getElementById("admin-email").value;
  const password = document.getElementById("admin-password").value;

  if (!email || !password) return alert("請輸入帳號密碼！");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("後台登入成功！");
  } catch (err) {
    alert("登入失敗：" + err.message);
  }
});

// 登出後台
document.getElementById("btn-admin-logout").addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("admin-login-section").style.display = "none";
    document.getElementById("admin-dashboard-section").style.display = "block";
    initAdminDashboard();
  } else {
    document.getElementById("admin-login-section").style.display = "block";
    document.getElementById("admin-dashboard-section").style.display = "none";
  }
});

function initAdminDashboard() {
  // 1. 賽事時程控制：階段按鈕即時監聽與狀態同步
  const globalRef = doc(db, "gameStatus", "global");

  // 即時監聽目前賽事狀態，更新開關按鈕的外觀與文字
  onSnapshot(globalRef, (docSnap) => {
    const status = docSnap.exists() ? docSnap.data() : {};
    const stateEl = document.getElementById("game-state-display") || createGameStateDisplay();
    
    let statusText = "🟢 賽事進行中";
    if (status.isFinalResult) statusText = "🏆 已進入最終結算";
    else if (status.isScanEnded) statusText = "📷 掃碼交友已結束";
    else if (status.isBingoEnded) statusText = "🎯 賓果遊戲已結束";

    stateEl.innerHTML = `目前狀態：<b>${statusText}</b>`;
  });

  // 控制開關 1：結束賓果遊戲
  const btnEndBingo = document.getElementById("btn-end-bingo");
  if (btnEndBingo) {
    btnEndBingo.onclick = async () => {
      if (confirm("確定要結束【賓果遊戲】嗎？")) {
        await updateDoc(globalRef, { isBingoEnded: true });
        alert("已成功關閉賓果遊戲！");
      }
    };
  }

  // 控制開關 2：結束掃碼交友
  const btnEndScan = document.getElementById("btn-end-scan");
  if (btnEndScan) {
    btnEndScan.onclick = async () => {
      if (confirm("確定要結束【掃碼交友】嗎？")) {
        await updateDoc(globalRef, { isScanEnded: true });
        alert("已成功關閉掃碼交友！");
      }
    };
  }

  // 控制開關 3：最終分數結算
  const btnFinalResult = document.getElementById("btn-final-result");
  if (btnFinalResult) {
    btnFinalResult.onclick = async () => {
      if (confirm("確定要進入【最終分數結算】嗎？")) {
        await updateDoc(globalRef, { isFinalResult: true });
        alert("已進入最終結算畫面！");
      }
    };
  }

  // 重新開啟賓果遊戲
  const btnRestartBingo = document.getElementById("btn-restart-bingo");
  if (btnRestartBingo) {
    btnRestartBingo.onclick = async () => {
      if (confirm("確定要【重新開啟賓果遊戲】嗎？")) {
        await updateDoc(globalRef, { isBingoEnded: false });
        alert("已重新開啟賓果遊戲！");
      }
    };
  }

  // 重新開啟掃碼交友
  const btnRestartScan = document.getElementById("btn-restart-scan");
  if (btnRestartScan) {
    btnRestartScan.onclick = async () => {
      if (confirm("確定要【重新開啟掃碼交友】嗎？")) {
        await updateDoc(globalRef, { isScanEnded: false });
        alert("已重新開啟掃碼交友！");
      }
    };
  }

  // 取消最終結算 / 重置賽事畫面
  const btnRestartGame = document.getElementById("btn-restart-game");
  if (btnRestartGame) {
    btnRestartGame.onclick = async () => {
      if (confirm("確定要【取消最終結算狀態】返回賽事進行中嗎？")) {
        await updateDoc(globalRef, { isFinalResult: false, isBingoEnded: false, isScanEnded: false });
        alert("已重置賽事狀態，所有畫面已恢復！");
      }
    };
  }

  // ================= 25 格賓果題目設定 (Realtime Database) =================
  const container = document.getElementById("bingo-questions-form");
  if (container) {
    container.innerHTML = ""; // 清空舊內容
    container.style.display = "grid";
    container.style.gridTemplateColumns = "repeat(5, 1fr)";
    container.style.gap = "10px";
    container.style.marginTop = "10px";

    for (let i = 1; i <= 25; i++) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      
      const label = document.createElement("span");
      label.innerText = `第 ${i} 格`;
      label.style.fontSize = "12px";
      label.style.marginBottom = "2px";
      label.style.color = "#555";

      const input = document.createElement("input");
      input.type = "text";
      input.id = `q-${i}`;
      input.placeholder = `輸入題目`;
      input.style.padding = "6px";
      input.style.width = "100%";
      input.style.boxSizing = "border-box";

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      container.appendChild(wrapper);
    }

    // 從 Realtime Database 載入現有題目
    //const rtdb = getDatabase();
    const questionsRef = ref(rtdb, "config/bingo_questions");
    get(questionsRef).then((snapshot) => {
      if (snapshot.exists()) {
        const questions = snapshot.val();
        questions.forEach((q, index) => {
          const inputField = document.getElementById(`q-${index + 1}`);
          if (inputField) inputField.value = q;
        });
      }
    });

    // 點擊「儲存所有賓果題目」按鈕
    const saveBtn = document.getElementById("btn-save-questions");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        let questionsArray = [];
        for (let i = 1; i <= 25; i++) {
          const val = document.getElementById(`q-${i}`).value.trim();
          questionsArray.push(val || `題目 ${i}`);
        }

        try {
          await set(ref(rtdb, "config/bingo_questions"), questionsArray);
          alert("25格賓果題目儲存成功！");
        } catch (error) {
          console.error("儲存失敗：", error);
          alert("儲存失敗，請檢查權限。");
        }
      };
    }
  }

  // 遊戲開關切換按鈕
  const toggleBtn = document.getElementById("btn-toggle-game");
  if (toggleBtn) {
    toggleBtn.onclick = async () => {
      const snap = await getDoc(globalRef);
      const currentState = snap.exists() ? (snap.data().isBingoRunning ?? true) : true;
      await updateDoc(globalRef, { isBingoRunning: !currentState });
      alert(`遊戲開關已切換為：${!currentState ? "開啟" : "關閉"}`);
    };
  }

  // 2. 實時監聽各小隊分數 (teams 集合)
  const teamsCol = collection(db, "teams");
  onSnapshot(teamsCol, (snapshot) => {
    let teamScoresHtml = "🏆 <b>各小隊即時積分</b>：<br>";
    snapshot.forEach((docSnap) => {
      const teamData = docSnap.data();
      const teamName = teamData.teamName || docSnap.id;
      const score = teamData.score || 0;
      teamScoresHtml += `• ${teamName}: <b>${score} 分</b> &nbsp;&nbsp;`;
    });
    
    let scoreBoardEl = document.getElementById("admin-teams-scoreboard");
    if (!scoreBoardEl) {
      const statsOverviewEl = document.getElementById("stats-overview");
      if (statsOverviewEl && statsOverviewEl.parentNode) {
        scoreBoardEl = document.createElement("div");
        scoreBoardEl.id = "admin-teams-scoreboard";
        scoreBoardEl.style.cssText = "margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 6px;";
        statsOverviewEl.parentNode.insertBefore(scoreBoardEl, statsOverviewEl);
      }
    }
    if (scoreBoardEl) {
      scoreBoardEl.innerHTML = teamScoresHtml;
    }
  });

  // 3. 實時監控數據與即時更新玩家列表
  const usersCol = collection(db, "users");
  onSnapshot(usersCol, async (snapshot) => {
    let totalUsers = snapshot.size;
    let teamCounts = { team_1: 0, team_2: 0, team_3: 0, team_4: 0, team_5: 0 };
    let totalScans = 0;

    const usersListEl = document.getElementById("admin-users-list");
    if (!usersListEl) return;
    usersListEl.innerHTML = "";

    snapshot.forEach((userDoc) => {
      const uData = userDoc.data();
      if (uData.teamId && teamCounts[uData.teamId] !== undefined) {
        teamCounts[uData.teamId]++;
      }
      totalScans += (uData.scannedList || []).length;

      const li = document.createElement("li");
      li.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; font-size: 0.9rem;";
      li.innerHTML = `
        <span><b>${uData.email}</b> (${uData.teamId || '未分隊'}) - 已交友: ${(uData.scannedList || []).length}人</span>
        <div>
          <select id="select-team-${userDoc.id}" style="padding: 4px; font-size: 0.8rem; width: auto; display: inline-block;">
            <option value="team_1" ${uData.teamId==='team_1'?'selected':''}>第一小隊</option>
            <option value="team_2" ${uData.teamId==='team_2'?'selected':''}>第二小隊</option>
            <option value="team_3" ${uData.teamId==='team_3'?'selected':''}>第三小隊</option>
            <option value="team_4" ${uData.teamId==='team_4'?'selected':''}>第四小隊</option>
            <option value="team_5" ${uData.teamId==='team_5'?'selected':''}>第五小隊</option>
          </select>
          <button id="btn-update-team-${userDoc.id}" style="padding: 4px 8px; font-size: 0.8rem; width: auto; background: #007bff; color: #fff; border: none; border-radius: 4px;">調隊</button>
          <button id="btn-kick-${userDoc.id}" style="padding: 4px 8px; font-size: 0.8rem; width: auto; background: #dc3545; color: #fff; border: none; border-radius: 4px; margin-left: 4px;">剔除</button>
        </div>
      `;
      usersListEl.appendChild(li);

      setTimeout(() => {
        const updateBtn = document.getElementById(`btn-update-team-${userDoc.id}`);
        if (updateBtn) {
          updateBtn.onclick = async () => {
            const newTeam = document.getElementById(`select-team-${userDoc.id}`).value;
            await updateDoc(doc(db, "users", userDoc.id), { teamId: newTeam });
            alert(`已成功將該玩家調至 ${newTeam}！`);
          };
        }

        const kickBtn = document.getElementById(`btn-kick-${userDoc.id}`);
        if (kickBtn) {
          kickBtn.onclick = async () => {
            if (confirm(`確定要將玩家 ${uData.email} 徹底剔除嗎？`)) {
              await deleteDoc(doc(db, "users", userDoc.id));
              alert("已成功剔除玩家！");
            }
          };
        }
      }, 0);
    });

    const statsOverviewEl = document.getElementById("stats-overview");
    if (statsOverviewEl) {
      statsOverviewEl.innerHTML = `
        📈 <b>實時數據</b>：總上線人數：<b>${totalUsers}</b> 人 | 
        第一小隊：<b>${teamCounts.team_1}</b> 人 | 
        第二小隊：<b>${teamCounts.team_2}</b> 人 | 
        第三小隊：<b>${teamCounts.team_3}</b> 人 | 
        第四小隊：<b>${teamCounts.team_4}</b> 人 | 
        第五小隊：<b>${teamCounts.team_5}</b> 人 | 
        累計交友總次數：<b>${totalScans}</b> 次
      `;
    }
  });

  // 4. 小隊分數手動調整
  const btnAdjustScore = document.getElementById("btn-adjust-score");
  if (btnAdjustScore) {
    btnAdjustScore.onclick = async () => {
      const teamId = document.getElementById("target-team-select").value;
      const delta = parseInt(document.getElementById("team-score-delta").value);
      if (isNaN(delta)) return alert("請輸入有效的數字分數！");

      const teamRef = doc(db, "teams", teamId);
      const teamSnap = await getDoc(teamRef);
      const currentScore = teamSnap.exists() ? (teamSnap.data().score || 0) : 0;

      await setDoc(teamRef, { score: Math.max(0, currentScore + delta) }, { merge: true });
      alert(`成功調整 ${teamId} 分數！目前分數：${Math.max(0, currentScore + delta)}`);
    };
  }

  // 5. 小隊分數全數歸零
  const btnResetScores = document.getElementById("btn-reset-scores");
  if (btnResetScores) {
    btnResetScores.onclick = async () => {
      if (confirm("⚠️ 警告：這將把所有小隊的分數瞬間歸零！確定要執行嗎？")) {
        await setDoc(doc(db, "teams", "team_1"), { score: 0, teamName: "第一小隊" }, { merge: true });
        await setDoc(doc(db, "teams", "team_2"), { score: 0, teamName: "第二小隊" }, { merge: true });
        await setDoc(doc(db, "teams", "team_3"), { score: 0, teamName: "第三小隊" }, { merge: true });
        await setDoc(doc(db, "teams", "team_4"), { score: 0, teamName: "第四小隊" }, { merge: true });
        await setDoc(doc(db, "teams", "team_5"), { score: 0, teamName: "第五小隊" }, { merge: true });
        alert("所有小隊分數已順利歸零！");
      }
    };
  }
}

// 輔助建立狀態顯示文字區塊
function createGameStateDisplay() {
  const toggleBtn = document.getElementById("btn-toggle-game");
  if (toggleBtn && toggleBtn.parentNode) {
    const div = document.createElement("div");
    div.id = "game-state-display";
    div.style.cssText = "margin-bottom: 10px; font-weight: bold; color: #333;";
    toggleBtn.parentNode.insertBefore(div, toggleBtn);
    return div;
  }
  return document.createElement("div");
}