# LexiClear / Legal Risk Analyzer

Chrome Extension + Flask backend for analyzing legal risk in website content.

## Project Structure

```
Lexiclear - Extension/
├── manifest.json      # Chrome Extension Manifest V3
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic & API calls
├── content.js         # Content script (extracts page text)
└── backend/
    ├── app.py         # Flask API (analyze, check_fake, compare_apps)
    ├── risk_keywords.py  # Keyword-based risk detection
    ├── requirements.txt
    ├── .env.example   # Copy to .env, add GEMINI_API_KEY
    └── dataset/       # Optional: for risk_detection module
        └── tos_clauses.txt
```

## Features

1. **Analyze Current Page** – Extract text, segment clauses, classify with Gemini
2. **Fake Website Detection** – Domain age, SSL, suspicious keywords, legal pages
3. **App-to-App Comparison** – Compare risk scores across two URLs

## Setup

1. **Backend**
   ```
   cd backend
   pip install -r requirements.txt
   Copy .env.example to .env and add GEMINI_API_KEY
   python app.py
   ```

2. **Extension**
   - Chrome → chrome://extensions → Developer mode → Load unpacked
   - Select this folder

## Run

- Start Flask: `python backend/app.py`
- Use extension on any webpage
