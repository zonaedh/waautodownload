// ─── LICENSE CHECK ON OPEN ────────────────────────────────
(async () => {
  const licensed = await isLicensed();
  if (!licensed) {
    window.location.href = "license.html";
    return;
  }

  const data = await chrome.storage.local.get(["licenseKey"]);
  if (data.licenseKey) {
    const result = await verifyLicense(data.licenseKey);
    if (!result.valid) {
      await clearLicense();
      window.location.href = "license.html";
      return;
    }
  }

  const licenseInfo = document.getElementById("licenseInfo");
  if (licenseInfo && data.licenseKey) {
    licenseInfo.textContent = "Active Key: " + data.licenseKey;
  }

  updateTrialBanner();
  startPolling();
})();

// ─── POLL STORAGE EVERY SECOND ───────────────────────────
// This ensures counts always stay in sync even if messages are missed
function startPolling() {
  setInterval(async () => {
    const data = await chrome.storage.local.get([
      "sentCount", "failCount", "skipCount",
      "dailyCount", "dailyDate",
      "messageLimit", "messageCount",
      "running", "paused", "currentIndex", "numbers"
    ]);

    // Update sent/fail/skip counts
    document.getElementById("sentCount").textContent = data.sentCount || 0;
    document.getElementById("failCount").textContent = data.failCount || 0;
    document.getElementById("skipCount").textContent = data.skipCount || 0;

    // Update today count
    const today = new Date().toDateString();
    const todayCount = data.dailyDate === today ? (data.dailyCount || 0) : 0;
    document.getElementById("dailyCountDisplay").textContent = todayCount;

    // Update trial banner
    const limit = parseInt(data.messageLimit) || 0;
    const count = parseInt(data.messageCount) || 0;
    const trialBanner = document.getElementById("trialBanner");
    if (limit > 0 && trialBanner) {
      const remaining = limit - count;
      trialBanner.style.display = "block";
      trialBanner.textContent = `Trial: ${remaining} of ${limit} messages remaining`;
    }

    // Update running indicator
    if (data.running && data.numbers) {
      setRunningIndicator(true);
      document.getElementById("startBtn").style.display = "none";
      document.getElementById("stopBtn").style.display = "block";
      document.getElementById("pauseBtn").style.display = "block";
      if (data.paused) {
        document.getElementById("pauseBtn").textContent = "Resume";
        document.getElementById("pauseBtn").className = "btn btn-blue";
        document.getElementById("runningIndicator").innerHTML = '<div class="running-dot" style="background:#ff9800;animation:none;"></div>Paused';
        document.getElementById("runningIndicator").style.color = "#ff9800";
      } else {
        document.getElementById("pauseBtn").textContent = "Pause";
        document.getElementById("pauseBtn").className = "btn btn-gray";
        document.getElementById("runningIndicator").innerHTML = '<div class="running-dot"></div>Running...';
        document.getElementById("runningIndicator").style.color = "#25d366";
      }
    } else {
      setRunningIndicator(false);
      document.getElementById("startBtn").style.display = "block";
      document.getElementById("startBtn").disabled = false;
      document.getElementById("stopBtn").style.display = "none";
      document.getElementById("pauseBtn").style.display = "none";
    }

  }, 1000);
}

// ─── UPDATE TRIAL BANNER ──────────────────────────────────
async function updateTrialBanner() {
  const data = await chrome.storage.local.get(["messageLimit", "messageCount"]);
  const limit = parseInt(data.messageLimit) || 0;
  const count = parseInt(data.messageCount) || 0;

  const trialBanner = document.getElementById("trialBanner");
  const trialInfo = document.getElementById("trialInfo");

  if (limit > 0) {
    const remaining = limit - count;
    if (trialBanner) {
      trialBanner.style.display = "block";
      trialBanner.textContent = `Trial: ${remaining} of ${limit} messages remaining`;
    }
    if (trialInfo) {
      trialInfo.style.display = "block";
      trialInfo.textContent = `Trial License: ${remaining} of ${limit} messages remaining.`;
    }
  } else {
    if (trialBanner) trialBanner.style.display = "none";
    if (trialInfo) trialInfo.style.display = "none";
  }
}

// ─── STATE ────────────────────────────────────────────────
let minDelay = 1, maxDelay = 3;

