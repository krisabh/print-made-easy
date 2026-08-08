# PrintMadeEasy Windows Print Agent

Local Windows bridge between  PrintMadeEasy and your printer.

## V1 features

- System tray background agent
- Detect installed Windows printers
- Select and remember default printer
- Test print
- Start with Windows (optional)
- Temporary job folder cleanup on startup

Cloud job printing is **not** included in V1.

## Setup

```bash
cd print-agent
npm install
copy .env.example .env
```

Edit `.env` if needed:

```
API_URL=http://192.168.1.10:3000
SHOP_CODE=PME001
AGENT_ID=agent-local-001
```

## Run in development

```bash
npm run dev
```

## Build Windows installer / EXE

```bash
npm run dist
```

Output:

- `release/PrintMadeEasy-Agent-Setup-1.0.0.exe`

Unpacked app (no installer):

```bash
npm run pack
```

## Local data

- Config: `C:\ProgramData\PrintMadeEasy\agent-config.json`
- Temp jobs: `C:\ProgramData\PrintMadeEasy\jobs\`

Temp files older than 1 hour are deleted on startup.

## Test checklist

1. Start Agent with `npm run dev`
2. Window opens and tray icon appears
3. Printers are listed
4. Select a printer
5. Click **Test Print**
6. Close window → agent stays in tray
7. Open from tray → window returns
8. Exit from tray menu → agent stops
