/* ==========================================
   Aegis AI - Dashboard Frontend Logic (script.js)
   ========================================== */

let currentInvestigation = null;
let currentTxnId = null;
let isTypingTrace = false;
let currentFilterCategory = "all";
let currentExplorerView = "table";
let searchDebounceTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  // Bind search button & Enter key
  const searchInput = document.getElementById("txn-search-input");
  const searchBtn = document.getElementById("btn-investigate");

  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      const val = searchInput.value.trim();
      if (val) runInvestigation(val);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        const val = searchInput.value.trim();
        if (val) runInvestigation(val);
      }
    });
  }

  // Bind Explorer live search input
  const explorerInput = document.getElementById("explorer-search-input");
  if (explorerInput) {
    explorerInput.addEventListener("input", (e) => {
      const val = e.target.value;
      const clearBtn = document.getElementById("explorer-search-clear");
      if (clearBtn) clearBtn.style.display = val ? "block" : "none";
      
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        loadTransactionList(val, currentFilterCategory);
      }, 200);
    });
  }

  // Initial load
  loadTransactionList();
});

function switchExplorerView(mode) {
  currentExplorerView = mode;
  const btnTable = document.getElementById("view-mode-table");
  const btnCard = document.getElementById("view-mode-card");
  const tableCont = document.getElementById("explorer-table-container");
  const cardCont = document.getElementById("explorer-card-container");

  if (btnTable) btnTable.classList.toggle("active", mode === "table");
  if (btnCard) btnCard.classList.toggle("active", mode === "card");
  if (tableCont) tableCont.style.display = mode === "table" ? "block" : "none";
  if (cardCont) cardCont.style.display = mode === "card" ? "block" : "none";
}

