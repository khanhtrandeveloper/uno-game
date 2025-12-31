import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const COLOR_OPTIONS = ["red", "yellow", "green", "blue"];

const CARD_LABELS = {
  skip: "Skip",
  reverse: "Reverse",
  draw2: "+2",
  wild: "Wild",
  wild4: "+4"
};

function CardFace({ card }) {
  if (!card) {
    return (
      <div className="card-inner">
        <div className="card-center">?</div>
      </div>
    );
  }

  const cornerText =
    card.type === "number"
      ? String(card.value)
      : card.type === "draw2"
      ? "+2"
      : card.type === "wild4"
      ? "+4"
      : card.type === "wild"
      ? "W"
      : card.type === "skip"
      ? "S"
      : "R";

  return (
    <div className="card-inner">
      <div className="card-corner top">{cornerText}</div>
      <div className="card-corner bottom">{cornerText}</div>
      <div className="card-center">
        {card.type === "number" ? (
          <span className="card-number">{card.value}</span>
        ) : (
          <CardIcon type={card.type} />
        )}
      </div>
    </div>
  );
}

function CardIcon({ type }) {
  if (type === "skip") {
    return (
      <svg viewBox="0 0 64 64" className="card-icon" aria-hidden="true">
        <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="6" />
        <line x1="18" y1="46" x2="46" y2="18" stroke="currentColor" strokeWidth="6" />
      </svg>
    );
  }

  if (type === "reverse") {
    return (
      <svg viewBox="0 0 64 64" className="card-icon" aria-hidden="true">
        <path
          d="M16 24h24l-6-6M48 40H24l6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === "draw2") {
    return (
      <div className="card-draw">
        <span>+2</span>
      </div>
    );
  }

  if (type === "wild4") {
    return (
      <div className="card-draw">
        <span>+4</span>
      </div>
    );
  }

  if (type === "wild") {
    return (
      <div className="wild-icon">
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }

  return <span className="card-icon-text">{CARD_LABELS[type] || "?"}</span>;
}

function App() {
  const socketRef = useRef(null);
  const [status, setStatus] = useState("offline");
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [selfId, setSelfId] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [wildPick, setWildPick] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setStatus("online"));
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("error", (msg) => setError(msg));
    socket.on("game:state", (nextState) => {
      setState(nextState);
      if (!nextState?.started) {
        setWildPick(null);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (state?.currentPlayerId && state.currentPlayerId !== selfId) {
      setSelectedIds([]);
      setSelectedKey(null);
    }
  }, [state?.currentPlayerId, selfId]);

  const phase = state?.started ? "game" : state ? "lobby" : "home";
  const self = state?.players?.find((player) => player.isSelf);
  const isHost = state?.hostId === selfId;
  const isMyTurn = state?.currentPlayerId && state.currentPlayerId === selfId;
  const activeColor = state?.activeColor || state?.topCard?.color;
  const canCallUno = state?.unoPendingPlayerId === selfId && !state?.unoCalled;

  const isStackCard = (card) => card.type === "draw2" || card.type === "wild4";

  const canPlaySingle = (card) => {
    if (!state || !isMyTurn || state.winnerId) return false;
    if (state.pendingDraw > 0) return isStackCard(card);
    if (card.type === "wild" || card.type === "wild4") return true;
    if (!state.topCard) return true;
    if (card.color === activeColor) return true;
    if (card.type === "number" && state.topCard.type === "number") {
      return card.value === state.topCard.value;
    }
    return card.type === state.topCard.type && card.type !== "number";
  };

  const getStackKey = (card) => {
    if (!state || !isMyTurn || state.winnerId) return null;
    if (!canPlaySingle(card)) return null;
    if (state.pendingDraw > 0) return "draw-stack";
    if (card.type === "wild" || card.type === "wild4") return `wild:${card.type}`;
    if (card.type === "number") return `number:${card.value}`;
    return `action:${card.type}`;
  };

  const hand = useMemo(() => self?.hand || [], [self]);

  const handleCreate = () => {
    setError("");
    socketRef.current.emit("room:create", { name }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Cannot create room.");
        return;
      }
      setSelfId(res.playerId);
      setRoomCode(res.roomId);
    });
  };

  const handleQuick = () => {
    setError("");
    socketRef.current.emit("room:quick", { name }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Cannot quick join.");
        return;
      }
      setSelfId(res.playerId);
      setRoomCode(res.roomId);
    });
  };

  const handleJoin = () => {
    setError("");
    socketRef.current.emit("room:join", { roomId: roomCode.trim(), name }, (res) => {
      if (!res?.ok) {
        setError(res?.error || "Cannot join room.");
        return;
      }
      setSelfId(res.playerId);
    });
  };

  const handleLeave = () => {
    socketRef.current.emit("room:leave");
    setState(null);
    setSelfId(null);
    setRoomCode("");
    setSelectedIds([]);
    setSelectedKey(null);
  };

  const handleStart = () => {
    socketRef.current.emit("game:start");
  };

  const handleSelect = (card) => {
    const key = getStackKey(card);
    if (!key) return;
    const alreadySelected = selectedIds.includes(card.id);
    if (alreadySelected) {
      const nextIds = selectedIds.filter((id) => id !== card.id);
      setSelectedIds(nextIds);
      if (nextIds.length === 0) {
        setSelectedKey(null);
      }
      return;
    }
    if (!selectedKey || selectedKey === key) {
      if (key.startsWith("wild:")) {
        setSelectedIds([card.id]);
        setSelectedKey(key);
        return;
      }
      setSelectedIds([...selectedIds, card.id]);
      setSelectedKey(key);
      return;
    }
    setSelectedIds([card.id]);
    setSelectedKey(key);
  };

  const handlePlaySelected = () => {
    if (selectedIds.length === 0) return;
    const selectedCards = hand.filter((card) => selectedIds.includes(card.id));
    const hasWild = selectedCards.some((card) => card.type === "wild" || card.type === "wild4");
    if (hasWild) {
      setWildPick({ cardIds: selectedIds });
      return;
    }
    socketRef.current.emit("game:play", { cardIds: selectedIds }, (res) => {
      if (!res?.ok) setError(res?.error || "Move rejected.");
    });
    setSelectedIds([]);
    setSelectedKey(null);
  };

  const handleWildSelect = (color) => {
    if (!wildPick) return;
    socketRef.current.emit(
      "game:play",
      { cardIds: wildPick.cardIds, chosenColor: color },
      (res) => {
        if (!res?.ok) setError(res?.error || "Move rejected.");
        setWildPick(null);
      }
    );
    setSelectedIds([]);
    setSelectedKey(null);
  };

  const handleDraw = () => {
    if (!isMyTurn || state?.winnerId) return;
    socketRef.current.emit("game:draw", (res) => {
      if (!res?.ok) setError(res?.error || "Draw rejected.");
    });
    setSelectedIds([]);
    setSelectedKey(null);
  };

  const handleUno = () => {
    socketRef.current.emit("game:uno", (res) => {
      if (!res?.ok) setError(res?.error || "UNO rejected.");
    });
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="kicker">UNO MULTIPLAYER</p>
          <h1>Retro UNO Arena</h1>
          <p className="sub">
            Lobby up, throw wilds, and race to zero in a neon-arcade table.
          </p>
        </div>
        <div className="status">
          <span className={`dot ${status}`} />
          {status}
        </div>
      </header>

      {phase === "home" && (
        <section className="panel">
          <div className="panel-header">Create or Join</div>
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your nickname"
              />
            </label>
            <label>
              <span>Room Code</span>
              <input
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                placeholder="ABC123"
              />
            </label>
          </div>
          <div className="button-row">
            <button className="primary" onClick={handleCreate} disabled={!name}>
              Create Room
            </button>
            <button onClick={handleJoin} disabled={!name || roomCode.length < 4}>
              Join Room
            </button>
            <button onClick={handleQuick} disabled={!name}>
              Quick Match
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {phase === "lobby" && state && (
        <section className="panel lobby">
          <div className="panel-header">Room {state.roomId}</div>
          <div className="lobby-body">
            <div className="players">
              {state.players.map((player) => (
                <div key={player.id} className="player-card">
                  <span>{player.name}</span>
                  {player.isSelf && <span className="tag">YOU</span>}
                  {player.id === state.hostId && <span className="tag host">HOST</span>}
                </div>
              ))}
            </div>
            <div className="lobby-actions">
              <button className="primary" onClick={handleStart} disabled={!isHost}>
                Start Game
              </button>
              <button onClick={handleLeave}>Leave</button>
              <p className="hint">Need 2-4 players. Host can start.</p>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {phase === "game" && state && (
        <section className="table">
          <div className="table-top">
            <div className="pile">
              <div className={`card face ${state.topCard?.color || "black"}`}>
                <CardFace card={state.topCard} />
              </div>
              <div className="meta">
                <p>Active</p>
                <div className={`color-chip ${activeColor || "black"}`} />
              </div>
            </div>
            <div className="turn-info">
              <p className="turn-label">Turn</p>
              <h2>{state.players.find((p) => p.id === state.currentPlayerId)?.name}</h2>
              <p className="hint">
                {state.pendingDraw > 0
                  ? `Stack +2/+4 or draw ${state.pendingDraw}`
                  : "Play a card or draw"}
              </p>
            </div>
            <div className="controls">
              <button className="primary" onClick={handleDraw} disabled={!isMyTurn}>
                Draw
              </button>
              <button onClick={handleLeave}>Leave</button>
            </div>
          </div>

          <div className="player-strip">
            {state.players.map((player) => (
              <div
                key={player.id}
                className={`player-pill ${
                  player.id === state.currentPlayerId ? "active" : ""
                }`}
              >
                <span>{player.name}</span>
                <span className="count">{player.handCount}</span>
                {state.unoPendingPlayerId === player.id && (
                  <span className="tag uno">UNO?</span>
                )}
              </div>
            ))}
          </div>

          <div className="action-bar">
            <button className="primary" onClick={handlePlaySelected} disabled={selectedIds.length === 0}>
              Play Selected
            </button>
            <button onClick={() => { setSelectedIds([]); setSelectedKey(null); }} disabled={selectedIds.length === 0}>
              Clear
            </button>
            <button className="uno-btn" onClick={handleUno} disabled={!canCallUno}>
              UNO!
            </button>
          </div>

          <div className="hand">
            {hand.map((card) => (
              <button
                key={card.id}
                className={`card ${card.color} ${
                  selectedIds.includes(card.id) ? "selected" : ""
                } ${canPlaySingle(card) ? "playable" : ""}`}
                onClick={() => handleSelect(card)}
                disabled={!canPlaySingle(card)}
              >
                <CardFace card={card} />
              </button>
            ))}
          </div>

          {state.winnerId && (
            <div className="overlay">
              <div className="panel">
                <div className="panel-header">Game Over</div>
                <p className="winner">
                  {state.players.find((p) => p.id === state.winnerId)?.name} wins!
                </p>
                <button onClick={handleLeave}>Back to Lobby</button>
              </div>
            </div>
          )}
        </section>
      )}

      {wildPick && (
        <div className="overlay">
          <div className="panel">
            <div className="panel-header">Pick a Color</div>
            <div className="color-grid">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  className={`color-btn ${color}`}
                  onClick={() => handleWildSelect(color)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