// ─── RUNNING INDICATOR ────────────────────────────────────
function setRunningIndicator(running) {
  const indicator = document.getElementById("runningIndicator");
  indicator.style.display = running ? "flex" : "none";
}

// ─── MINIMIZE ─────────────────────────────────────────────
document.getElementById("minimizeBtn").addEventListener("click", () => {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("minimized").style.display = "flex";
});
document.getElementById("minimized").addEventListener("click", () => {
  document.getElementById("minimized").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
});

// ─── TABS ─────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory();
    if (btn.dataset.tab === "contacts") loadSavedLists();
    if (btn.dataset.tab === "templates") loadSavedTemplates();
    if (btn.dataset.tab === "settings") loadSettings();
    if (btn.dataset.tab === "crm") loadCrmTab();
  });
});

// ─── DELAY COUNTERS ───────────────────────────────────────
function setupCounter(decId, incId, valId, getVal, setVal, min = 1) {
  document.getElementById(decId).addEventListener("click", () => {
    if (getVal() > min) { setVal(getVal() - 1); document.getElementById(valId).textContent = getVal(); }
  });
  document.getElementById(incId).addEventListener("click", () => {
    setVal(getVal() + 1); document.getElementById(valId).textContent = getVal();
  });
}

setupCounter("minDelayDec", "minDelayInc", "minDelayVal", () => minDelay, v => minDelay = v, 1);
setupCounter("maxDelayDec", "maxDelayInc", "maxDelayVal", () => maxDelay, v => maxDelay = v, 1);

// ─── CSV IMPORT ───────────────────────────────────────────
document.getElementById("csvImport").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const lines = ev.target.result.split("\n").map(l => l.trim()).filter(l => l);
    const numbers = lines.map(l => l.split(",")[0].trim()).filter(l => l);
    document.getElementById("numbers").value = numbers.join("\n");
  };
  reader.readAsText(file);
});

// ─── CONTACT LISTS ────────────────────────────────────────
document.getElementById("saveListBtn").addEventListener("click", async () => {
  const name = document.getElementById("listName").value.trim();
  const numbers = document.getElementById("contactNumbers").value.trim();
  if (!name) return alert("Enter a list name.");
  if (!numbers) return alert("Enter at least one phone number.");

  const cleanNumbers = numbers
    .split("\n")
    .map(n => n.trim().replace(/\D/g, ""))
    .filter(n => n.length > 0)
    .join("\n");

  const data = await chrome.storage.local.get(["contactLists"]);
  const lists = data.contactLists || {};
  lists[name] = cleanNumbers;
  await chrome.storage.local.set({ contactLists: lists });
  document.getElementById("listName").value = "";
  document.getElementById("contactNumbers").value = "";
  loadSavedLists();
  loadContactListDropdown();
  alert("List saved!");
});

async function loadSavedLists() {
  const data = await chrome.storage.local.get(["contactLists"]);
  const lists = data.contactLists || {};
  const container = document.getElementById("savedLists");
  container.innerHTML = "";

  if (Object.keys(lists).length === 0) {
    container.innerHTML = '<p style="color:#aaa;font-size:12px;">No saved lists yet.</p>';
    return;
  }

  for (const [name, numbers] of Object.entries(lists)) {
    const count = numbers.split("\n").filter(n => n.trim()).length;
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span><b>${name}</b> <small style="color:#888;">(${count} numbers)</small></span>
      <div class="list-item-btns">
        <button class="icon-btn" data-name="${name}">Load</button>
        <button class="icon-btn" style="color:#e53935;" data-del="${name}">Delete</button>
      </div>`;
    container.appendChild(div);
  }

  container.querySelectorAll("[data-name]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("numbers").value = lists[btn.dataset.name];
      document.querySelector('[data-tab="send"]').click();
    });
  });

  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete list "${btn.dataset.del}"?`)) return;
      const data = await chrome.storage.local.get(["contactLists"]);
      const lists = data.contactLists || {};
      delete lists[btn.dataset.del];
      await chrome.storage.local.set({ contactLists: lists });
      loadSavedLists();
      loadContactListDropdown();
    });
  });
}

async function loadContactListDropdown() {
  const data = await chrome.storage.local.get(["contactLists"]);
  const lists = data.contactLists || {};
  const sel = document.getElementById("contactListSelect");
  sel.innerHTML = '<option value="">-- Load saved list --</option>';
  for (const name of Object.keys(lists)) {
    sel.innerHTML += `<option value="${name}">${name}</option>`;
  }
}

