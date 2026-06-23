// ============================================================
// WhatsApp Bulk Sender — Google Apps Script CRM
// ============================================================
// SETUP INSTRUCTIONS:
// 1. Open your Google Sheet
// 2. Click Extensions -> Apps Script
// 3. Replace everything in Code.gs with this file
// 4. Click Deploy -> New Deployment
// 5. Type: Web App
// 6. Execute as: Me
// 7. Who has access: Anyone
// 8. Click Deploy, copy the Web App URL
// 9. Paste the URL in the extension's CRM tab
// ============================================================

// ─── HANDLE GET REQUESTS (read data) ─────────────────────────
function doGet(e) {
  try {
    ensureSheetsExist();
    const action = e.parameter.action;

    if (action === "get_leads") {
      return getLeads();
    }

    if (action === "get_sent") {
      return getSheetData("Sent");
    }

    if (action === "ping") {
      return jsonResponse({ success: true, message: "Connected to CRM Sheet!" });
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ─── HANDLE POST REQUESTS (write data) ───────────────────────
function doPost(e) {
  try {
    ensureSheetsExist();
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // Sync a single result (real-time auto-sync)
    if (action === "sync_result") {
      return syncSingleResult(data);
    }

    // Push a batch of results (manual push at end of session)
    if (action === "push_batch") {
      return pushBatchResults(data.results, data.message);
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// ─── GET LEADS ───────────────────────────────────────────────
function getLeads() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Leads");
  const data = sheet.getDataRange().getValues();
  const leads = [];

  // Skip header row (row 0)
  for (let i = 1; i < data.length; i++) {
    const phone = String(data[i][0] || "").trim().replace(/\D/g, "");
    const name  = String(data[i][1] || "").trim();
    if (phone.length > 5) {
      leads.push({ phone, name });
    }
  }

  return jsonResponse({ success: true, leads, count: leads.length });
}

// ─── GET SHEET DATA ──────────────────────────────────────────
function getSheetData(tabName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    rows.push(data[i]);
  }
  return jsonResponse({ success: true, rows });
}

// ─── SYNC SINGLE RESULT ──────────────────────────────────────
function syncSingleResult(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { number, status, timestamp, message } = data;

  if (status === "sent") {
    const sheet = ss.getSheetByName("Sent");
    sheet.appendRow([number, timestamp, (message || "").substring(0, 120)]);
  } else if (status === "failed") {
    const sheet = ss.getSheetByName("Failed");
    sheet.appendRow([number, timestamp]);
  } else if (status.startsWith("skipped")) {
    const sheet = ss.getSheetByName("Skipped");
    const reason = status === "skipped-blacklist" ? "Blacklisted" : "Already Sent";
    sheet.appendRow([number, timestamp, reason]);
  }

  return jsonResponse({ success: true });
}

// ─── PUSH BATCH RESULTS ──────────────────────────────────────
function pushBatchResults(results, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  results.forEach(function(item) {
    const ts = item.timestamp || new Date().toISOString();

    if (item.status === "sent") {
      ss.getSheetByName("Sent").appendRow([
        item.number, ts, (message || "").substring(0, 120)
      ]);
    } else if (item.status === "failed") {
      ss.getSheetByName("Failed").appendRow([item.number, ts]);
    } else if ((item.status || "").startsWith("skipped")) {
      const reason = item.status === "skipped-blacklist" ? "Blacklisted" : "Already Sent";
      ss.getSheetByName("Skipped").appendRow([item.number, ts, reason]);
    }
  });

  return jsonResponse({ success: true, pushed: results.length });
}

// ─── ENSURE SHEETS EXIST ─────────────────────────────────────
function ensureSheetsExist() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetDefs = {
    "Leads":   { headers: ["Phone", "Name", "Notes"],          color: "#075e54" },
    "Sent":    { headers: ["Phone", "Timestamp", "Message Preview"], color: "#25d366" },
    "Failed":  { headers: ["Phone", "Timestamp"],              color: "#e53935" },
    "Skipped": { headers: ["Phone", "Timestamp", "Reason"],    color: "#fb8c00" }
  };

  for (const [name, def] of Object.entries(sheetDefs)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(def.headers);
      const headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setFontWeight("bold")
                 .setBackground(def.color)
                 .setFontColor("white")
                 .setFontSize(11);
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(1, 150); // Phone column
      sheet.setColumnWidth(2, 180); // Timestamp column
    }
  }
}

// ─── HELPER ──────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
