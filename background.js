importScripts("license.js");

console.log("Background service worker started");

function buildWhatsAppURL(number) {
  return `https://web.whatsapp.com/send?phone=${number}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitIfPaused() {
  while (true) {
    const data = await chrome.storage.local.get(["paused", "running"]);
    if (!data.running) return false;
    if (!data.paused) return true;
    await sleep(1000);
  }
}

function getRandomDelay(minSec, maxSec) {
  const min = Math.ceil(minSec);
  const max = Math.floor(maxSec);
  return Math.floor(Math.random() * (max - min + 1) + min);
}

async function closeExistingWhatsAppTabs() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  for (const tab of tabs) {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

async function logMessage(number, status) {
  const data = await chrome.storage.local.get(["history", "sentCount", "failCount", "skipCount"]);
  const history = data.history || [];
  let sentCount = data.sentCount || 0;
  let failCount = data.failCount || 0;
  let skipCount = data.skipCount || 0;

  history.unshift({ number, status, timestamp: new Date().toISOString() });
  if (history.length > 500) history.pop();

  if (status === "sent") sentCount++;
  else if (status === "failed") failCount++;
  else if (status.startsWith("skipped")) skipCount++;

  await chrome.storage.local.set({ history, sentCount, failCount, skipCount });

  chrome.runtime.sendMessage({
    action: "updateCounts",
    sentCount,
    failCount,
    skipCount
  }).catch(() => {});
}

async function updateDailyCount() {
  const today = new Date().toDateString();
  const data = await chrome.storage.local.get(["dailyCount", "dailyDate"]);
  let count = data.dailyCount || 0;
  const date = data.dailyDate || today;
  if (date !== today) count = 0;
  count++;
  await chrome.storage.local.set({ dailyCount: count, dailyDate: today });
  return count;
}

// ─── TRIAL COUNT HANDLER (inline to avoid importScripts issues) ───
async function handleTrialCount() {
  const data = await chrome.storage.local.get([
    "messageLimit", "messageCount", "licenseDocUrl"
  ]);

  if (!data.messageLimit || data.messageLimit === 0) {
    return { allowed: true };
  }

  const limit = parseInt(data.messageLimit);
  const currentCount = parseInt(data.messageCount) || 0;
  const newCount = currentCount + 1;

  await chrome.storage.local.set({ messageCount: newCount });

  if (data.licenseDocUrl) {
    try {
      const FIREBASE_CONFIG = {
        apiKey: "AIzaSyDyH3cupi9ZsmBWsdIUPLD5To20svHeiiM",
        projectId: "wa-bulk-sender-d0308"
      };
      await fetch(
        `${data.licenseDocUrl}?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=messageCount`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: { messageCount: { integerValue: newCount } }
          })
        }
      );
      console.log(`Trial count updated in Firebase: ${newCount} / ${limit}`);
    } catch (e) {
      console.log("Failed to update Firebase count:", e);
    }
  }

  if (newCount >= limit) {
    if (data.licenseDocUrl) {
      try {
        const FIREBASE_CONFIG = {
          apiKey: "AIzaSyDyH3cupi9ZsmBWsdIUPLD5To20svHeiiM",
          projectId: "wa-bulk-sender-d0308"
        };
        await fetch(
          `${data.licenseDocUrl}?key=${FIREBASE_CONFIG.apiKey}&updateMask.fieldPaths=active`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fields: { active: { booleanValue: false } }
            })
          }
        );
      } catch (e) {}
    }
    await chrome.storage.local.remove([
      "licenseKey", "licenseValid",
      "messageLimit", "messageCount", "licenseDocUrl"
    ]);
    return {
      allowed: false,
      reason: `Trial limit of ${limit} messages reached. Please purchase a full license.`
    };
  }

  const remaining = limit - newCount;
  return { allowed: true, remaining };
}


async function openNext() {
  if (!(await waitIfPaused())) return;

  const data = await chrome.storage.local.get([
    "numbers", "message", "delayMin", "delayMax",
    "currentIndex", "running", "dailyLimit",
    "blacklist", "sentNumbers"
  ]);

  if (!data.running) return;

  const {
    numbers, message, delayMin, delayMax,
    currentIndex, dailyLimit, blacklist = [], sentNumbers = []
  } = data;

  const todayData = await chrome.storage.local.get(["dailyCount", "dailyDate"]);
  const today = new Date().toDateString();
  let dailyCount = todayData.dailyDate === today ? (todayData.dailyCount || 0) : 0;

  if (dailyLimit > 0 && dailyCount >= dailyLimit) {
    await chrome.storage.local.set({ running: false });
    chrome.runtime.sendMessage({ action: "limitReached", limit: dailyLimit }).catch(() => {});
    return;
  }

  if (currentIndex >= numbers.length) {
    await chrome.storage.local.set({ running: false });
    chrome.runtime.sendMessage({ action: "done", total: numbers.length }).catch(() => {});
    return;
  }

  const number = numbers[currentIndex];

  if (blacklist.includes(number)) {
    await chrome.storage.local.set({ currentIndex: currentIndex + 1 });
    await logMessage(number, "skipped-blacklist");
    openNext();
    return;
  }

  if (sentNumbers.includes(number)) {
    await chrome.storage.local.set({ currentIndex: currentIndex + 1 });
    await logMessage(number, "skipped-already-sent");
    openNext();
    return;
  }

  const url = buildWhatsAppURL(number);

  chrome.runtime.sendMessage({
    action: "progress",
    current: currentIndex + 1,
    total: numbers.length,
    number: number,
    dailyCount: dailyCount
  }).catch(() => {});

  if (!(await waitIfPaused())) return;
  await closeExistingWhatsAppTabs();

  if (!(await waitIfPaused())) return;
  await sleep(3000);

  if (!(await waitIfPaused())) return;
  const tab = await chrome.tabs.create({ url, active: true });

  const onUpdated = (tabId, changeInfo) => {
    if (tabId === tab.id && changeInfo.status === "complete") {
      chrome.tabs.onUpdated.removeListener(onUpdated);

      setTimeout(async () => {
        let attempts = 0;
        const maxAttempts = 6;

        const trySend = async () => {
          if (!(await waitIfPaused())) {
            try { await chrome.tabs.remove(tab.id); } catch (e) {}
            return;
          }
          attempts++;
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              action: "typeAndSend",
              message: message
            });

            if (response && response.success === false) {
              // The inbox was not found or the send button couldn't be pressed.
              console.log("Failed to send: Inbox not found or send button not pressed");
              await logMessage(number, "failed");
            } else {
              // Handle trial count AFTER successful send
              const trialResult = await handleTrialCount();

              // Update sent numbers
              const fresh = await chrome.storage.local.get(["sentNumbers"]);
              const sent = fresh.sentNumbers || [];
              if (!sent.includes(number)) sent.push(number);
              await chrome.storage.local.set({ sentNumbers: sent });

              const newDailyCount = await updateDailyCount();
              await logMessage(number, "sent");

              // Send updated daily count
              chrome.runtime.sendMessage({
                action: "progress",
                current: currentIndex + 1,
                total: numbers.length,
                number: number,
                dailyCount: newDailyCount
              }).catch(() => {});

              // Update trial banner
              if (trialResult.remaining !== undefined) {
                chrome.runtime.sendMessage({
                  action: "trialRemaining",
                  remaining: trialResult.remaining
                }).catch(() => {});
              }

              // Trial expired after this send
              if (!trialResult.allowed) {
                await chrome.storage.local.set({ running: false });
                chrome.runtime.sendMessage({
                  action: "trialExpired",
                  reason: trialResult.reason
                }).catch(() => {});
                try { await chrome.tabs.remove(tab.id); } catch (e) {}
                return;
              }
            }

          } catch (e) {
            console.log(`Attempt ${attempts} failed:`, e.message);
            if (attempts < maxAttempts) {
              setTimeout(trySend, 2000);
              return;
            } else {
              await logMessage(number, "failed");
            }
          }

          setTimeout(async () => {
            try { await chrome.tabs.remove(tab.id); } catch (e) {}

            await chrome.storage.local.set({ currentIndex: currentIndex + 1 });

            if (currentIndex + 1 < numbers.length) {
              const randomDelay = getRandomDelay(delayMin, delayMax);
              let countdown = randomDelay;

              chrome.runtime.sendMessage({
                action: "countdown",
                seconds: countdown,
                next: currentIndex + 2,
                total: numbers.length
              }).catch(() => {});

              const countdownInterval = setInterval(async () => {
                const stateData = await chrome.storage.local.get(["paused", "running"]);
                if (!stateData.running) {
                  clearInterval(countdownInterval);
                  return;
                }
                if (stateData.paused) {
                  return;
                }

                countdown--;
                chrome.runtime.sendMessage({
                  action: "countdown",
                  seconds: countdown,
                  next: currentIndex + 2,
                  total: numbers.length
                }).catch(() => {});

                if (countdown <= 0) {
                  clearInterval(countdownInterval);
                  openNext();
                }
              }, 1000);
            } else {
              openNext();
            }

          }, 5000);
        };

        await trySend();

      }, 8000);
    }
  };

  chrome.tabs.onUpdated.addListener(onUpdated);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "scheduledSend") {
    const data = await chrome.storage.local.get(["running"]);
    if (!data.running) {
      await chrome.storage.local.set({ running: true });
      openNext();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "start") {
    chrome.storage.local.set({
      numbers: message.numbers,
      message: message.message,
      delayMin: message.delayMin,
      delayMax: message.delayMax,
      dailyLimit: message.dailyLimit || 0,
      currentIndex: 0,
      running: true,
      paused: false,
      sentCount: 0,
      failCount: 0,
      skipCount: 0
    }, () => { openNext(); });
  }

  if (message.action === "stop") {
    chrome.storage.local.set({ running: false, paused: false });
  }

  if (message.action === "pause") {
    chrome.storage.local.set({ paused: true });
  }

  if (message.action === "resume") {
    chrome.storage.local.set({ paused: false });
  }

  if (message.action === "schedule") {
    chrome.alarms.create("scheduledSend", { when: Date.now() + message.delayMs });
    chrome.storage.local.set({
      numbers: message.numbers,
      message: message.message,
      delayMin: message.delayMin,
      delayMax: message.delayMax,
      dailyLimit: message.dailyLimit || 0,
      currentIndex: 0,
      running: false,
      paused: false,
      sentCount: 0,
      failCount: 0,
      skipCount: 0
    });
  }

  if (message.action === "clearHistory") {
    chrome.storage.local.set({ history: [] });
  }

  if (message.action === "clearSentNumbers") {
    chrome.storage.local.set({ sentNumbers: [] });
  }
});