document.getElementById("loadListBtn").addEventListener("click", async () => {
  const name = document.getElementById("contactListSelect").value;
  if (!name) return;
  const data = await chrome.storage.local.get(["contactLists"]);
  const lists = data.contactLists || {};
  if (lists[name]) document.getElementById("numbers").value = lists[name];
});

// ─── TEMPLATES ────────────────────────────────────────────
document.getElementById("saveTemplateBtn").addEventListener("click", async () => {
  const name = document.getElementById("templateName").value.trim();
  const text = document.getElementById("templateText").value.trim();
  if (!name || !text) return alert("Enter a template name and message.");
  const data = await chrome.storage.local.get(["templates"]);
  const templates = data.templates || {};
  templates[name] = text;
  await chrome.storage.local.set({ templates });
  document.getElementById("templateName").value = "";
  document.getElementById("templateText").value = "";
  loadSavedTemplates();
  loadTemplateDropdown();
});

async function loadSavedTemplates() {
  const data = await chrome.storage.local.get(["templates"]);
  const templates = data.templates || {};
  const container = document.getElementById("savedTemplates");
  container.innerHTML = "";

  if (Object.keys(templates).length === 0) {
    container.innerHTML = '<p style="color:#aaa;font-size:12px;">No saved templates yet.</p>';
    return;
  }

  for (const [name, text] of Object.entries(templates)) {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span><b>${name}</b><br><small style="color:#888;">${text.substring(0, 50)}...</small></span>
      <div class="list-item-btns">
        <button class="icon-btn" data-name="${name}">Load</button>
        <button class="icon-btn" style="color:#e53935;" data-del="${name}">Delete</button>
      </div>`;
    container.appendChild(div);
  }

  container.querySelectorAll("[data-name]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("message").value = templates[btn.dataset.name];
      document.querySelector('[data-tab="send"]').click();
    });
  });

  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete template "${btn.dataset.del}"?`)) return;
      const data = await chrome.storage.local.get(["templates"]);
      const templates = data.templates || {};
      delete templates[btn.dataset.del];
      await chrome.storage.local.set({ templates });
      loadSavedTemplates();
      loadTemplateDropdown();
    });
  });
}

async function loadTemplateDropdown() {
  const data = await chrome.storage.local.get(["templates"]);
  const templates = data.templates || {};
  const sel = document.getElementById("templateSelect");
  sel.innerHTML = '<option value="">-- Load template --</option>';
  for (const name of Object.keys(templates)) {
    sel.innerHTML += `<option value="${name}">${name}</option>`;
  }
}

document.getElementById("loadTemplateBtn").addEventListener("click", async () => {
  const name = document.getElementById("templateSelect").value;
  if (!name) return;
  const data = await chrome.storage.local.get(["templates"]);
  const templates = data.templates || {};
  if (templates[name]) document.getElementById("message").value = templates[name];
});

// ─── SETTINGS ─────────────────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get([
    "dailyLimit", "blacklist", "licenseKey", "messageLimit", "messageCount"
  ]);
  document.getElementById("dailyLimit").value = data.dailyLimit || 0;
  document.getElementById("blacklistInput").value = (data.blacklist || []).join("\n");

  const licenseInfo = document.getElementById("licenseInfo");
  if (licenseInfo) {
    licenseInfo.textContent = data.licenseKey
      ? "Active Key: " + data.licenseKey
      : "No license found.";
  }

  const trialInfo = document.getElementById("trialInfo");
  const limit = parseInt(data.messageLimit) || 0;
  const count = parseInt(data.messageCount) || 0;
  if (trialInfo && limit > 0) {
    const remaining = limit - count;
    trialInfo.style.display = "block";
    trialInfo.textContent = `Trial License: ${remaining} of ${limit} messages remaining.`;
  } else if (trialInfo) {
    trialInfo.style.display = "none";
  }
}

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const limit = parseInt(document.getElementById("dailyLimit").value) || 0;
  const blacklist = document.getElementById("blacklistInput").value
    .split("\n").map(n => n.trim()).filter(n => n);
  await chrome.storage.local.set({ dailyLimit: limit, blacklist });
  document.getElementById("settingsSaved").textContent = "Settings saved!";
  setTimeout(() => document.getElementById("settingsSaved").textContent = "", 2000);
});

