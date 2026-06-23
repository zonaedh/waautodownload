// ─── FIREBASE CONFIG ─────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDyH3cupi9ZsmBWsdIUPLD5To20svHeiiM",
  projectId: "wa-bulk-sender-d0308"
};

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// ─── GENERATE UNIQUE DEVICE ID ────────────────────────────
async function getDeviceId() {
  const data = await chrome.storage.local.get(["deviceId"]);
  if (data.deviceId) return data.deviceId;

  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  const deviceId = Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
  await chrome.storage.local.set({ deviceId });
  return deviceId;
}

// ─── BUILD FULL FIRESTORE URL FROM DOC NAME ───────────────
function buildDocUrl(docName) {
  // docName from Firebase is like:
  // "projects/wa-bulk-sender-d0308/databases/(default)/documents/licenses/XXXX"
  // We need to build the full REST API URL
  return `https://firestore.googleapis.com/v1/${docName}`;
}

// ─── VERIFY LICENSE KEY ───────────────────────────────────
async function verifyLicense(key) {
  const deviceId = await getDeviceId();

  try {
    const queryUrl = `${FIRESTORE_BASE}:runQuery?key=${FIREBASE_CONFIG.apiKey}`;

    const queryBody = {
      structuredQuery: {
        from: [{ collectionId: "licenses" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "key" },
            op: "EQUAL",
            value: { stringValue: key }
          }
        },
        limit: 1
      }
    };

    const response = await fetch(queryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queryBody)
    });

    if (!response.ok) {
      console.log("Firestore error:", response.status, await response.text());
      return { valid: false, reason: "Server error. Try again." };
    }

    const results = await response.json();
    console.log("Firestore results:", JSON.stringify(results));

    if (!results || !results[0] || !results[0].document) {
      return { valid: false, reason: "Invalid license key." };
    }

    const doc = results[0].document;
    const fields = doc.fields || {};
    const docUrl = buildDocUrl(doc.name);

    // Check if key is active
    if (!fields.active || fields.active.booleanValue !== true) {
      return { valid: false, reason: "This license key has been revoked." };
    }

    // Check expiry date
    if (fields.expiresAt && fields.expiresAt.stringValue) {
      const expiry = new Date(fields.expiresAt.stringValue);
      if (expiry < new Date()) {
        return { valid: false, reason: "This license key has expired." };
      }
    }

    // Read messageLimit and messageCount
    const messageLimitRaw = fields.messageLimit
      ? (fields.messageLimit.integerValue || fields.messageLimit.int64Value || 0)
      : 0;
    const messageCountRaw = fields.messageCount
      ? (fields.messageCount.integerValue || fields.messageCount.int64Value || 0)
      : 0;

    const limit = parseInt(messageLimitRaw) || 0;
    const count = parseInt(messageCountRaw) || 0;

    console.log(`License check - Limit: ${limit}, Count: ${count}`);

    if (limit > 0) {
      if (count >= limit) {
        await revokeKey(docUrl);
        return {
          valid: false,
          reason: `Trial limit of ${limit} messages reached. Please purchase a full license.`
        };
      }

      await chrome.storage.local.set({
        messageLimit: limit,
        messageCount: count,
        licenseDocUrl: docUrl
      });

      console.log(`Trial license - ${limit - count} messages remaining`);
    } else {
      await chrome.storage.local.set({
        messageLimit: 0,
        messageCount: 0,
        licenseDocUrl: docUrl
      });
      console.log("Full license - no message limit");
    }

    // Check device lock
    const registeredDevice = fields.deviceId ? fields.deviceId.stringValue : "";

    if (registeredDevice && registeredDevice !== deviceId) {
      return { valid: false, reason: "This key is already used on another device." };
    }

    // Register device if not already registered
    if (!registeredDevice) {
      await registerDevice(docUrl, deviceId);
    }

    return { valid: true };

  } catch (e) {
    console.log("License check error:", e);
    return { valid: false, reason: "Connection error. Check your internet." };
  }
}

// ─── REVOKE KEY IN FIREBASE ───────────────────────────────
async function revokeKey(docUrl) {
  try {
    const res = await fetch(
      `${docUrl}?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=active`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: { active: { booleanValue: false } }
        })
      }
    );
    console.log("Key revoked. Status:", res.status);
  } catch (e) {
    console.log("Failed to revoke key:", e);
  }
}

// ─── REGISTER DEVICE TO KEY ───────────────────────────────
async function registerDevice(docUrl, deviceId) {
  try {
    const res = await fetch(
      `${docUrl}?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=deviceId`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: { deviceId: { stringValue: deviceId } }
        })
      }
    );
    console.log("Device registered. Status:", res.status);
  } catch (e) {
    console.log("Failed to register device:", e);
  }
}

// ─── CHECK IF ALREADY LICENSED ────────────────────────────
async function isLicensed() {
  const data = await chrome.storage.local.get(["licenseKey", "licenseValid"]);
  return data.licenseKey && data.licenseValid === true;
}

// ─── SAVE LICENSE LOCALLY ─────────────────────────────────
async function saveLicense(key) {
  await chrome.storage.local.set({ licenseKey: key, licenseValid: true });
}

// ─── CLEAR LICENSE ────────────────────────────────────────
async function clearLicense() {
  await chrome.storage.local.remove([
    "licenseKey", "licenseValid",
    "messageLimit", "messageCount", "licenseDocUrl"
  ]);
}
