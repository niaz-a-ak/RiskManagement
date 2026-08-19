/* ==========================================
   Aegis AI - Dashboard Frontend Logic (script.js)
   ========================================== */

let currentInvestigation = null;
let currentTxnId = "TXN_99812";
let isTypingTrace = false;

document.addEventListener("DOMContentLoaded", () => {
  // Bind search button & Enter key
  const searchInput = document.getElementById("txn-search-input");
  const searchBtn = document.getElementById("btn-investigate");

  searchBtn.addEventListener("click", () => {
    const val = searchInput.value.trim();
    if (val) runInvestigation(val);
  });

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const val = searchInput.value.trim();
      if (val) runInvestigation(val);
    }
  });

  // Initial load with default TXN_99812
  runInvestigation(currentTxnId);
});

// ==========================================
// 1. Investigation API Call & Data Pipeline
// ==========================================
async function runInvestigation(txnId) {
  currentTxnId = txnId;
  document.getElementById("txn-search-input").value = txnId;

  // Clear UI elements
  document.getElementById("terminal-content").innerText = "Connecting to USBank Risk Management AI Engine...";
  
  try {
    const response = await fetch(`/api/investigate/${encodeURIComponent(txnId)}`);
    if (!response.ok) {
      const err = await response.json();
      showToast(err.error || "Transaction not found", "danger");
      document.getElementById("terminal-content").innerText = `[ERROR] ${err.error || "Failed to load transaction."}`;
      return;
    }

    const data = await response.json();
    currentInvestigation = data;
    console.log(`[LLM] Provider used: ${data.llm_provider || "unknown"}`);

    // Stream trace terminal logs
    streamTerminalLogs(data.execution_trace || []);

    // Populate evidence details
    populateEvidenceData(data);

    // Animate score gauge & risk indicators
    updateRiskGauge(data.risk_score, data.risk_level, data.required_action);

    // Render LLM summary
    document.getElementById("llm-summary-text").innerText = data.llm_summary || "No summary available.";

    // Render findings & citations
    renderFindings(data.findings || []);
    renderCitations(data.policy_citations || []);

  } catch (error) {
    console.error("Investigation error:", error);
    showToast("Server communication error", "danger");
  }
}

// ==========================================
// 2. Terminal Log Streaming Animation
// ==========================================
function streamTerminalLogs(logs) {
  const terminal = document.getElementById("terminal-content");
  const terminalBody = document.getElementById("terminal-body");
  terminal.innerText = "";

  let lineIdx = 0;

  function printNextLine() {
    if (lineIdx < logs.length) {
      const line = logs[lineIdx];
      terminal.innerText += (lineIdx === 0 ? "" : "\n") + line;
      terminalBody.scrollTop = terminalBody.scrollHeight;
      lineIdx++;
      setTimeout(printNextLine, 140); // 140ms delay per log entry
    }
  }

  printNextLine();
}

// ==========================================
// 3. Evidence Tab Population
// ==========================================
function populateEvidenceData(data) {
  const txn = data.transaction || {};
  const cust = data.customer || {};

  // Transaction details tab
  document.getElementById("val-txn-id").innerText = txn.transaction_id || "--";
  document.getElementById("val-txn-user").innerText = txn.user_id || "--";
  document.getElementById("val-txn-amt").innerText = txn.amount ? `$${Number(txn.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}` : "--";
  document.getElementById("val-txn-merchant").innerText = txn.merchantname || "--";
  document.getElementById("val-txn-location").innerText = txn.location || "--";
  document.getElementById("val-txn-time").innerText = txn.timestamp || "--";
  document.getElementById("val-txn-cardpresent").innerText = txn.card_present === "yes" ? "Yes (Physical Swipe)" : "No (Online Purchase)";
  document.getElementById("val-txn-ip").innerText = txn.ip_address || "--";
  document.getElementById("val-txn-proxy").innerText = txn.ip_is_proxy ? "⚠️ Tor Exit Node / Proxy" : "Clean Residential IP";
  
  const statusBadge = document.getElementById("val-txn-status");
  statusBadge.innerText = (txn.card_status || "active").toUpperCase();
  statusBadge.style.color = txn.card_status === "frozen" ? "var(--risk-high)" : "var(--risk-low)";

  // Customer profile tab
  document.getElementById("val-cust-id").innerText = cust.user_id || "--";
  document.getElementById("val-cust-name").innerText = cust.full_name || "--";
  document.getElementById("val-cust-country").innerText = cust.home_country || "--";
  document.getElementById("val-cust-monthly").innerText = cust.avg_monthly_spent ? `$${Number(cust.avg_monthly_spent).toLocaleString('en-US', {minimumFractionDigits: 2})}` : "--";
  document.getElementById("val-cust-avg").innerText = cust.avg_transaction_amt ? `$${Number(cust.avg_transaction_amt).toLocaleString('en-US', {minimumFractionDigits: 2})}` : "--";
  document.getElementById("val-cust-count").innerText = (data.user_history || []).length;
}

