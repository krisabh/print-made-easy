(function () {
  const agentStatusEl = document.getElementById("agentStatus");
  const agentDotEl = document.getElementById("agentDot");
  const connectionMetaEl = document.getElementById("connectionMeta");
  const printerSelectEl = document.getElementById("printerSelect");
  const printerEmptyEl = document.getElementById("printerEmpty");
  const printerStatusEl = document.getElementById("printerStatus");
  const printerDotEl = document.getElementById("printerDot");
  const testPrintBtn = document.getElementById("testPrintBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const dashboardBtn = document.getElementById("dashboardBtn");
  const openAtLoginEl = document.getElementById("openAtLogin");
  const messageEl = document.getElementById("message");

  function api() {
    if (!window.printAgent) {
      throw new Error("Print Agent bridge is not available. Restart the Agent.");
    }
    return window.printAgent;
  }

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = "message show " + type;
  }

  function clearMessage() {
    messageEl.className = "message";
    messageEl.textContent = "";
  }

  function setDot(el, tone) {
    el.className = "dot " + tone;
  }

  async function refreshState() {
    clearMessage();
    refreshBtn.disabled = false;
    dashboardBtn.disabled = false;
    printerEmptyEl.style.display = "block";
    printerEmptyEl.textContent = "Loading printers…";

    try {
      const state = await api().getState();

      agentStatusEl.textContent = state.agentRunning ? "Agent Running" : "Stopped";
      setDot(agentDotEl, state.agentRunning ? "ok" : "bad");
      connectionMetaEl.textContent =
        state.connection.status + " · " + state.connection.message;

      printerSelectEl.innerHTML = "";

      if (!state.printers || state.printers.length === 0) {
        printerEmptyEl.style.display = "block";
        printerEmptyEl.textContent =
          "No printers detected. Connect your printer, install the Windows driver, then click Refresh.";
        printerSelectEl.disabled = true;
        testPrintBtn.disabled = true;
        printerStatusEl.textContent = "No printer detected";
        setDot(printerDotEl, "bad");
      } else {
        printerEmptyEl.style.display = "none";
        printerSelectEl.disabled = false;
        testPrintBtn.disabled = false;

        for (const printer of state.printers) {
          const option = document.createElement("option");
          option.value = printer.name;
          option.textContent = printer.name;
          if (printer.name === state.config.selectedPrinter) {
            option.selected = true;
          }
          printerSelectEl.appendChild(option);
        }

        printerStatusEl.textContent = state.selectedPrinterStatus;
        setDot(
          printerDotEl,
          state.selectedPrinterStatus === "Online"
            ? "ok"
            : state.selectedPrinterStatus === "Offline"
              ? "bad"
              : "warn",
        );
      }

      openAtLoginEl.checked = Boolean(state.config.openAtLogin);
    } catch (error) {
      console.error(error);
      printerEmptyEl.style.display = "block";
      printerEmptyEl.textContent =
        "Could not load printers. Click Refresh, or restart the Agent.";
      testPrintBtn.disabled = true;
      showMessage(
        error && error.message
          ? error.message
          : "Failed to load printer list. Click Refresh.",
        "err",
      );
    }
  }

  printerSelectEl.addEventListener("change", async function () {
    try {
      await api().setPrinter(printerSelectEl.value);
      await refreshState();
      showMessage("Default printer saved.", "ok");
    } catch (error) {
      showMessage("Could not save the selected printer.", "err");
    }
  });

  testPrintBtn.addEventListener("click", async function () {
    testPrintBtn.disabled = true;
    testPrintBtn.textContent = "Printing…";
    clearMessage();

    try {
      const result = await api().testPrint();
      if (result.success) {
        showMessage(result.message || "Test print successful", "ok");
      } else {
        showMessage(result.error || "Test print failed", "err");
      }
    } catch (error) {
      showMessage("Test print failed", "err");
    } finally {
      testPrintBtn.disabled = false;
      testPrintBtn.textContent = "Test Print";
    }
  });

  refreshBtn.addEventListener("click", function () {
    void refreshState();
  });

  dashboardBtn.addEventListener("click", function () {
    void api()
      .openDashboard()
      .catch(function () {
        showMessage("Could not open dashboard. Is the web app running?", "err");
      });
  });

  openAtLoginEl.addEventListener("change", async function () {
    try {
      await api().setOpenAtLogin(openAtLoginEl.checked);
      showMessage(
        openAtLoginEl.checked
          ? "Agent will start automatically when Windows starts."
          : "Startup with Windows disabled.",
        "ok",
      );
    } catch (error) {
      showMessage("Could not update Windows startup setting.", "err");
    }
  });

  try {
    api().onRefresh(function () {
      void refreshState();
    });
  } catch (error) {
    console.error(error);
  }

  void refreshState();
})();
