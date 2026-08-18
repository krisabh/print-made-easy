(() => {
  const printerSelect = document.getElementById("printerSelect");
  const printerEmpty = document.getElementById("printerEmpty");
  const agentStatus = document.getElementById("agentStatus");
  const agentDot = document.getElementById("agentDot");
  const printerStatus = document.getElementById("printerStatus");
  const printerDot = document.getElementById("printerDot");
  const connectionMeta = document.getElementById("connectionMeta");
  const message = document.getElementById("message");
  const connectMessage = document.getElementById("connectMessage");
  const openAtLogin = document.getElementById("openAtLogin");
  const testPrintBtn = document.getElementById("testPrintBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const dashboardBtn = document.getElementById("dashboardBtn");

  const connectCard = document.getElementById("connectCard");
  const scanQrBtn = document.getElementById("scanQrBtn");
  const manualLinkBtn = document.getElementById("manualLinkBtn");
  const scannerPanel = document.getElementById("scannerPanel");
  const manualPanel = document.getElementById("manualPanel");
  const scannerVideo = document.getElementById("scannerVideo");
  const scannerCanvas = document.getElementById("scannerCanvas");
  const scannerHint = document.getElementById("scannerHint");
  const cancelScanBtn = document.getElementById("cancelScanBtn");
  const pairingUrlInput = document.getElementById("pairingUrlInput");
  const connectUrlBtn = document.getElementById("connectUrlBtn");
  const cancelManualBtn = document.getElementById("cancelManualBtn");
  const pairSuccess = document.getElementById("pairSuccess");

  let cameraStream = null;
  let scanRafId = null;
  let connecting = false;
  let scanActive = false;

  function setMessage(text, ok = true) {
    message.textContent = text;
    message.className = `message show ${ok ? "ok" : "err"}`;
  }

  function setConnectMessage(text, ok = true) {
    connectMessage.textContent = text;
    connectMessage.className = `message show ${ok ? "ok" : "err"}`;
  }

  function clearConnectMessage() {
    connectMessage.textContent = "";
    connectMessage.className = "message";
  }

  function stopCamera() {
    scanActive = false;
    if (scanRafId != null) {
      cancelAnimationFrame(scanRafId);
      scanRafId = null;
    }
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      cameraStream = null;
    }
    if (scannerVideo) {
      scannerVideo.srcObject = null;
    }
  }

  // Exposed for main-process hide/close cleanup.
  window.__pmeStopCamera = stopCamera;

  function hideScannerUi() {
    scannerPanel.classList.add("hidden");
    scannerHint.textContent = "";
  }

  function hideManualUi() {
    manualPanel.classList.add("hidden");
  }

  function showConnectOptions() {
    scanQrBtn.classList.remove("hidden");
    manualLinkBtn.classList.remove("hidden");
  }

  async function refresh() {
    const state = await window.printAgent.getState();
    const printers = state.printers || [];
    const config = state.config || {};
    const selectedPrinter = config.selectedPrinter || null;

    printerSelect.innerHTML = "";
    if (printers.length === 0) {
      printerEmpty.style.display = "block";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No printers found";
      printerSelect.appendChild(option);
    } else {
      printerEmpty.style.display = "none";
      for (const printer of printers) {
        const option = document.createElement("option");
        option.value = printer.name;
        option.textContent = printer.isDefault
          ? `${printer.name} (Default)`
          : printer.name;
        if (printer.name === selectedPrinter) {
          option.selected = true;
        }
        printerSelect.appendChild(option);
      }
    }

    const paired = Boolean(state.paired || config.paired);
    const online =
      state.connection && state.connection.status === "Connected";
    agentStatus.textContent = paired
      ? online
        ? "Agent Online"
        : "Agent Running (offline)"
      : "Not Connected";
    agentDot.className = `dot ${paired && online ? "ok" : paired ? "warn" : "bad"}`;

    const pStatus = String(state.selectedPrinterStatus || "Unknown");
    const pLower = pStatus.toLowerCase();
    printerStatus.textContent =
      pLower === "online"
        ? "Ready"
        : pLower === "offline"
          ? "Offline / Unavailable"
          : pStatus;
    printerDot.className = `dot ${
      pLower === "online" ? "ok" : pLower === "offline" ? "bad" : "warn"
    }`;

    const shopLabel = config.shopName
      ? `${config.shopName} (${config.shopCode || "—"})`
      : config.shopCode || "—";
    connectionMeta.textContent = paired
      ? `Shop: ${shopLabel} · Agent: ${config.agentId || "—"} · ${
          online
            ? "Heartbeat OK"
            : (state.connection && state.connection.message) ||
              "Waiting for backend"
        }`
      : "Scan QR or paste connection link to pair this Agent with a shop.";

    openAtLogin.checked = Boolean(config.openAtLogin);

    if (paired && !connecting) {
      connectCard.querySelector(".meta").textContent =
        "This Agent is paired. Scan a new QR to reconnect to another shop.";
    }
  }

  function showPairSuccess(result) {
    pairSuccess.innerHTML = `
      <strong>Connected successfully</strong>
      Shop: ${escapeHtml(result.shopName || "—")}<br />
      Shop Code: ${escapeHtml(result.shopCode || "—")}<br />
      Agent: ${escapeHtml(result.agentId || "—")}<br />
      Status: Online
    `;
    pairSuccess.classList.remove("hidden");
    const done = document.createElement("button");
    done.type = "button";
    done.textContent = "Done";
    done.style.marginTop = "10px";
    done.addEventListener("click", () => {
      pairSuccess.classList.add("hidden");
      pairSuccess.innerHTML = "";
      clearConnectMessage();
      showConnectOptions();
    });
    pairSuccess.appendChild(done);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function connectWithUrl(url, source) {
    if (connecting) return;
    connecting = true;
    clearConnectMessage();
    setConnectMessage(
      source === "qr" ? "QR detected. Connecting…" : "Connecting…",
      true
    );
    connectUrlBtn.disabled = true;
    scanQrBtn.disabled = true;

    try {
      const result = await window.printAgent.connectPairingUrl(url);
      if (!result || result.success === false) {
        throw new Error(
          (result && result.error) ||
            "Unable to connect to PrintMadeEasy. Check your internet connection."
        );
      }
      stopCamera();
      hideScannerUi();
      hideManualUi();
      scanQrBtn.classList.add("hidden");
      manualLinkBtn.classList.add("hidden");
      setConnectMessage("Connected successfully.", true);
      showPairSuccess(result);
      await refresh();
    } catch (error) {
      stopCamera();
      hideScannerUi();
      showConnectOptions();
      setConnectMessage(
        error instanceof Error ? error.message : "Unable to connect.",
        false
      );
    } finally {
      connecting = false;
      connectUrlBtn.disabled = false;
      scanQrBtn.disabled = false;
    }
  }

  function scanFrame() {
    if (!scanActive || connecting) return;
    if (
      !scannerVideo ||
      scannerVideo.readyState < scannerVideo.HAVE_ENOUGH_DATA
    ) {
      scanRafId = requestAnimationFrame(scanFrame);
      return;
    }

    const width = scannerVideo.videoWidth;
    const height = scannerVideo.videoHeight;
    if (!width || !height) {
      scanRafId = requestAnimationFrame(scanFrame);
      return;
    }

    scannerCanvas.width = width;
    scannerCanvas.height = height;
    const ctx = scannerCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof jsQR !== "function") {
      scanRafId = requestAnimationFrame(scanFrame);
      return;
    }

    ctx.drawImage(scannerVideo, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });

    if (code && code.data) {
      scanActive = false;
      scannerHint.textContent = "QR detected. Connecting…";
      stopCamera();
      void connectWithUrl(String(code.data).trim(), "qr");
      return;
    }

    scanRafId = requestAnimationFrame(scanFrame);
  }

  async function startScanner() {
    clearConnectMessage();
    pairSuccess.classList.add("hidden");
    hideManualUi();
    stopCamera();

    scannerPanel.classList.remove("hidden");
    scannerHint.textContent = "Starting camera…";
    scanQrBtn.classList.add("hidden");
    manualLinkBtn.classList.add("hidden");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      scannerHint.textContent = "Unable to access the camera.";
      setConnectMessage("Unable to access the camera.", false);
      showConnectOptions();
      hideScannerUi();
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      scannerVideo.srcObject = cameraStream;
      await scannerVideo.play();
      scannerHint.textContent = "Position the QR code inside the frame.";
      scanActive = true;
      scanRafId = requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      hideScannerUi();
      showConnectOptions();
      const name = error && typeof error === "object" ? error.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setConnectMessage(
          "Camera permission is required to scan the connection QR.",
          false
        );
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "secondary";
        retry.textContent = "Try Again";
        retry.style.marginTop = "8px";
        retry.addEventListener("click", () => {
          clearConnectMessage();
          void startScanner();
        });
        connectMessage.appendChild(document.createElement("br"));
        connectMessage.appendChild(retry);
      } else {
        setConnectMessage("Unable to access the camera.", false);
      }
    }
  }

  scanQrBtn.addEventListener("click", () => {
    void startScanner();
  });

  cancelScanBtn.addEventListener("click", () => {
    stopCamera();
    hideScannerUi();
    clearConnectMessage();
    showConnectOptions();
  });

  manualLinkBtn.addEventListener("click", () => {
    stopCamera();
    hideScannerUi();
    clearConnectMessage();
    pairSuccess.classList.add("hidden");
    manualPanel.classList.remove("hidden");
    scanQrBtn.classList.add("hidden");
    manualLinkBtn.classList.add("hidden");
    pairingUrlInput.focus();
  });

  cancelManualBtn.addEventListener("click", () => {
    hideManualUi();
    clearConnectMessage();
    showConnectOptions();
  });

  connectUrlBtn.addEventListener("click", () => {
    const url = pairingUrlInput.value.trim();
    if (!url) {
      setConnectMessage("Paste the connection link from your dashboard.", false);
      return;
    }
    void connectWithUrl(url, "manual");
  });

  printerSelect.addEventListener("change", async () => {
    await window.printAgent.setPrinter(printerSelect.value);
    setMessage(`Printer set to ${printerSelect.value}`);
    await refresh();
  });

  testPrintBtn.addEventListener("click", async () => {
    testPrintBtn.disabled = true;
    try {
      const result = await window.printAgent.testPrint();
      if (result && result.success === false) {
        setMessage(result.error || "Test print failed.", false);
      } else {
        setMessage((result && result.message) || "Test print sent.", true);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Test print failed.",
        false
      );
    } finally {
      testPrintBtn.disabled = false;
      await refresh();
    }
  });

  refreshBtn.addEventListener("click", async () => {
    await refresh();
    setMessage("Status refreshed.");
  });

  dashboardBtn.addEventListener("click", async () => {
    await window.printAgent.openDashboard();
  });

  openAtLogin.addEventListener("change", async () => {
    try {
      const result = await window.printAgent.setOpenAtLogin(openAtLogin.checked);
      openAtLogin.checked = Boolean(result.openAtLogin);
      setMessage(
        result.openAtLogin
          ? "Start with Windows enabled."
          : "Start with Windows disabled."
      );
    } catch (error) {
      openAtLogin.checked = !openAtLogin.checked;
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update Start with Windows.",
        false
      );
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopCamera();
      hideScannerUi();
      if (!connecting) {
        showConnectOptions();
      }
    }
  });

  if (window.printAgent && typeof window.printAgent.onRefresh === "function") {
    window.printAgent.onRefresh(() => {
      refresh().catch(() => undefined);
    });
  }

  refresh().catch(() => {
    setMessage("Unable to load Agent status.", false);
  });

  setInterval(() => {
    if (!connecting && !scanActive) {
      refresh().catch(() => undefined);
    }
  }, 5000);
})();
