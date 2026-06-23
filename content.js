console.log("WhatsApp Bulk Sender content script loaded");

const useHereObserver = new MutationObserver(() => {
  const selectors = ['button', 'div[role="button"]'];
  for (const selector of selectors) {
    const btns = document.querySelectorAll(selector);
    btns.forEach(btn => {
      const text = btn.innerText || btn.textContent || "";
      if (
        text.toLowerCase().includes("use here") ||
        text.toLowerCase().includes("use whatsapp here")
      ) {
        btn.click();
        useHereObserver.disconnect();
      }
    });
  }
});
useHereObserver.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "typeAndSend") {
    typeAndSend(message.message).then(result => {
      sendResponse({ success: result });
    });
    return true; // Keep message channel open for async response
  }
});

window.addEventListener("load", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const phone = urlParams.get("phone");
  const text = urlParams.get("text");
  if (phone && text) {
    setTimeout(() => typeAndSend(decodeURIComponent(text)), 5000);
  }
});

async function typeAndSend(text) {
  const inputBox = await waitForElement(
    '[data-testid="conversation-compose-box-input"]', 15000
  );
  if (!inputBox) return false;

  inputBox.focus();

  // Select all existing content and delete it completely
  inputBox.dispatchEvent(new KeyboardEvent("keydown", {
    key: "a", code: "KeyA", keyCode: 65, ctrlKey: true, bubbles: true
  }));
  await sleep(300);

  inputBox.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Delete", code: "Delete", keyCode: 46, bubbles: true
  }));
  await sleep(300);

  // Also use execCommand as backup clear
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);
  await sleep(300);

  // Now insert the text using a native paste event to preserve all formatting, spaces, and line breaks
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", text);
  
  const pasteEvent = new ClipboardEvent("paste", {
    clipboardData: dataTransfer,
    bubbles: true,
    cancelable: true
  });
  pasteEvent.clipboardData = dataTransfer;
  
  inputBox.dispatchEvent(pasteEvent);
  
  // Fallback if paste fails
  if (inputBox.textContent.trim() === "") {
    document.execCommand("insertText", false, text);
  }

  await sleep(2000);

  const sendSelectors = [
    '[data-testid="send"]',
    'button[aria-label="Send"]',
    'span[data-testid="send"]',
    '[data-icon="send"]'
  ];

  let sent = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const selector of sendSelectors) {
      const btn = document.querySelector(selector);
      if (btn) { btn.click(); sent = true; break; }
    }
    if (sent) break;
    await sleep(1500);
  }

  if (!sent) {
    // If the send button wasn't found, it likely means text couldn't be pasted or an issue occurred.
    // We return false here so the background script marks it as failed.
    return false;
  }
  
  return true;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