// ==========================================
// Transaction Explorer & Search Logic
// ==========================================
async function loadTransactionList(query = "", category = "all") {
  const container = document.getElementById("txn-list-container");
  const mainTbody = document.getElementById("main-txn-tbody");
  const countTag = document.getElementById("explorer-count");

  try {
    const url = `/api/transactions?q=${encodeURIComponent(query)}&filter=${encodeURIComponent(category)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch transactions");
    const data = await res.json();
    const txns = data.transactions || [];

    if (countTag) {
      countTag.innerText = `${txns.length} Transaction${txns.length === 1 ? '' : 's'}`;
    }

    // 1. Render Table View
    if (mainTbody) {
      if (txns.length === 0) {
        mainTbody.innerHTML = `<tr><td colspan="10" class="empty-state">No matching transactions found.</td></tr>`;
      } else {
        mainTbody.innerHTML = txns.map(t => {
          const isActive = t.transaction_id === currentTxnId;
          const isProxy = Boolean(t.ip_is_proxy);
          const isFrozen = t.card_status === "frozen";
          const isSuccessful = Boolean(t.transaction_status);

          let alertBadgeHtml = `<span class="badge-table-low">🟢 Normal</span>`;
          if (t.risk_level === "High" || t.risk_color === "red") {
            alertBadgeHtml = `<span class="badge-table-high">🔴 High Alert</span>`;
          } else if (t.risk_level === "Medium" || t.risk_color === "yellow") {
            alertBadgeHtml = `<span class="badge-table-medium">🟡 Medium Alert</span>`;
          }

          return `
            <tr class="main-txn-row ${isActive ? 'active-table-row' : ''}" id="table-row-${t.transaction_id}" onclick="runInvestigation('${t.transaction_id}')">
              <td>${alertBadgeHtml}</td>
              <td class="col-txn-id"><strong>${t.transaction_id}</strong></td>
              <td>
                <div class="tbl-cust-cell">
                  <span class="tbl-cust-name">${t.full_name || t.user_id}</span>
                  <span class="tbl-cust-id">(${t.user_id})</span>
                </div>
              </td>
              <td>${t.merchantname}</td>
              <td>📍 ${t.location}</td>
              <td class="col-amount">$${Number(t.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</td>
              <td>${isProxy ? `<span class="txn-badge badge-proxy">⚠️ Proxy</span>` : `<span class="txt-dim">Clean</span>`}</td>
              <td><span class="txn-badge ${isFrozen ? 'badge-frozen' : 'badge-active'}">${isFrozen ? 'FROZEN' : 'ACTIVE'}</span></td>
              <td><span class="txn-badge ${isSuccessful ? 'badge-transaction-success' : 'badge-transaction-failed'}">${isSuccessful ? 'SUCCESS' : 'FAILED'}</span></td>
              <td>
                <button class="btn-table-investigate">🔍 Investigate</button>
              </td>
            </tr>
          `;
        }).join("");
      }
    }

    // 2. Render Cards View
    if (container) {
      if (txns.length === 0) {
        container.innerHTML = `<div class="empty-state">No matching transactions found.</div>`;
      } else {
        container.innerHTML = txns.map(t => {
          const isActive = t.transaction_id === currentTxnId;
          const isProxy = Boolean(t.ip_is_proxy);
          const isFrozen = t.card_status === "frozen";

          let alertBadge = `<span class="txn-badge badge-risk-low">🟢 Normal</span>`;
          if (t.risk_level === "High" || t.risk_color === "red") {
            alertBadge = `<span class="txn-badge badge-risk-high">🔴 HIGH ALERT</span>`;
          } else if (t.risk_level === "Medium" || t.risk_color === "yellow") {
            alertBadge = `<span class="txn-badge badge-risk-medium">🟡 MEDIUM ALERT</span>`;
          }

          return `
            <div class="txn-row ${isActive ? 'active' : ''} risk-${t.risk_color || 'green'}" id="txn-row-${t.transaction_id}" onclick="runInvestigation('${t.transaction_id}')">
              <div class="txn-left">
                <div class="txn-id-row">
                  <span class="txn-id-text">${t.transaction_id}</span>
                  <span class="txn-cust-name">${t.full_name ? `${t.full_name} (${t.user_id})` : t.user_id}</span>
                </div>
                <div class="txn-sub-meta">
                  <span>📍 ${t.location}</span>
                  <span>•</span>
                  <span>🏪 ${t.merchantname}</span>
                </div>
              </div>
              <div class="txn-right">
                <span class="txn-amount">$${Number(t.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                <div class="txn-badge-group">
                  ${alertBadge}
                  ${isProxy ? `<span class="txn-badge badge-proxy">⚠️ Proxy</span>` : ''}
                  <span class="txn-badge ${isFrozen ? 'badge-frozen' : 'badge-active'}">${isFrozen ? 'FROZEN' : 'ACTIVE'}</span>
                </div>
              </div>
            </div>
          `;
        }).join("");
      }
    }

  } catch (err) {
    console.error("Error loading transaction list:", err);
    if (container) container.innerHTML = `<div class="empty-state">Failed to load transaction list.</div>`;
    if (mainTbody) mainTbody.innerHTML = `<tr><td colspan="10" class="empty-state">Failed to load transactions: ${err.message}</td></tr>`;
  }
}

function setFilterCategory(category) {
  currentFilterCategory = category;
  document.querySelectorAll(".pill-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === category);
  });
  const input = document.getElementById("explorer-search-input");
  const currentQuery = input ? input.value.trim() : "";
  loadTransactionList(currentQuery, category);
}

function clearExplorerSearch() {
  const input = document.getElementById("explorer-search-input");
  if (input) input.value = "";
  const clearBtn = document.getElementById("explorer-search-clear");
  if (clearBtn) clearBtn.style.display = "none";
  loadTransactionList("", currentFilterCategory);
}

// ==========================================
// 1. Investigation API Call & Data Pipeline
// ==========================================
async function runInvestigation(txnId) {
  currentTxnId = txnId;
  const searchInput = document.getElementById("txn-search-input");
  if (searchInput) searchInput.value = txnId;

  // Highlight active transaction in cards view & table view
  document.querySelectorAll(".txn-row").forEach(el => el.classList.remove("active"));
  const activeCardRow = document.getElementById(`txn-row-${txnId}`);
  if (activeCardRow) activeCardRow.classList.add("active");

  document.querySelectorAll(".main-txn-row").forEach(el => el.classList.remove("active-table-row"));
  const activeTableRow = document.getElementById(`table-row-${txnId}`);
  if (activeTableRow) activeTableRow.classList.add("active-table-row");

  // Clear UI elements
  document.getElementById("terminal-content").innerText = "Connecting to USBank Risk Management AI Engine...";
  
  try {
    const response = await fetch(`/api/investigate/${encodeURIComponent(txnId)}?include_summary=false`);
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

    // Start the slow provider request after the evidence is visible.
    showSummaryLoading();
    loadInvestigationSummary(txnId);

    // Render findings & citations
    renderFindings(data.findings || []);
    renderCitations(data.policy_citations || []);

  } catch (error) {
    console.error("Investigation error:", error);
    showToast("Server communication error", "danger");
  }
}

async function loadInvestigationSummary(txnId) {
  try {
    const response = await fetch(`/api/investigate/${encodeURIComponent(txnId)}?include_summary=true`);
    if (!response.ok) throw new Error(`Summary request failed with status ${response.status}`);

    const data = await response.json();
    if (currentTxnId !== txnId) return;

    currentInvestigation = {...currentInvestigation, ...data};
    document.getElementById("llm-summary-text").innerText = data.llm_summary || "No summary available.";
    console.log(`[LLM] Provider used: ${data.llm_provider || "fallback"}`);
  } catch (error) {
    if (currentTxnId !== txnId) return;
    console.error("Summary error:", error);
    document.getElementById("llm-summary-text").innerText = "Summary unavailable. The evidence and risk assessment are still available.";
  }
}

function showSummaryLoading() {
  document.getElementById("llm-summary-text").innerHTML =
    '<span class="llm-loading"><span class="llm-spinner" aria-hidden="true"></span>Generating executive summary...</span>';
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

  // Customer history tab rendering
  const historyList = data.user_history || [];
  const historyTitle = document.getElementById("cust-history-title");
  if (historyTitle) {
    historyTitle.innerText = `Full History for ${cust.full_name || cust.user_id || 'Customer'} (${historyList.length} Transactions Found)`;
  }
  
  const historyTbody = document.getElementById("cust-history-tbody");
  if (historyTbody) {
    if (historyList.length === 0) {
      historyTbody.innerHTML = `<tr><td colspan="8" class="empty-state">No transaction history found for customer.</td></tr>`;
    } else {
      historyTbody.innerHTML = historyList.map(h => {
        const isCurrent = h.transaction_id === txn.transaction_id;
        const isProxy = Boolean(h.ip_is_proxy);
        const isSuccessful = Boolean(h.transaction_status);
        const amt = `$${Number(h.amount).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        const timeShort = h.timestamp ? h.timestamp.split('.')[0] : '--';

        let alertBadge = `<span class="badge-table-low">🟢 Normal</span>`;
        if (h.risk_level === "High" || (h.amount >= 1000 && isProxy)) {
          alertBadge = `<span class="badge-table-high">🔴 High Alert</span>`;
        } else if (h.risk_level === "Medium" || isProxy || h.amount >= 500) {
          alertBadge = `<span class="badge-table-medium">🟡 Medium Alert</span>`;
        }

        return `
          <tr class="${isCurrent ? 'current-history-row' : ''}">
            <td><strong>${h.transaction_id}</strong> ${isCurrent ? '⭐' : ''}</td>
            <td>${timeShort}</td>
            <td>${h.merchantname}</td>
            <td>${h.location}</td>
            <td style="color: var(--accent-cyan); font-weight:700;">${amt}</td>
            <td>${alertBadge}</td>
            <td><span class="txn-badge ${isSuccessful ? 'badge-transaction-success' : 'badge-transaction-failed'}">${isSuccessful ? 'SUCCESS' : 'FAILED'}</span></td>
            <td>
              <button class="btn-history-view" onclick="runInvestigation('${h.transaction_id}')">Investigate</button>
            </td>
          </tr>
        `;
      }).join("");
    }
  }
}

// ==========================================
// 4. Tab Switching Logic
// ==========================================
function switchTab(tabId) {
  const tabs = ["txn-details", "cust-profile", "cust-history"];
  const btns = document.querySelectorAll(".tab-btn");

  tabs.forEach((id, index) => {
    const btn = btns[index];
    const pane = document.getElementById(`tab-${id}`);
    if (btn && pane) {
      if (id === tabId) {
        btn.classList.add("active");
        pane.classList.add("active");
      } else {
        btn.classList.remove("active");
        pane.classList.remove("active");
      }
    }
  });
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
      
      // Refresh transaction explorer list to reflect updated status (e.g. FROZEN)
      const input = document.getElementById("explorer-search-input");
      const currentQuery = input ? input.value.trim() : "";
      loadTransactionList(currentQuery, currentFilterCategory);
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
