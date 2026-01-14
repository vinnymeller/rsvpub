# RSVPub 📖

**Warning:** This project was developed for personal use 100% via Claude Code. Didn't write one line. Make of that what you will.

Self-hosted speed reading web app for reading EPUB files using the RSVP (Rapid Serial Visual Presentation) technique.

Built for fun because I couldn't find an existing OSS RSVP reader that did quite what I wanted.



https://github.com/user-attachments/assets/d4621ec0-d46b-4e6a-9075-5082898adee3



## Features

### Reading
- **RSVP display** — Words shown one at a time with ORP (Optimal Recognition Point) highlighting
- **Adjustable speed** — 100-1000 WPM with real-time adjustment
- **Smart timing** — Punctuation delays that scale with your WPM (pauses longer at periods, shorter at commas)
- **Length delays** — Optional extra time for longer words
- **Frequency delays** — Optional extra time for uncommon words (uses a 10k word frequency list)
- **Paragraph view** — Toggle to see full paragraphs with clickable words

### Navigation
- Full keyboard control (see shortcuts below)
- Chapter dropdown for quick navigation
- Mobile touch controls

### Library
- Upload and manage EPUB files
- Search books by title or author
- Automatic progress saving — resume exactly where you left off
- Duplicate detection

### Settings
- Adjustable font size
- Timing delay toggles and intensity sliders
- All preferences saved to localStorage

## Quick Start

### With npm

```bash
git clone https://github.com/vinnymeller/rsvpub
cd rsvpub
npm install
npm run dev
```

Open http://localhost:7787

### With Nix

To just try it out:

```bash
nix run github:vinnymeller/rsvpub
```

If you've cloned the repo:

```bash
# Development shell
nix develop

# Build the package
nix build

# Build and run
nix run
```

## Configuration

The server looks for configuration in this order:

1. `--config <path>` CLI argument
2. `~/.config/rsvpub/config.json`
3. `./config.json` (current directory)

### Config file format

```json
{
  "server": {
    "port": 7787,
    "host": "0.0.0.0"
  },
  "storage": {
    "dataDir": "~/.local/share/rsvpub"
  }
}
```

All fields are optional — defaults are shown above.

### CLI overrides

```bash
npm run dev -- --port 3000 --host 127.0.0.1
```

### Data storage

Books and the database are stored in `dataDir`:
```
~/.local/share/rsvpub/
├── books/           # Uploaded EPUBs (stored by content hash)
└── rsvpub.db   # SQLite database
```

## NixOS Module

Add the flake to your inputs:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rsvpub = {
      url = "github:vinnymeller/rsvpub";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
}
```

Import and configure the module:

```nix
{ inputs, pkgs, ... }:
{
  imports = [ inputs.rsvpub.nixosModules.default ];

  services.rsvpub = {
    enable = true;
    package = inputs.rsvpub.packages.${pkgs.system}.default;
    port = 7787;
    host = "127.0.0.1";  # Use "0.0.0.0" to expose to network
    openFirewall = false;
  };
}
```

### Module options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable` | bool | `false` | Enable the service |
| `package` | package | — | Package from flake (required) |
| `port` | port | `7787` | Server port |
| `host` | string | `"127.0.0.1"` | Bind address |
| `dataDir` | string | `"/var/lib/rsvpub"` | Data directory |
| `openFirewall` | bool | `false` | Open firewall for the port |

The service runs as a systemd unit with security hardening (DynamicUser, ProtectSystem, etc.). Data in `dataDir` persists across reboots.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` `→` | Previous / Next word |
| `R` | Restart current paragraph |
| `[` `]` | Decrease / Increase speed (±25 WPM) |
| `PageUp` `PageDown` | Previous / Next chapter |
| `V` | Toggle RSVP / Paragraph view |
| `Escape` | Return to library |

In paragraph view, click any word to jump to it.

## Tech Stack

- **Frontend:** TypeScript, Vite
- **Backend:** Express 5, sql.js (SQLite in-process)
- **EPUB parsing:** epubjs
- **Nix packaging:** importNpmLock from nixpkgs

## License

MIT
