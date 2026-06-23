const keyInput = document.getElementById("keyInput");
const activateBtn = document.getElementById("activateBtn");
const messageEl = document.getElementById("message");

// No auto formatting - let user type freely in their own format
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") activateBtn.click();
});

activateBtn.addEventListener("click", async () => {
  const key = keyInput.value.trim().toUpperCase();

  if (!key) {
    messageEl.className = "error";
    messageEl.textContent = "Please enter a license key.";
    return;
  }

  activateBtn.disabled = true;
  messageEl.className = "checking";
  messageEl.textContent = "Checking license...";

  const result = await verifyLicense(key);

  if (result.valid) {
    await saveLicense(key);
    messageEl.className = "success";
    messageEl.textContent = "Activated! Opening extension...";
    setTimeout(() => {
      window.location.href = "popup.html";
    }, 1500);
  } else {
    messageEl.className = "error";
    messageEl.textContent = result.reason;
    activateBtn.disabled = false;
  }
});
