const { nanoid } = require("nanoid");

const COLORS = ["red", "yellow", "green", "blue"];

function createDeck() {
  const deck = [];

  for (const color of COLORS) {
    deck.push(makeCard(color, "number", 0));
    for (let n = 1; n <= 9; n += 1) {
      deck.push(makeCard(color, "number", n));
      deck.push(makeCard(color, "number", n));
    }
    for (const type of ["skip", "reverse", "draw2"]) {
      deck.push(makeCard(color, type, type));
      deck.push(makeCard(color, type, type));
    }
  }

  for (let i = 0; i < 4; i += 1) {
    deck.push(makeCard("black", "wild", "wild"));
    deck.push(makeCard("black", "wild4", "wild4"));
  }

  return shuffle(deck);
}

function makeCard(color, type, value) {
  return {
    id: nanoid(10),
    color,
    type,
    value
  };
}

function shuffle(cards) {
  const deck = cards.slice();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function dealHands(deck, playerCount) {
  const hands = Array.from({ length: playerCount }, () => []);
  let drawPile = deck.slice();
  for (let round = 0; round < 7; round += 1) {
    for (let p = 0; p < playerCount; p += 1) {
      const card = drawPile.shift();
      hands[p].push(card);
    }
  }
  return { hands, drawPile };
}

function drawCards(game, count) {
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    if (game.drawPile.length === 0) {
      replenishDrawPile(game);
    }
    if (game.drawPile.length === 0) {
      break;
    }
    drawn.push(game.drawPile.shift());
  }
  return drawn;
}

function replenishDrawPile(game) {
  if (game.discardPile.length <= 1) {
    return;
  }
  const keepTop = game.discardPile.pop();
  const recycled = shuffle(game.discardPile);
  game.discardPile = [keepTop];
  game.drawPile = game.drawPile.concat(recycled);
}

function findPlayableCard(game, card, chosenColor) {
  const top = game.discardPile[game.discardPile.length - 1];
  const activeColor = game.activeColor || top.color;

  if (card.type === "wild" || card.type === "wild4") {
    return Boolean(chosenColor);
  }

  if (card.color === activeColor) {
    return true;
  }

  if (card.type === "number" && top.type === "number") {
    return card.value === top.value;
  }

  return card.type === top.type && card.type !== "number";
}

function applyCardEffects(game, card, chosenColor) {
  if (card.type === "wild" || card.type === "wild4") {
    game.activeColor = chosenColor;
  } else {
    game.activeColor = card.color;
  }

  if (card.type === "reverse") {
    if (game.players.length === 2) {
      game.pendingSkip = true;
    } else {
      game.direction *= -1;
    }
  }

  if (card.type === "skip") {
    game.pendingSkip = true;
  }

  if (card.type === "draw2") {
    game.pendingDraw += 2;
  }

  if (card.type === "wild4") {
    game.pendingDraw += 4;
  }
}

function advanceTurn(game, steps = 1) {
  const count = game.players.length;
  const step = ((game.currentPlayerIndex + steps * game.direction) % count + count) % count;
  game.currentPlayerIndex = step;
}

function createGame(roomId, hostId, players) {
  const deck = createDeck();
  const { hands, drawPile } = dealHands(deck, players.length);
  const discardPile = [];

  let firstCard = drawPile.shift();
  while (firstCard.type !== "number") {
    drawPile.push(firstCard);
    firstCard = drawPile.shift();
  }
  discardPile.push(firstCard);

  return {
    roomId,
    hostId,
    started: true,
    players: players.map((player, index) => ({
      ...player,
      hand: hands[index]
    })),
    drawPile,
    discardPile,
    currentPlayerIndex: 0,
    direction: 1,
    pendingDraw: 0,
    pendingSkip: false,
    activeColor: firstCard.color,
    winnerId: null,
    unoPending: null
  };
}

function getCurrentPlayer(game) {
  return game.players[game.currentPlayerIndex];
}

function canStackOnPending(card) {
  return card.type === "draw2" || card.type === "wild4";
}

function isSameStackGroup(first, next) {
  if (first.type === "number" && next.type === "number") {
    return first.value === next.value;
  }
  if (first.type === "number" || next.type === "number") {
    return false;
  }
  if (first.type === "wild" || first.type === "wild4") {
    return false;
  }
  if (next.type === "wild" || next.type === "wild4") {
    return false;
  }
  return first.type === next.type;
}

