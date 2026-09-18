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
  const updateBanner = document.getElementById("updateBanner");
  const updateTitle = document.getElementById("updateTitle");
  const updateMeta = document.getElementById("updateMeta");
  const updateActions = document.getElementById("updateActions");
  const updateNowBtn = document.getElementById("updateNowBtn");
  const updateLaterBtn = document.getElementById("updateLaterBtn");
  const updateCancelBtn = document.getElementById("updateCancelBtn");
  const updateProgressWrap = document.getElementById("updateProgressWrap");
  const updateProgressBar = document.getElementById("updateProgressBar");
  const updateProgressLabel = document.getElementById("updateProgressLabel");
  const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");

  const connectHint = document.getElementById("connectHint");
  const loginPanel = document.getElementById("loginPanel");
  const signedInPanel = document.getElementById("signedInPanel");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginBtn = document.getElementById("loginBtn");
  const pairSuccess = document.getElementById("pairSuccess");

  let connecting = false;
  let colorBusy = false;
  let updateCheckBusy = false;

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

  function renderUpdateState(update) {
    if (!updateBanner || !updateTitle || !updateMeta || !updateActions) return;
    const state = update || {};
    const status = state.status || "idle";
    const current = state.currentVersion || "";
    const latest = state.latestVersion || "";
    const notes = state.notes || "";
    const dismissed = Boolean(state.dismissed);
    const showAvailable =
      status === "available" && state.updateAvailable && !dismissed;
    const showDownloadBusy =
      status === "downloading" || status === "verifying";
    const showReady =
      status === "readyToInstall" || status === "waitingForIdle";
    const showInstalling = status === "installing";
    const showUnavailable = status === "verificationUnavailable";

    updateBanner.classList.toggle("available", showAvailable || showReady);
    updateBanner.classList.toggle("downloading", status === "downloading");
    updateBanner.classList.toggle("verifying", status === "verifying");
    updateBanner.classList.toggle("ready", showReady || showInstalling);
    updateBanner.classList.toggle("unavailable", showUnavailable);

    if (updateNowBtn) {
      updateNowBtn.style.display =
        showAvailable || showReady ? "" : "none";
      updateNowBtn.disabled = showDownloadBusy || showInstalling;
      updateNowBtn.textContent = showReady ? "Update Now" : "Update Now";
    }
    if (updateLaterBtn) {
      updateLaterBtn.style.display = showAvailable ? "" : "none";
    }
    if (updateCancelBtn) {
      updateCancelBtn.style.display = showDownloadBusy ? "" : "none";
      updateCancelBtn.disabled = false;
    }

    const showActions = showAvailable || showDownloadBusy || showReady;
    updateActions.style.display = showActions ? "flex" : "none";

    if (updateProgressWrap && updateProgressBar && updateProgressLabel) {
      if (showDownloadBusy) {
        updateProgressWrap.classList.add("show");
        const pct = state.progressPercent;
        if (typeof pct === "number" && Number.isFinite(pct)) {
          updateProgressBar.classList.remove("indeterminate");
          updateProgressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
          updateProgressLabel.textContent =
            status === "verifying"
              ? "Verifying update..."
              : `Downloading update... ${Math.floor(pct)}%`;
        } else {
          updateProgressBar.classList.add("indeterminate");
          updateProgressBar.style.width = "40%";
          updateProgressLabel.textContent = "Downloading update...";
        }
      } else {
        updateProgressWrap.classList.remove("show");
        updateProgressBar.classList.remove("indeterminate");
        updateProgressBar.style.width = "0%";
        updateProgressLabel.textContent = "";
      }
    }

    if (status === "checking") {
      updateTitle.textContent = "Checking for updates...";
      updateMeta.textContent = current ? `Current version: ${current}` : "";
      return;
    }

    if (status === "downloading") {
      updateTitle.textContent = "Downloading update...";
      const lines = [];
      if (latest) lines.push(`Version ${latest}`);
      if (current) lines.push(`Current version: ${current}`);
      updateMeta.textContent = lines.join("\n");
      return;
    }

    if (status === "verifying") {
      updateTitle.textContent = "Verifying update...";
      updateMeta.textContent = latest
        ? `Version ${latest}`
        : current
          ? `Current version: ${current}`
          : "";
      return;
    }

    if (showReady) {
      if (status === "waitingForIdle") {
        updateTitle.textContent = "Finish the current print job before updating.";
      } else {
        updateTitle.textContent = "Update ready";
      }
      const lines = [];
      if (status === "waitingForIdle") {
        lines.push(
          state.userMessage ||
            "Update will be available when printing finishes.",
        );
      } else {
        lines.push(
          state.userMessage ||
            "Update downloaded and verified. Click Update Now to install.",
        );
      }
      if (latest) lines.push(`Version ${latest}`);
      if (state.fileName) lines.push(state.fileName);
      updateMeta.textContent = lines.join("\n");
      return;
    }

    if (showInstalling) {
      updateTitle.textContent = "Installing update...";
      updateMeta.textContent =
        state.userMessage ||
        "PrintMadeEasy Agent will restart automatically.";
      return;
    }

    if (showUnavailable) {
      updateTitle.textContent =
        state.userMessage || "Update verification is not available yet.";
      updateMeta.textContent = current ? `Current version: ${current}` : "";
      return;
    }

    if (showAvailable) {
      updateTitle.textContent = "New version available";
      const lines = [`Version ${latest}`];
      if (current) lines.push(`Current version: ${current}`);
      if (notes) lines.push(notes);
      updateMeta.textContent = lines.join("\n");
      return;
    }

    if (status === "error" && state.userMessage) {
      updateTitle.textContent = state.userMessage;
      updateMeta.textContent = current ? `Current version: ${current}` : "";
      return;
    }

    updateTitle.textContent = "You're up to date";
    updateMeta.textContent = current
      ? `Current version: ${current}`
      : latest
        ? `Latest version: ${latest}`
        : "";
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
    renderUpdateState(state.update);

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
      connectCard.style.display = "block";
    }

    if (loginPanel && signedInPanel) {
      if (paired) {
        loginPanel.style.display = "none";
        signedInPanel.classList.remove("hidden");
      } else {
        loginPanel.style.display = "block";
        signedInPanel.classList.add("hidden");
      }
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
      : "Sign in with your PrintMadeEasy email and password.";

    openAtLogin.checked = Boolean(config.openAtLogin);

    if (connectHint) {
      connectHint.textContent = paired
        ? "Signed in. Use the same account on another computer to connect it too."
        : "Sign in with your PrintMadeEasy email and password. Use the same account on multiple computers.";
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

  async function loginWithAccount() {
    if (connecting) return;
    connecting = true;
    clearConnectMessage();
    setConnectMessage("Signing in…", true);
    if (loginBtn) loginBtn.disabled = true;

    try {
      const email = loginEmail ? loginEmail.value.trim() : "";
      const password = loginPassword ? loginPassword.value : "";
      if (!email || !password) {
        throw new Error("Enter your email and password.");
      }
      const result = await window.printAgent.loginAccount({ email, password });
      if (!result || result.success === false) {
        throw new Error(
          (result && result.error) ||
            "Unable to sign in. Check your internet connection."
        );
      }
      if (loginPassword) loginPassword.value = "";
      setConnectMessage("Signed in successfully.", true);
      showPairSuccess(result);
      await refresh();
    } catch (error) {
      setConnectMessage(
        error instanceof Error ? error.message : "Unable to sign in.",
        false
      );
    } finally {
      connecting = false;
      if (loginBtn) loginBtn.disabled = false;
    }
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      void loginWithAccount();
    });
  }

  if (loginPassword) {
    loginPassword.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void loginWithAccount();
      }
    });
  }

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
          ? "Agent will start when Windows starts."
          : "Agent will not start automatically with Windows."
      );
    } catch (error) {
      openAtLogin.checked = !openAtLogin.checked;
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update Windows startup setting.",
        false
      );
    }
  });

  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener("click", async () => {
      if (updateCheckBusy) return;
      updateCheckBusy = true;
      checkUpdatesBtn.disabled = true;
      try {
        const prior =
          typeof window.printAgent.getUpdateState === "function"
            ? await window.printAgent.getUpdateState()
            : null;
        renderUpdateState({
          ...(prior || {}),
          status: "checking",
          userMessage: "Checking for updates...",
        });
        const state = await window.printAgent.checkForUpdates();
        renderUpdateState(state);
        if (state && state.userMessage) {
          setMessage(state.userMessage, state.status !== "error");
        }
      } catch {
        renderUpdateState({
          status: "error",
          currentVersion: "",
          latestVersion: null,
          notes: null,
          fileName: null,
          updateAvailable: false,
          dismissed: false,
          userMessage: "Unable to check for updates right now.",
          updateNowReady: false,
        });
        setMessage("Unable to check for updates right now.", false);
      } finally {
        updateCheckBusy = false;
        checkUpdatesBtn.disabled = false;
      }
    });
  }

  if (updateLaterBtn) {
    updateLaterBtn.addEventListener("click", async () => {
      try {
        const state = await window.printAgent.dismissUpdate();
        renderUpdateState(state);
      } catch {
        // ignore
      }
    });
  }

  if (updateNowBtn) {
    updateNowBtn.addEventListener("click", async () => {
      updateNowBtn.disabled = true;
      try {
        const result = await window.printAgent.startUpdate();
        if (result && result.accepted) {
          setMessage(result.message || "Update in progress.", true);
        } else if (result && result.code === "WAITING_FOR_IDLE") {
          setMessage(
            result.message ||
              "Finish the current print job before updating.",
            true,
          );
        } else {
          setMessage(
            (result && result.message) ||
              "Unable to download the update right now.",
            false,
          );
        }
        if (typeof window.printAgent.getUpdateState === "function") {
          const state = await window.printAgent.getUpdateState();
          renderUpdateState(state);
        }
      } catch {
        setMessage("Unable to download the update right now.", false);
      }
    });
  }

  if (updateCancelBtn) {
    updateCancelBtn.addEventListener("click", async () => {
      updateCancelBtn.disabled = true;
      try {
        const state = await window.printAgent.cancelUpdate();
        renderUpdateState(state);
        setMessage(
          (state && state.userMessage) || "Update download was cancelled.",
          true,
        );
      } catch {
        setMessage("Update download was cancelled.", true);
      }
    });
  }

  if (window.printAgent && typeof window.printAgent.onRefresh === "function") {
    window.printAgent.onRefresh(() => {
      refresh({ light: true }).catch(() => undefined);
    });
  }

  if (window.printAgent && typeof window.printAgent.onUpdateStatus === "function") {
    window.printAgent.onUpdateStatus((state) => {
      renderUpdateState(state);
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
