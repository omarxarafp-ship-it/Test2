# AppOmar WhatsApp Bot

A professional WhatsApp bot for downloading APK files and media from various platforms.

## Overview

This is a multi-purpose WhatsApp bot that:
- Downloads APK/XAPK files from Google Play Store
- Downloads media from YouTube, Instagram, Facebook, TikTok, Twitter, Pinterest
- Downloads files from Google Drive and Mediafire
- Uses AI (Gemini) for chat functionality

## Architecture

### Components

1. **API Server** (`api_server.py`) - Port 8000
   - FastAPI backend for APK downloads
   - Uses `apkeep` binary and `aria2c` for fast downloads
   - Fallback system: APKPure + aria2 → apkeep
   - Automatic file caching and cleanup

2. **WhatsApp Bot** (`bot.js`)
   - Main application using @whiskeysockets/baileys library
   - Plugin system for different platforms
   - Database integration for user tracking
   - Spam protection and rate limiting

3. **Plugins** (`plugins/`)
   - facebook.js - Facebook video downloads
   - gdrive.js - Google Drive file downloads
   - instagram.js - Instagram media downloads
   - mediafire.js - Mediafire file downloads
   - pinterest.js - Pinterest media downloads
   - tiktok.js - TikTok video downloads
   - twitter.js - Twitter/X media downloads
   - youtube.js - YouTube video downloads

### Database (Optional)
- PostgreSQL via DATABASE_URL environment variable
- Tables: users, blacklist, downloads
- Schema in `database/schema.sql`

## Setup

### Environment Variables
- `API_URL` - Backend API URL (default: http://localhost:8000)
- `DATABASE_URL` - PostgreSQL connection string (optional)
- `GEMINI_API_KEY` - For AI chat features (currently in config.js)

### Running the Bot
1. Both workflows start automatically:
   - **API Server** - Runs on port 8000
   - **WhatsApp Bot** - Connects to WhatsApp

2. On first run, scan the QR code in the console to connect WhatsApp

3. Session is saved in `session/` folder

## Configuration

Edit `config.js` to customize:
- Developer phone numbers
- Bot profile image
- Rate limits and spam protection
- Message templates (in Arabic/Darija)

## Usage

Send messages to the bot:
- App name (e.g., "WhatsApp", "Minecraft") to search and download APKs
- Platform URLs (YouTube, Instagram, etc.) for media downloads
- "zarchiver" to get XAPK installer
- "/help" or "/commands" for help
- "تحويل *6 الى *3" - Shows VPN/tunnel apps for free internet (HTTP Custom, MD Tunnel, HA Tunnel Plus, HTTP Injector)

## File Structure

```
.
├── api_server.py      # FastAPI backend
├── bot.js             # Main WhatsApp bot
├── config.js          # Configuration
├── gemini-brain.js    # AI chat integration
├── gemini-scraper.js  # Web scraping for AI
├── init_database.js   # Database initialization
├── apkeep             # APK download binary
├── database/
│   └── schema.sql     # PostgreSQL schema
├── plugins/           # Platform downloaders
│   ├── facebook.js
│   ├── gdrive.js
│   ├── instagram.js
│   ├── mediafire.js
│   ├── pinterest.js
│   ├── tiktok.js
│   ├── twitter.js
│   └── youtube.js
└── session/           # WhatsApp session data
    └── creds.json
```

## Dependencies

### Python
- fastapi, uvicorn - Web framework
- aiohttp - Async HTTP
- aria2p - Download acceleration

### Node.js
- @whiskeysockets/baileys - WhatsApp Web API
- @google/generative-ai - Gemini AI
- google-play-scraper - Play Store search
- sharp - Image processing
- pg - PostgreSQL client

### System
- aria2 - Multi-connection downloader
- apkeep - APK download tool