function applyUnoPenaltyIfNeeded(game, actingPlayerId) {
  if (!game.unoPending) return;
  if (game.unoPending.called) return;
  if (game.unoPending.playerId === actingPlayerId) return;
  const offender = game.players.find((player) => player.id === game.unoPending.playerId);
  if (!offender) return;
  offender.hand.push(...drawCards(game, 2));
  game.unoPending = null;
}

function playCard(game, playerId, cardIds, chosenColor) {
  const player = getCurrentPlayer(game);
  if (!player || player.id !== playerId) {
    return { ok: false, error: "Not your turn." };
  }

  applyUnoPenaltyIfNeeded(game, playerId);

  const ids = Array.isArray(cardIds) ? cardIds : [cardIds];
  if (ids.length === 0) {
    return { ok: false, error: "No cards selected." };
  }

  const cards = ids
    .map((id) => player.hand.find((card) => card.id === id))
    .filter(Boolean);
  if (cards.length !== ids.length) {
    return { ok: false, error: "Card not found." };
  }

  if (game.pendingDraw > 0) {
    if (!cards.every(canStackOnPending)) {
      return { ok: false, error: "You must draw or stack +2/+4." };
    }
  }

  const first = cards[0];
  if (game.pendingDraw === 0) {
    if (!findPlayableCard(game, first, chosenColor || game.activeColor)) {
      return { ok: false, error: "Invalid move." };
    }
  }
  if (game.pendingDraw === 0) {
    for (let i = 1; i < cards.length; i += 1) {
      if (!isSameStackGroup(first, cards[i])) {
        return { ok: false, error: "Cards must match to stack." };
      }
    }
  }

  const hasWild = cards.some((card) => card.type === "wild" || card.type === "wild4");
  if (hasWild && !chosenColor) {
    return { ok: false, error: "Choose a color for wild." };
  }

  for (const card of cards) {
    const cardIndex = player.hand.findIndex((c) => c.id === card.id);
    if (cardIndex !== -1) {
      player.hand.splice(cardIndex, 1);
      game.discardPile.push(card);
      applyCardEffects(game, card, card.type === "wild" || card.type === "wild4" ? chosenColor : null);
    }
  }

  if (player.hand.length === 1) {
    game.unoPending = { playerId, called: false };
  } else if (player.hand.length === 0) {
    game.winnerId = playerId;
    game.unoPending = null;
  } else if (game.unoPending?.playerId === playerId) {
    game.unoPending = null;
  }

  const steps = game.pendingSkip ? 2 : 1;
  game.pendingSkip = false;
  advanceTurn(game, steps);

  return { ok: true, winner: player.hand.length === 0 ? playerId : null };
}

function drawAction(game, playerId) {
  const player = getCurrentPlayer(game);
  if (!player || player.id !== playerId) {
    return { ok: false, error: "Not your turn." };
  }

  applyUnoPenaltyIfNeeded(game, playerId);

  const drawCount = game.pendingDraw > 0 ? game.pendingDraw : 1;
  const drawn = drawCards(game, drawCount);
  player.hand.push(...drawn);
  game.pendingDraw = 0;

  if (game.unoPending?.playerId === playerId) {
    game.unoPending = null;
  }

  advanceTurn(game, 1);

  return { ok: true };
}

function callUno(game, playerId) {
  if (!game.unoPending || game.unoPending.playerId !== playerId) {
    return { ok: false, error: "UNO not available." };
  }
  game.unoPending.called = true;
  return { ok: true };
}

function makePublicState(game, viewerId) {
  const topCard = game.discardPile[game.discardPile.length - 1];
  return {
    roomId: game.roomId,
    hostId: game.hostId,
    started: game.started,
    currentPlayerId: getCurrentPlayer(game)?.id,
    direction: game.direction,
    pendingDraw: game.pendingDraw,
    activeColor: game.activeColor,
    winnerId: game.winnerId,
    unoPendingPlayerId: game.unoPending?.playerId || null,
    unoCalled: game.unoPending?.called || false,
    topCard,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      isSelf: player.id === viewerId,
      hand: player.id === viewerId ? player.hand : null,
      handCount: player.hand.length
    }))
  };
}

module.exports = {
  createGame,
  makePublicState,
  playCard,
  drawAction,
  getCurrentPlayer,
  callUno
};
