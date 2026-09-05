(() => {
  const printerSelect = document.getElementById("printerSelect");
  const printerEmpty = document.getElementById("printerEmpty");
  const agentStatus = document.getElementById("agentStatus");
  const agentDot = document.getElementById("agentDot");
  const printerStatus = document.getElementById("printerStatus");
  const printerDot = document.getElementById("printerDot");
  const printerPausedNote = document.getElementById("printerPausedNote");
  const connectionMeta = document.getElementById("connectionMeta");
  const headerPill = document.getElementById("headerPill");
  const agentFooter = document.getElementById("agentFooter");
  const message = document.getElementById("message");
  const connectMessage = document.getElementById("connectMessage");
  const openAtLogin = document.getElementById("openAtLogin");
  const testPrintBtn = document.getElementById("testPrintBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const dashboardBtn = document.getElementById("dashboardBtn");
  const colorList = document.getElementById("colorList");
  const colorEmpty = document.getElementById("colorEmpty");
  const connectCard = document.getElementById("connectCard");

  const connectHint = document.getElementById("connectHint");
  const pairingUrlInput = document.getElementById("pairingUrlInput");
  const connectUrlBtn = document.getElementById("connectUrlBtn");
  const pairSuccess = document.getElementById("pairSuccess");

  let connecting = false;
  let colorBusy = false;

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

  function renderColorSupport(state) {
    const paired = Boolean(state.paired || (state.config && state.config.paired));
    const detected = state.printers || [];
    const capabilities = state.printerCapabilities || [];
    const selectedPrinter =
      (state.config && state.config.selectedPrinter) || null;

    const byName = new Map();
    for (const row of capabilities) {
      byName.set(row.printerName, {
        name: row.printerName,
        colorSupported: Boolean(row.colorSupported),
        status: row.status || "unknown",
        fromServer: true,
      });
    }
    for (const printer of detected) {
      const existing = byName.get(printer.name);
      byName.set(printer.name, {
        name: printer.name,
        colorSupported: existing
          ? Boolean(existing.colorSupported)
          : false,
        status: printer.status || (existing && existing.status) || "Unknown",
        fromServer: Boolean(existing && existing.fromServer),
      });
    }
    if (selectedPrinter && !byName.has(selectedPrinter)) {
      byName.set(selectedPrinter, {
        name: selectedPrinter,
        colorSupported: false,
        status: "Unavailable",
        fromServer: false,
      });
    }

    const rows = Array.from(byName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    colorList.innerHTML = "";
    if (!paired || rows.length === 0) {
      colorEmpty.style.display = "block";
      colorEmpty.textContent = paired
        ? "No printers to configure yet."
        : "Connect the Agent and detect printers to configure color support.";
      return;
    }

    colorEmpty.style.display = "none";
    for (const row of rows) {
      const wrap = document.createElement("div");
      wrap.className = "color-row";

      const left = document.createElement("div");
      left.className = "name";
      left.innerHTML = `${escapeHtml(row.name)}<div class="meta-line">${escapeHtml(
        String(row.status),
      )}</div>`;

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = Boolean(row.colorSupported);
      checkbox.disabled = colorBusy;
      checkbox.setAttribute("aria-label", `Supports color for ${row.name}`);
      checkbox.addEventListener("change", async () => {
        if (colorBusy) return;
        colorBusy = true;
        checkbox.disabled = true;
        try {
          const updated = await window.printAgent.setPrinterColor(
            row.name,
            checkbox.checked,
          );
          checkbox.checked = Boolean(updated.colorSupported);
          setMessage(
            updated.colorSupported
              ? `${row.name}: Supports Color ON`
              : `${row.name}: Supports Color OFF`,
          );
          // Soft UI refresh only — avoid stacked detect/heartbeat loops.
          await refresh({ light: true });
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not update color support.",
            false,
          );
        } finally {
          colorBusy = false;
          checkbox.disabled = false;
        }
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode("Supports Color"));
      wrap.appendChild(left);
      wrap.appendChild(label);
      colorList.appendChild(wrap);
    }
  }

  async function refresh(options) {
    const light = Boolean(options && options.light);
    const state = await window.printAgent.getState(
      light ? { light: true } : undefined,
    );
    const printers = state.printers || [];
    const config = state.config || {};
    const selectedPrinter = config.selectedPrinter || null;
    const version = state.agentVersion || "1.2.0";

    if (agentFooter) {
      agentFooter.textContent = `PrintMadeEasy Agent ${version}`;
    }

    printerSelect.innerHTML = "";
    if (printers.length === 0 && !selectedPrinter) {
      printerEmpty.style.display = "block";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No printers found";
      printerSelect.appendChild(option);
    } else {
      printerEmpty.style.display = "none";

      // Keep configured default visible even when Windows no longer detects it.
      const names = new Set(printers.map((p) => p.name));
      if (selectedPrinter && !names.has(selectedPrinter)) {
        const missing = document.createElement("option");
        missing.value = selectedPrinter;
        missing.textContent = `${selectedPrinter} (Unavailable)`;
        missing.selected = true;
        printerSelect.appendChild(missing);
      }

      for (const printer of printers) {
        const option = document.createElement("option");
        option.value = printer.name;
        const isSelected = printer.name === selectedPrinter;
        option.textContent = isSelected
          ? `${printer.name} (Default)`
          : printer.name;
        if (isSelected) {
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
        ? "Online"
        : "Running (offline)"
      : "Not connected";
    agentDot.className = `dot ${paired && online ? "ok" : paired ? "warn" : "bad"}`;

    if (headerPill) {
      headerPill.textContent = paired
        ? online
          ? "Connected"
          : "Offline"
        : "Not connected";
      headerPill.className = `pill ${
        paired && online ? "ok" : paired ? "warn" : "bad"
      }`;
    }

    if (connectCard) {
      // Keep connect card visible so shopkeeper can re-pair if needed.
      connectCard.style.display = "block";
    }

    const available = state.selectedPrinterAvailable !== false;
    const pStatus = String(state.selectedPrinterStatus || "Unknown");
    const pLower = pStatus.toLowerCase();
    const printerMissing =
      Boolean(selectedPrinter) && available === false;

    if (printerMissing) {
      printerStatus.textContent = "Unavailable";
      if (printerPausedNote) printerPausedNote.classList.add("show");
    } else if (pLower === "online") {
      printerStatus.textContent = "Online";
      if (printerPausedNote) printerPausedNote.classList.remove("show");
    } else if (pLower === "offline") {
      printerStatus.textContent = "Offline";
      if (printerPausedNote) printerPausedNote.classList.remove("show");
    } else {
      printerStatus.textContent = pStatus;
      if (printerPausedNote) printerPausedNote.classList.remove("show");
    }

    printerDot.className = `dot ${
      printerMissing || pLower === "offline"
        ? "bad"
        : pLower === "online"
          ? "ok"
          : "warn"
    }`;

    const shopLabel = config.shopName
      ? `${config.shopName} (${config.shopCode || "—"})`
      : config.shopCode || "—";
    connectionMeta.textContent = paired
      ? online
        ? `Shop: ${shopLabel} · Synced`
        : `Shop: ${shopLabel} · ${
            (state.connection && state.connection.message) ||
            "Waiting for backend"
          }`
      : "Paste the connection link from Dashboard → Printers.";

    openAtLogin.checked = Boolean(config.openAtLogin);

    if (connectHint) {
      connectHint.textContent = paired
        ? "This Agent is paired. Paste a new connection link only if you need to reconnect to another shop."
        : "Paste the connection link from Dashboard → Printers.";
    }

    renderColorSupport(state);
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
    done.className = "secondary";
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
    if (!printerSelect.value) return;
    await window.printAgent.setPrinter(printerSelect.value);
    setMessage(`Default printer set to ${printerSelect.value}`);
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
      refresh({ light: true }).catch(() => undefined);
    });
  }

  refresh().catch(() => {
    setMessage("Unable to load Agent status.", false);
  });

  // Light UI poll — background heartbeat already syncs cloud every 5s.
  setInterval(() => {
    if (!connecting && !colorBusy) {
      refresh({ light: true }).catch(() => undefined);
    }
  }, 12_000);
})();