document.getElementById("deactivateBtn").addEventListener("click", async () => {
  if (!confirm("Deactivate this device? You will need your key to reactivate.")) return;
  await clearLicense();
  window.location.href = "license.html";
});

// ─── HISTORY ──────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get(["history"]);
  const history = data.history || [];
  const tbody = document.getElementById("historyBody");
  tbody.innerHTML = "";

  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#aaa;">No history yet.</td></tr>';
    return;
  }

  history.forEach(item => {
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();
    let badge = "";
    if (item.status === "sent") badge = '<span class="badge badge-sent">Sent</span>';
    else if (item.status === "failed") badge = '<span class="badge badge-failed">Failed</span>';
    else badge = '<span class="badge badge-skipped">Skipped</span>';
    tbody.innerHTML += `<tr><td>${item.number}</td><td>${badge}</td><td style="font-size:10px;">${timeStr}</td></tr>`;
  });
}

document.getElementById("clearHistoryBtn").addEventListener("click", async () => {
  if (!confirm("Clear all history?")) return;
  await chrome.storage.local.set({ history: [] });
  loadHistory();
});

document.getElementById("clearSentBtn").addEventListener("click", async () => {
  if (!confirm("Reset sent numbers? They can be messaged again.")) return;
  await chrome.storage.local.set({ sentNumbers: [] });
  alert("Sent numbers reset.");
});

document.getElementById("exportCsvBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["history"]);
  const history = data.history || [];
  if (history.length === 0) return alert("No history to export.");
  let csv = "Number,Status,Timestamp\n";
  history.forEach(item => { csv += `${item.number},${item.status},${item.timestamp}\n`; });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "whatsapp_history.csv";
  a.click();
  URL.revokeObjectURL(url);
});

// ─── SCHEDULE ─────────────────────────────────────────────
document.getElementById("scheduleBtn").addEventListener("click", () => {
  const date = document.getElementById("scheduleDate").value;
  const time = document.getElementById("scheduleTime").value;
  if (!date || !time) return alert("Pick a date and time.");
  const numbersRaw = document.getElementById("numbers").value.trim();
  const message = document.getElementById("message").value.trim();
  if (!numbersRaw || !message) return alert("Fill numbers and message first.");
  const numbers = numbersRaw.split("\n").map(n => n.trim()).filter(n => n);
  const scheduleTime = new Date(`${date}T${time}`).getTime();
  if (scheduleTime <= Date.now()) return alert("Please pick a future time.");
  const delayMs = scheduleTime - Date.now();
  chrome.runtime.sendMessage({
    action: "schedule",
    numbers, message,
    delayMin: minDelay * 60,
    delayMax: maxDelay * 60,
    dailyLimit: parseInt(document.getElementById("dailyLimit").value) || 0,
    delayMs
  });
  document.getElementById("scheduleStatus").textContent =
    "Scheduled for " + new Date(scheduleTime).toLocaleString();
  document.getElementById("scheduleBtn").style.display = "none";
  document.getElementById("cancelScheduleBtn").style.display = "block";
});

document.getElementById("cancelScheduleBtn").addEventListener("click", () => {
  chrome.alarms.clear("scheduledSend");
  chrome.storage.local.set({ running: false });
  document.getElementById("scheduleStatus").textContent = "Schedule canceled.";
  document.getElementById("scheduleBtn").style.display = "block";
  document.getElementById("cancelScheduleBtn").style.display = "none";
});

// ─── PROGRESS MESSAGES ────────────────────────────────────
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const pauseBtn = document.getElementById("pauseBtn");

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "progress") {
    const pct = Math.round((message.current / message.total) * 100);
    document.getElementById("progressBar").style.width = pct + "%";
    statusEl.textContent = `Sending ${message.current} / ${message.total}: ${message.number}`;
  }

  if (message.action === "countdown") {
    const mins = Math.floor(message.seconds / 60);
    const secs = message.seconds % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    statusEl.textContent = `Next in ${timeStr}... (${message.next} / ${message.total})`;
  }

  if (message.action === "trialExpired") {
    statusEl.textContent = message.reason;
    startBtn.disabled = false;
    startBtn.style.display = "block";
    stopBtn.style.display = "none";
    pauseBtn.style.display = "none";
    setRunningIndicator(false);
    alert(message.reason);
    setTimeout(() => {
      window.location.href = "license.html";
    }, 2000);
  }

  if (message.action === "done") {
    document.getElementById("progressBar").style.width = "100%";
    statusEl.textContent = "All done! Sent to " + message.total + " numbers.";
    startBtn.disabled = false;
    startBtn.style.display = "block";
    stopBtn.style.display = "none";
    pauseBtn.style.display = "none";
    setRunningIndicator(false);
  }

  if (message.action === "limitReached") {
    statusEl.textContent = `Daily limit of ${message.limit} reached!`;
    startBtn.disabled = false;
    startBtn.style.display = "block";
    stopBtn.style.display = "none";
    pauseBtn.style.display = "none";
    setRunningIndicator(false);
  }
});

