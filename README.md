# Retro UNO Arena

Multiplayer UNO built with React + Vite on the frontend and Express + Socket.io on the backend.

## Run locally

```bash
npm install
npm run dev
```

This starts:
- Client at `http://localhost:5173`
- Server at `http://localhost:4000`

If you need a custom server URL, set `VITE_SERVER_URL` in `client/.env`.

## Rules implemented
- Stack +2 / +4 when a draw is pending.
- Play multiple cards in one turn if they match (same number or same action type).
- UNO button required when you reach 1 card; miss it and you draw 2 on the next action.
