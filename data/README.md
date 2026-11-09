# Runtime data

The live TraceMate database is stored outside this extracted project folder so user reports and history survive restarts and ZIP upgrades. The default Windows path is `%APPDATA%\TraceMate\data\db.json`; set `TRACEMATE_DATA_DIR` to override it. The ZIP intentionally does not include `db.json` because it may contain user reports and session tokens.

When upgrading in place, the server imports an existing project-local `data/db.json` into persistent storage on first startup if no persistent database exists. To migrate from a different extracted folder, use `npm run migrate:data -- "C:\path\to\old-TraceMate\data\db.json"` while the backend is stopped, then restart it. Back up the persistent database before manual changes.