// ─── START ────────────────────────────────────────────────
startBtn.addEventListener("click", () => {
  const numbersRaw = document.getElementById("numbers").value.trim();
  const message = document.getElementById("message").value.trim();
  if (!numbersRaw || !message) { statusEl.textContent = "Please fill both boxes."; return; }
  const numbers = numbersRaw.split("\n").map(n => n.trim()).filter(n => n);
  if (numbers.length === 0) { statusEl.textContent = "No valid numbers found."; return; }

  // Reset counts in storage and UI
  chrome.storage.local.set({ sentCount: 0, failCount: 0, skipCount: 0 });
  document.getElementById("sentCount").textContent = 0;
  document.getElementById("failCount").textContent = 0;
  document.getElementById("skipCount").textContent = 0;
  document.getElementById("progressBar").style.width = "0%";

  startBtn.disabled = true;
  startBtn.style.display = "none";
  stopBtn.style.display = "block";
  pauseBtn.style.display = "block";
  pauseBtn.textContent = "Pause";
  pauseBtn.className = "btn btn-gray";
  statusEl.textContent = `Starting... 0 / ${numbers.length}`;
  setRunningIndicator(true);

  chrome.runtime.sendMessage({
    action: "start",
    numbers, message,
    delayMin: minDelay * 60,
    delayMax: maxDelay * 60,
    dailyLimit: parseInt(document.getElementById("dailyLimit").value) || 0
  });
});

// ─── STOP ─────────────────────────────────────────────────
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" });
  chrome.storage.local.set({ running: false, paused: false });
  statusEl.textContent = "Stopped.";
  startBtn.disabled = false;
  startBtn.style.display = "block";
  stopBtn.style.display = "none";
  pauseBtn.style.display = "none";
  setRunningIndicator(false);
});

pauseBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["paused"]);
  if (data.paused) {
    chrome.runtime.sendMessage({ action: "resume" });
    statusEl.textContent = "Resuming...";
  } else {
    chrome.runtime.sendMessage({ action: "pause" });
    statusEl.textContent = "Paused.";
  }
});

// ─── RESTORE STATE ON OPEN ────────────────────────────────
chrome.storage.local.get(["running", "paused", "currentIndex", "numbers"], (data) => {
  if (data.running && data.numbers) {
    statusEl.textContent = data.paused ? "Paused..." : `Running... ${data.currentIndex} / ${data.numbers.length}`;
    startBtn.disabled = true;
    startBtn.style.display = "none";
    stopBtn.style.display = "block";
    pauseBtn.style.display = "block";
    setRunningIndicator(true);
  }
});

// ─── INIT ─────────────────────────────────────────────────
chrome.storage.local.get(["popupNumbers", "popupMessage"], (data) => {
  if (data.popupNumbers) document.getElementById("numbers").value = data.popupNumbers;
  if (data.popupMessage) document.getElementById("message").value = data.popupMessage;
});

document.getElementById("numbers").addEventListener("input", (e) => {
  chrome.storage.local.set({ popupNumbers: e.target.value });
});
document.getElementById("message").addEventListener("input", (e) => {
  chrome.storage.local.set({ popupMessage: e.target.value });
});

chrome.alarms.get("scheduledSend", (alarm) => {
  if (alarm) {
    document.getElementById("scheduleStatus").textContent = "Scheduled for " + new Date(alarm.scheduledTime).toLocaleString();
    document.getElementById("scheduleBtn").style.display = "none";
    document.getElementById("cancelScheduleBtn").style.display = "block";
  }
});

