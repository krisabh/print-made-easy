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

  const connectHint = document.getElementById("connectHint");
  const pairingUrlInput = document.getElementById("pairingUrlInput");
  const connectUrlBtn = document.getElementById("connectUrlBtn");
  const pairSuccess = document.getElementById("pairSuccess");

  let connecting = false;

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
      : "Paste the connection link from Dashboard → Printers.";

    openAtLogin.checked = Boolean(config.openAtLogin);

    if (connectHint) {
      connectHint.textContent = paired
        ? "This Agent is paired. Paste a new connection link to reconnect to another shop."
        : "Paste the connection link from Dashboard → Printers.";
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

  async function connectWithUrl(url) {
    if (connecting) return;
    connecting = true;
    clearConnectMessage();
    setConnectMessage("Connecting…", true);
    connectUrlBtn.disabled = true;

    try {
      const result = await window.printAgent.connectPairingUrl(url);
      if (!result || result.success === false) {
        throw new Error(
          (result && result.error) ||
            "Unable to connect to PrintMadeEasy. Check your internet connection."
        );
      }
      setConnectMessage("Connected successfully.", true);
      showPairSuccess(result);
      await refresh();
    } catch (error) {
      setConnectMessage(
        error instanceof Error ? error.message : "Unable to connect.",
        false
      );
    } finally {
      connecting = false;
      connectUrlBtn.disabled = false;
    }
  }

  connectUrlBtn.addEventListener("click", () => {
    const url = pairingUrlInput.value.trim();
    if (!url) {
      setConnectMessage("Paste the connection link from your dashboard.", false);
      return;
    }
    void connectWithUrl(url);
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

  if (window.printAgent && typeof window.printAgent.onRefresh === "function") {
    window.printAgent.onRefresh(() => {
      refresh().catch(() => undefined);
    });
  }

  refresh().catch(() => {
    setMessage("Unable to load Agent status.", false);
  });

  setInterval(() => {
    if (!connecting) {
      refresh().catch(() => undefined);
    }
  }, 5000);
})();
