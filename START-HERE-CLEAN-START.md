# TraceMate clean-start package

This package contains the TraceMate source code and AI service files. It does not include a live database or existing lost/found history.

## Start the application

1. Install Node.js 20 or newer.
2. In this folder run `npm install`.
3. Run `npm start` and keep that terminal open.
4. For AI matching, open a second terminal and follow `ai-service/README.md` or `start-ai-service.ps1` to create/activate the Python environment and install `ai-service/requirements.txt`.
5. Open `http://localhost:5000`.

## Start with a fresh lost-and-found history, keeping accounts

The persistent database lives outside this source folder:
- Windows: `%APPDATA%\TraceMate\data\db.json`

After extracting the package, run this once from the project root:

```powershell
npm run reset:data
```

This command clears lost items, found items, claims/matches, and active sessions. It preserves all existing user and admin account records, including password hashes and salts. Users will need to sign in again, but their existing passwords remain unchanged. A timestamped backup is made in the persistent data folder before the reset.

If this is the first installation and no database exists yet, TraceMate creates the configured admin account at startup. Default development credentials, unless overridden in `.env`, are:
- Email: `admin@campus.edu`
- Password: `Admin@123`

Change the default admin password before using the app beyond local testing. Do not commit `.env` or real credentials to a shared ZIP.

## Data and privacy

The ZIP intentionally does not contain `db.json`, `.env`, virtual environments, `node_modules`, or training datasets. The LostNet model required for classification is included under `ai-service/data/lostnet/`.
