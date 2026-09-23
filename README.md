# TraceMate Backend App

## Run

1. Open terminal in this folder.
2. Install dependencies:

```bash
npm install
```

3. Create environment file from template:

```bash
copy .env.example .env
```

4. Ensure MongoDB is running locally.

5. Run:

```bash
npm start
```

6. Open:

http://localhost:3000

## Demo Accounts

- Admin: `admin@campus.edu` / `admin123`

## Notes

- Data now persists in MongoDB.
- If `data/db.json` exists and MongoDB is empty, legacy data is auto-imported on first run.
- `.env` is ignored by git; keep secrets only in `.env`, not in code.
- Do not open `index.html` directly with `file://`; use the backend URL.