loadContactListDropdown();
loadTemplateDropdown();

// ─── CRM ─────────────────────────────────────────────────
function crmStatus(msg, color = "#555") {
  const el = document.getElementById("crmStatus");
  el.textContent = msg;
  el.style.color = color;
}

function importStatus(msg, color = "#555") {
  const el = document.getElementById("importStatus");
  el.textContent = msg;
  el.style.color = color;
}

function pushStatus(msg, color = "#555") {
  const el = document.getElementById("pushStatus");
  el.textContent = msg;
  el.style.color = color;
}

async function loadCrmTab() {
  const data = await chrome.storage.local.get(["crmUrl", "crmAutoSync", "sheetUrl"]);
  if (data.crmUrl) document.getElementById("crmUrl").value = data.crmUrl;
  document.getElementById("autoSyncToggle").checked = !!data.crmAutoSync;
  if (data.sheetUrl) document.getElementById("openSheetBtn").style.display = "block";
}

document.getElementById("saveCrmUrlBtn").addEventListener("click", async () => {
  const url = document.getElementById("crmUrl").value.trim();
  if (!url) return crmStatus("Please enter a URL.", "#e53935");
  await chrome.storage.local.set({ crmUrl: url });
  crmStatus("URL saved!", "#25d366");
  setTimeout(() => crmStatus(""), 2000);
});

document.getElementById("testCrmBtn").addEventListener("click", async () => {
  const url = document.getElementById("crmUrl").value.trim();
  if (!url) return crmStatus("Enter and save a URL first.", "#e53935");
  crmStatus("Testing connection...", "#1976d2");
  try {
    const res = await fetch(url + "?action=ping");
    const json = await res.json();
    if (json.success) {
      crmStatus("Connected: " + json.message, "#25d366");
      if (json.sheetUrl) {
        await chrome.storage.local.set({ sheetUrl: json.sheetUrl });
        document.getElementById("openSheetBtn").style.display = "block";
      }
    } else {
      crmStatus("Error: " + json.error, "#e53935");
    }
  } catch (e) {
    crmStatus("Connection failed: " + e.message, "#e53935");
  }
});

document.getElementById("openSheetBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["sheetUrl"]);
  if (data.sheetUrl) {
    chrome.tabs.create({ url: data.sheetUrl });
  }
});

document.getElementById("autoSyncToggle").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ crmAutoSync: e.target.checked });
});

document.getElementById("importLeadsBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["crmUrl", "sentNumbers"]);
  const url = data.crmUrl;
  if (!url) return importStatus("Save a CRM URL first.", "#e53935");

  importStatus("Fetching leads...", "#1976d2");
  try {
    const res = await fetch(url + "?action=get_leads");
    const json = await res.json();
    if (!json.success) return importStatus("Error: " + json.error, "#e53935");

    const sentNumbers = data.sentNumbers || [];
    const leads = json.leads || [];

    // Filter out already-sent numbers
    const newLeads = leads.filter(l => !sentNumbers.includes(l.phone));
    const phones = newLeads.map(l => l.phone).join("\n");

    if (!phones) {
      return importStatus(`All ${leads.length} leads already sent. Nothing to import.`, "#fb8c00");
    }

    document.getElementById("numbers").value = phones;
    chrome.storage.local.set({ popupNumbers: phones });
    document.querySelector('[data-tab="send"]').click();
    importStatus(`Imported ${newLeads.length} leads (${leads.length - newLeads.length} already sent, skipped).`, "#25d366");
  } catch (e) {
    importStatus("Failed: " + e.message, "#e53935");
  }
});

document.getElementById("pushResultsBtn").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["crmUrl", "history", "message"]);
  const url = data.crmUrl;
  if (!url) return pushStatus("Save a CRM URL first.", "#e53935");

  const history = data.history || [];
  if (history.length === 0) return pushStatus("No session history to push.", "#fb8c00");

  pushStatus(`Pushing ${history.length} records...`, "#1976d2");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "push_batch",
        results: history,
        message: data.message || ""
      })
    });
    const json = await res.json();
    if (json.success) {
      pushStatus(`Pushed ${json.pushed} records to sheet!`, "#25d366");
    } else {
      pushStatus("Error: " + json.error, "#e53935");
    }
  } catch (e) {
    pushStatus("Failed: " + e.message, "#e53935");
  }
});