// ==========================================
// 4. Tab Switching Logic
// ==========================================
function switchTab(tabId) {
  const btnDetails = document.querySelectorAll(".tab-btn")[0];
  const btnCust = document.querySelectorAll(".tab-btn")[1];
  
  const paneDetails = document.getElementById("tab-txn-details");
  const paneCust = document.getElementById("tab-cust-profile");

  if (tabId === "txn-details") {
    btnDetails.classList.add("active");
    btnCust.classList.remove("active");
    paneDetails.classList.add("active");
    paneCust.classList.remove("active");
  } else {
    btnCust.classList.add("active");
    btnDetails.classList.remove("active");
    paneCust.classList.add("active");
    paneDetails.classList.remove("active");
  }
}

// ==========================================
// 5. SVG Score Ring & Risk Gauge Animation
// ==========================================
function updateRiskGauge(score, riskLevel, actionText) {
  const ring = document.getElementById("gauge-ring");
  const scoreVal = document.getElementById("score-val");
  const badge = document.getElementById("risk-level-badge");
  const actionLabel = document.getElementById("required-action-text");
  const indicatorBar = document.getElementById("indicator-bar");

  // Total circumference is 2 * PI * 68 ≈ 427
  const maxCircumference = 427;
  const targetOffset = maxCircumference - (score / 100) * maxCircumference;

  // Determine colors based on risk level
  let color = "var(--risk-low)";
  let badgeBg = "rgba(0, 230, 118, 0.2)";
  
  if (score >= 80) {
    color = "var(--risk-high)";
    badgeBg = "rgba(255, 0, 85, 0.25)";
  } else if (score >= 40) {
    color = "var(--risk-medium)";
    badgeBg = "rgba(255, 146, 0, 0.25)";
  }

  // Update stroke offset & colors
  ring.style.strokeDashoffset = targetOffset;
  ring.style.stroke = color;
  
  badge.innerText = `${riskLevel.toUpperCase()} RISK`;
  badge.style.color = color;
  badge.style.background = badgeBg;

  actionLabel.innerText = actionText || "--";
  indicatorBar.style.width = `${score}%`;
  indicatorBar.style.background = color;

  // Counter number animation
  animateScoreCounter(score);
}

function animateScoreCounter(targetScore) {
  const scoreVal = document.getElementById("score-val");
  let current = 0;
  const step = Math.ceil(targetScore / 30);
  const timer = setInterval(() => {
    current += step;
    if (current >= targetScore) {
      current = targetScore;
      clearInterval(timer);
    }
    scoreVal.innerText = current;
  }, 25);
}

// ==========================================
// 6. Findings & RAG Citations Rendering
// ==========================================
function renderFindings(findings) {
  const container = document.getElementById("findings-container");
  document.getElementById("finding-count").innerText = `${findings.length} Rule Findings`;
  
  if (findings.length === 0) {
    container.innerHTML = `<div class="empty-state">No anomalies found.</div>`;
    return;
  }

  container.innerHTML = findings.map(f => `
    <div class="finding-item ${f.severity.toLowerCase()}">
      <div class="finding-top">
        <span class="finding-title">${f.title}</span>
        <div class="finding-meta">
          <span class="severity-tag ${f.severity}">${f.severity}</span>
          <span class="policy-tag">${f.policy_tag}</span>
        </div>
      </div>
      <p class="finding-desc">${f.description}</p>
    </div>
  `).join("");
}

function renderCitations(citations) {
  const container = document.getElementById("citations-container");
  
  if (citations.length === 0) {
    container.innerHTML = `<div class="empty-state">No vector policy citations matched.</div>`;
    return;
  }

  container.innerHTML = citations.map(c => `
    <div class="citation-card">
      <div class="citation-header">
        <span class="citation-section-title">${c.section}: ${c.title}</span>
        <span class="citation-score">Match: ${c.match_score}%</span>
      </div>
      <p class="citation-text">"${c.text}"</p>
    </div>
  `).join("");
}

// ==========================================
// 7. Fraud Action Center (API Integration)
// ==========================================
async function executeAction(actionType) {
  if (!currentTxnId) return;

  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionType, transaction_id: currentTxnId })
    });

    const result = await res.json();
    if (result.success) {
      showToast(result.message, actionType === "freeze" ? "danger" : "success");
      
      // Update local status badge in evidence tab
      const statusBadge = document.getElementById("val-txn-status");
      if (actionType === "freeze") {
        statusBadge.innerText = "FROZEN";
        statusBadge.style.color = "var(--risk-high)";
      }
      
      document.getElementById("action-status-tag").innerText = `ACTION EXEC: ${actionType.toUpperCase()} COMPLETED`;
    } else {
      showToast(result.error || "Action failed", "danger");
    }
  } catch (error) {
    console.error("Action error:", error);
    showToast("Failed to communicate with server", "danger");
  }
}

// ==========================================
// 8. Toast Helper
// ==========================================
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === "danger" ? "🚨" : "✅"}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.4s ease";
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
