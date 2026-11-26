# GameOnix Desktop

GameOnix packaged as a Windows desktop app with integrated torrent downloads.

## Run locally

```powershell
npm install
npm run dev
```

`npm start` is an alias for the local Electron + Vite development app.

## Build the portable Windows app

```powershell
npm install
npm run dist
```

The unpacked app is written to `release/win-unpacked/`. Run `GameOnix.exe` from that folder. No installer is required. The app opens maximized, uses its own title bar and taskbar icon, and offers Settings for close-to-tray, Windows startup, download confirmations, and the download folder. Closing to the tray keeps torrent transfers running. Verified torrent pieces are written directly to the selected download folder, and in-progress piece blocks are checkpointed beside it. On restart, the app loads its cached torrent metadata, verifies existing file pieces, restores saved partial blocks, and resumes; missing or damaged pieces are downloaded again. Network failures are retried automatically.

## GitHub releases and environment

Pushing to `main` runs `.github/workflows/publish-portable.yml`. GitHub Actions builds the contents of `release/win-unpacked/` and publishes them as `GameOnix-win-unpacked.zip` on a GitHub Release. The app checks that public release feed automatically, verifies the archive's SHA-256 digest, downloads it while open, replaces its portable files after closing, and restarts.

The workflow uses GitHub's built-in `GITHUB_TOKEN`; do not put a GitHub token in `.env`, the app bundle, or a `VITE_` variable. In the repository's **Settings → Actions → General**, allow workflows to create releases (read/write repository contents). Any `VITE_` variable is included in client code and must be treated as public. In the app, users can see the current version and update progress under **Settings → Updates**; downloads happen inside the app, then it swaps the portable files and restarts without opening a browser or running an installer.

The displayed download speed and remaining time use a short rolling average. Torrent speeds still depend on the user's connection and available peers.
