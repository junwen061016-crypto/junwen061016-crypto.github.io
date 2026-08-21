import { db } from "./firebase.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
} from "firebase/firestore";
import confetti from "https://esm.run/canvas-confetti";

const q = query(collection(db, "teams"), orderBy("score", "desc"));

let previousScores = {};

onSnapshot(q, (snapshot) => {
  const container = document.getElementById("big-leaderboard");
  if (!container) return;
  container.innerHTML = "";

  let maxScore = 10;
  const teamsData = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const score = data.score || 0;
    if (score > maxScore) maxScore = score;
    teamsData.push({ id: docSnap.id, ...data });
  });

  teamsData.forEach((team, index) => {
    const score = team.score || 0;
    const percentage = Math.max(8, Math.min(100, (score / maxScore) * 100));
    const medal = index === 0 ? "👑" : index === 1 ? "🥈" : "🥉";
    const fillClass = team.id === 'team_1' ? 'team-1-fill' : team.id === 'team_2' ? 'team-2-fill' : 'team-3-fill';

    if (previousScores[team.id] !== undefined && score > previousScores[team.id]) {
      confetti({
        particleCount: 30,
        spread: 60,
        origin: { x: 0.8, y: 0.5 }
      });
    }
    previousScores[team.id] = score;

    const row = document.createElement("div");
    row.className = "team-row";
    row.innerHTML = `
      <div class="team-label">${medal}${team.teamName || team.id}</div>
      <div class="bar-track">
        <div class="bar-fill ${fillClass}" style="width: ${percentage}%;"></div>
      </div>
      <div class="team-score">${score} 分</div>
    `;
    container.appendChild(row);
  });
});

onSnapshot(doc(db, "gameStatus", "global"), (docSnap) => {
  if (!docSnap.exists()) return;
  const status = docSnap.data();

  if (status.isBingoEnded) {
    const bingoGrid = document.getElementById("bingo-grid");
    if (bingoGrid) {
      bingoGrid.style.pointerEvents = "none";
      bingoGrid.style.opacity = "0.5";
    }
  }

  if (status.isScanEnded) {
    const readerEl = document.getElementById("reader");
    if (readerEl) {
      readerEl.innerHTML = "<p style='text-align:center; color:#e74c3c; font-weight:bold; padding: 20px;'>📷 掃碼交友時間已截止！</p>";
    }
  }

  if (status.isFinalResult) {
    const gameSection = document.getElementById("game-section");
    if (gameSection) gameSection.style.display = "none";

    let finalDiv = document.getElementById("final-screen");
    if (!finalDiv) {
      finalDiv = document.createElement("div");
      finalDiv.id = "final-screen";
      finalDiv.className = "card";
      finalDiv.innerHTML = `
        <h1 style="color: #e74c3c; text-align: center;">🏆 靈魂共鳴大賽・最終結算</h1>
        <p style="text-align: center; font-size: 1.1rem;">活動圓滿結束！請看大螢幕揭曉最終冠軍小隊！</p>
      `;
      document.body.appendChild(finalDiv);
    }
    finalDiv.style.display = "block";
  }
});