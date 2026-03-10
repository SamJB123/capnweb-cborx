import "./gui-style.css";
import PartySocket from "partysocket";
import { __experimental_debugRpcReference, newWebSocketRpcSession } from "../../src/index.ts";

type AnyStub = any;
type Status = "idle" | "pending" | "success" | "error";

type HubInstanceInfo = {
  before: string | null;
  current: string | null;
  hibernated: boolean | null;
};

type RoomInstanceInfo = {
  before: string | null;
  current: string | null;
  hibernated: boolean | null;
};

type ScenarioState = {
  ws: PartySocket | null;
  root: AnyStub | null;
  heldCounter: AnyStub | null;
  heldRoom: AnyStub | null;
  key: string;
  roomName: string;
  roomUser: string;
  roomMessage: string;
  counterValue: number | null;
  roomMessageCount: number | null;
  lastAction: string | null;
  lastResult: unknown;
  lastError: string | null;
  lastStatus: Status;
  socketState: string;
  sentCount: number;
  receivedCount: number;
  lastSocketEvent: string | null;
  hubInstance: HubInstanceInfo;
  roomInstance: RoomInstanceInfo;
};

const state: ScenarioState = {
  ws: null,
  root: null,
  heldCounter: null,
  heldRoom: null,
  key: `gui-${Date.now()}`,
  roomName: "general",
  roomUser: "sam",
  roomMessage: "hello room",
  counterValue: null,
  roomMessageCount: null,
  lastAction: null,
  lastResult: null,
  lastError: null,
  lastStatus: "idle",
  socketState: "CLOSED",
  sentCount: 0,
  receivedCount: 0,
  lastSocketEvent: null,
  hubInstance: { before: null, current: null, hibernated: null },
  roomInstance: { before: null, current: null, hibernated: null },
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">capnweb Durable Object hibernation</p>
      <h1>Hub and room continuity GUI</h1>
      <p class="lede">One browser websocket to the user hub, plus a chat-room capability passed over capnweb. Use this to check held-stub continuity and whether both Durable Objects re-initialize after idle.</p>
    </section>

    <section class="controls">
      <div class="field-grid">
        <label class="field">
          <span>Counter key</span>
          <input id="counter-key" value="${state.key}" />
        </label>
        <label class="field">
          <span>Room name</span>
          <input id="room-name" value="${state.roomName}" />
        </label>
        <label class="field">
          <span>Room user</span>
          <input id="room-user" value="${state.roomUser}" />
        </label>
        <label class="field field--wide">
          <span>Room message</span>
          <input id="room-message" value="${state.roomMessage}" />
        </label>
      </div>

      <div class="buttons">
        <button id="connect">Connect root</button>
        <button id="get-counter">Get held counter stub</button>
        <button id="increment-now">Increment held counter now</button>
        <button id="get-room">Get held room stub</button>
        <button id="post-room-now">Post room message now</button>
        <button id="wait-hibernate">Wait ~15s for hibernation</button>
        <button id="increment-after">Increment same counter after wake</button>
        <button id="post-room-after">Post same room stub after wake</button>
        <button id="run-room-scenario">Run full room scenario</button>
        <button id="refresh-diag">Refresh diagnostics</button>
        <button id="disconnect" class="secondary">Disconnect</button>
      </div>
    </section>

    <section class="status-grid status-grid--eight">
      <article class="status-card status-card--value">
        <span class="status-label">Counter value</span>
        <strong id="counter-value" class="status-value">-</strong>
      </article>
      <article class="status-card status-card--value">
        <span class="status-label">Room message count</span>
        <strong id="room-count" class="status-value">-</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Last action</span>
        <strong id="last-action" class="status-value status-value--small">Nothing yet</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Outcome</span>
        <strong id="last-outcome" class="status-pill status-pill--idle">Idle</strong>
      </article>
      <article id="hub-instance-card" class="status-card status-card--instance">
        <span class="status-label">Hub instance</span>
        <strong id="hub-instance-status" class="status-value status-value--small">Unknown</strong>
      </article>
      <article id="room-instance-card" class="status-card status-card--instance">
        <span class="status-label">Room instance</span>
        <strong id="room-instance-status" class="status-value status-value--small">Unknown</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Socket</span>
        <strong id="socket-status" class="status-value status-value--small">CLOSED</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Wire activity</span>
        <strong id="wire-status" class="status-value status-value--small">sent 0 / received 0</strong>
      </article>
    </section>

    <section class="grid">
      <article class="panel">
        <h2>Client</h2>
        <pre id="client-state">Not connected.</pre>
      </article>
      <article class="panel">
        <h2>Server diagnostics</h2>
        <pre id="server-state">No diagnostics yet.</pre>
      </article>
    </section>

    <section class="panel">
      <h2>Event log</h2>
      <pre id="log"></pre>
    </section>
  </main>
`;

const keyInput = document.querySelector<HTMLInputElement>("#counter-key")!;
const roomNameInput = document.querySelector<HTMLInputElement>("#room-name")!;
const roomUserInput = document.querySelector<HTMLInputElement>("#room-user")!;
const roomMessageInput = document.querySelector<HTMLInputElement>("#room-message")!;
const clientStateEl = document.querySelector<HTMLElement>("#client-state")!;
const serverStateEl = document.querySelector<HTMLElement>("#server-state")!;
const logEl = document.querySelector<HTMLElement>("#log")!;
const counterValueEl = document.querySelector<HTMLElement>("#counter-value")!;
const roomCountEl = document.querySelector<HTMLElement>("#room-count")!;
const lastActionEl = document.querySelector<HTMLElement>("#last-action")!;
const lastOutcomeEl = document.querySelector<HTMLElement>("#last-outcome")!;
const hubInstanceCardEl = document.querySelector<HTMLElement>("#hub-instance-card")!;
const roomInstanceCardEl = document.querySelector<HTMLElement>("#room-instance-card")!;
const hubInstanceStatusEl = document.querySelector<HTMLElement>("#hub-instance-status")!;
const roomInstanceStatusEl = document.querySelector<HTMLElement>("#room-instance-status")!;
const socketStatusEl = document.querySelector<HTMLElement>("#socket-status")!;
const wireStatusEl = document.querySelector<HTMLElement>("#wire-status")!;

document.querySelector<HTMLButtonElement>("#connect")!.addEventListener("click", () => {
  void runUiAction("Connect root", connectRoot);
});
document.querySelector<HTMLButtonElement>("#get-counter")!.addEventListener("click", () => {
  void runUiAction("Get held counter stub", getHeldCounter);
});
document.querySelector<HTMLButtonElement>("#increment-now")!.addEventListener("click", () => {
  void runUiAction("Increment held counter now", () => incrementHeldCounter("increment-now", 1));
});
document.querySelector<HTMLButtonElement>("#get-room")!.addEventListener("click", () => {
  void runUiAction("Get held room stub", getHeldRoom);
});
document.querySelector<HTMLButtonElement>("#post-room-now")!.addEventListener("click", () => {
  void runUiAction("Post room message now", () => postRoomMessage("post-room-now"));
});
document.querySelector<HTMLButtonElement>("#wait-hibernate")!.addEventListener("click", () => {
  void runUiAction("Wait for hibernation", waitForHibernation);
});
document.querySelector<HTMLButtonElement>("#increment-after")!.addEventListener("click", () => {
  void runUiAction("Increment same counter after wake", () => incrementHeldCounter("increment-after-wake", 1));
});
document.querySelector<HTMLButtonElement>("#post-room-after")!.addEventListener("click", () => {
  void runUiAction("Post same room stub after wake", () => postRoomMessage("post-room-after-wake"));
});
document.querySelector<HTMLButtonElement>("#run-room-scenario")!.addEventListener("click", () => {
  void runUiAction("Run full room scenario", runRoomScenario);
});
document.querySelector<HTMLButtonElement>("#refresh-diag")!.addEventListener("click", () => {
  void runUiAction("Refresh diagnostics", refreshDiagnostics);
});
document.querySelector<HTMLButtonElement>("#disconnect")!.addEventListener("click", () => {
  disconnect();
});

renderClientState();
void refreshDiagnostics();

function syncInputsToState() {
  state.key = keyInput.value.trim() || state.key;
  state.roomName = roomNameInput.value.trim() || state.roomName;
  state.roomUser = roomUserInput.value.trim() || state.roomUser;
  state.roomMessage = roomMessageInput.value.trim() || state.roomMessage;
}

function log(message: string, value?: unknown) {
  const prefix = `[${new Date().toLocaleTimeString()}] `;
  const block = value === undefined
      ? `${prefix}${message}`
      : `${prefix}${message}\n${JSON.stringify(value, null, 2)}`;
  logEl.textContent = `${block}\n\n${logEl.textContent ?? ""}`;
}

function formatInstanceStatus(info: HubInstanceInfo | RoomInstanceInfo) {
  if (!info.current) return "Unknown";
  if (info.hibernated === null) return info.current;
  return `${info.current}${info.hibernated ? " (hibernated)" : " (same instance)"}`;
}

function triggerHibernateCelebration(card: HTMLElement) {
  card.classList.remove("status-card--celebrate");
  void card.offsetWidth;
  card.classList.add("status-card--celebrate");
}

function renderClientState(extra: Record<string, unknown> = {}) {
  clientStateEl.textContent = JSON.stringify({
    connected: !!state.ws,
    root: state.root ? __experimental_debugRpcReference(state.root) : null,
    heldCounter: state.heldCounter ? __experimental_debugRpcReference(state.heldCounter) : null,
    heldRoom: state.heldRoom ? __experimental_debugRpcReference(state.heldRoom) : null,
    key: state.key,
    roomName: state.roomName,
    roomUser: state.roomUser,
    roomMessage: state.roomMessage,
    ...extra,
  }, null, 2);

  counterValueEl.textContent = state.counterValue === null ? "-" : String(state.counterValue);
  roomCountEl.textContent = state.roomMessageCount === null ? "-" : String(state.roomMessageCount);
  lastActionEl.textContent = state.lastAction ?? "Nothing yet";
  lastOutcomeEl.textContent = state.lastStatus === "error"
      ? `Failed: ${state.lastError}`
      : state.lastStatus === "success"
        ? `Success: ${typeof state.lastResult === "string" ? state.lastResult : JSON.stringify(state.lastResult)}`
        : state.lastStatus === "pending"
          ? "Pending"
          : "Idle";
  lastOutcomeEl.className = `status-pill ${
      state.lastStatus === "error" ? "status-pill--error" :
      state.lastStatus === "success" ? "status-pill--success" :
      state.lastStatus === "pending" ? "status-pill--pending" :
      "status-pill--idle"}`;
  hubInstanceCardEl.classList.toggle("status-card--hibernated", state.hubInstance.hibernated === true);
  roomInstanceCardEl.classList.toggle("status-card--hibernated", state.roomInstance.hibernated === true);
  hubInstanceStatusEl.textContent = formatInstanceStatus(state.hubInstance);
  roomInstanceStatusEl.textContent = formatInstanceStatus(state.roomInstance);
  socketStatusEl.textContent = `${state.socketState}${state.lastSocketEvent ? ` / ${state.lastSocketEvent}` : ""}`;
  wireStatusEl.textContent = `sent ${state.sentCount} / received ${state.receivedCount}`;
}

async function refreshDiagnostics() {
  syncInputsToState();
  const hubPromises = [
    fetchJson("/instance-id"),
    fetchJson("/resume-diagnostics"),
  ] as const;
  const roomPromises = state.roomName
      ? [
          fetchJson(`/chat-room-instance?room=${encodeURIComponent(state.roomName)}`),
          fetchJson(`/chat-room-diagnostics?room=${encodeURIComponent(state.roomName)}`),
        ] as const
      : null;

  const [hubInstance, hubDiagnostics, roomInstance, roomDiagnostics] = await Promise.all([
    hubPromises[0],
    hubPromises[1],
    roomPromises ? roomPromises[0] : Promise.resolve(null),
    roomPromises ? roomPromises[1] : Promise.resolve(null),
  ]);

  state.hubInstance.current = hubInstance?.instanceId ?? null;
  state.roomInstance.current = roomInstance?.instanceId ?? null;
  state.roomMessageCount = roomDiagnostics?.messageCount ?? state.roomMessageCount;

  serverStateEl.textContent = JSON.stringify({
    hub: {
      instance: hubInstance,
      diagnostics: hubDiagnostics,
    },
    room: {
      instance: roomInstance,
      diagnostics: roomDiagnostics,
    },
  }, null, 2);
  renderClientState();
}

async function connectRoot() {
  disconnect();
  syncInputsToState();

  const ws = new PartySocket({
    host: location.host,
    basePath: "ws",
    protocol: location.protocol === "https:" ? "wss" : "ws",
  });
  instrumentSocket(ws);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
  });

  state.ws = ws;
  state.root = newWebSocketRpcSession<any>(ws as any);
  state.lastAction = "Connected root";
  state.lastResult = "connected";
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Connected root stub", __experimental_debugRpcReference(state.root));
  await refreshDiagnostics();
}

async function getHeldCounter() {
  ensureRoot();
  syncInputsToState();
  state.heldCounter = await state.root!.getDurableCounter(state.key);
  state.counterValue = await state.heldCounter.getValue();
  state.lastAction = "Acquired held counter stub";
  state.lastResult = { counterValue: state.counterValue };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Acquired held counter stub", __experimental_debugRpcReference(state.heldCounter));
  await refreshDiagnostics();
}

async function incrementHeldCounter(label: string, amount: number) {
  ensureHeldCounter();
  state.lastAction = label;
  state.lastError = null;
  state.lastResult = null;
  state.lastStatus = "pending";
  renderClientState();
  log(`Calling held counter stub: ${label}`, {
    clientHeldCounter: __experimental_debugRpcReference(state.heldCounter),
    socketReadyState: state.ws?.readyState ?? null,
  });
  const result = await state.heldCounter!.increment(amount);
  state.counterValue = Number(result);
  state.lastResult = { result, counterValue: state.counterValue };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log(`Held counter result: ${label}`, { result, counterValue: state.counterValue });
  await refreshDiagnostics();
}

async function getHeldRoom() {
  ensureRoot();
  syncInputsToState();
  state.heldRoom = await state.root!.getChatRoom(state.roomName);
  state.roomMessageCount = await state.heldRoom.getMessageCount();
  state.lastAction = "Acquired held room stub";
  state.lastResult = { roomMessageCount: state.roomMessageCount };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Acquired held room stub", __experimental_debugRpcReference(state.heldRoom));
  await refreshDiagnostics();
}

async function postRoomMessage(label: string) {
  ensureHeldRoom();
  syncInputsToState();
  state.lastAction = label;
  state.lastError = null;
  state.lastResult = null;
  state.lastStatus = "pending";
  renderClientState();
  log(`Posting via held room stub: ${label}`, {
    clientHeldRoom: __experimental_debugRpcReference(state.heldRoom),
    roomName: state.roomName,
    roomUser: state.roomUser,
    roomMessage: state.roomMessage,
  });
  const result = await state.heldRoom!.postMessage(state.roomUser, state.roomMessage);
  state.roomMessageCount = Number(result.count);
  state.lastResult = result;
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log(`Held room result: ${label}`, result);
  await refreshDiagnostics();
}

async function waitForHibernation() {
  syncInputsToState();
  const [hubBefore, roomBefore] = await Promise.all([
    fetchJson("/instance-id"),
    fetchJson(`/chat-room-instance?room=${encodeURIComponent(state.roomName)}`),
  ]);
  state.hubInstance.before = hubBefore.instanceId ?? null;
  state.roomInstance.before = roomBefore.instanceId ?? null;
  state.hubInstance.hibernated = null;
  state.roomInstance.hibernated = null;
  state.lastAction = "Waiting for hibernation";
  state.lastResult = {
    hubBeforeInstanceId: state.hubInstance.before,
    roomBeforeInstanceId: state.roomInstance.before,
  };
  state.lastError = null;
  state.lastStatus = "pending";
  renderClientState();
  log("Waiting ~15s for hub and room hibernation", {
    hubBefore,
    roomBefore,
  });
  await new Promise(resolve => setTimeout(resolve, 15_000));
  const [hubAfter, roomAfter] = await Promise.all([
    fetchJson("/instance-id"),
    fetchJson(`/chat-room-instance?room=${encodeURIComponent(state.roomName)}`),
  ]);
  state.hubInstance.current = hubAfter.instanceId ?? null;
  state.roomInstance.current = roomAfter.instanceId ?? null;
  state.hubInstance.hibernated = state.hubInstance.before !== null && state.hubInstance.before !== state.hubInstance.current;
  state.roomInstance.hibernated = state.roomInstance.before !== null && state.roomInstance.before !== state.roomInstance.current;
  if (state.hubInstance.hibernated) {
    triggerHibernateCelebration(hubInstanceCardEl);
  }
  if (state.roomInstance.hibernated) {
    triggerHibernateCelebration(roomInstanceCardEl);
  }
  state.lastResult = {
    hub: {
      before: state.hubInstance.before,
      after: state.hubInstance.current,
      hibernated: state.hubInstance.hibernated,
    },
    room: {
      before: state.roomInstance.before,
      after: state.roomInstance.current,
      hibernated: state.roomInstance.hibernated,
    },
  };
  state.lastStatus = "success";
  renderClientState();
  log("Checked hub and room instance IDs before/after wait", state.lastResult);
  await refreshDiagnostics();
}

async function runRoomScenario() {
  await connectRoot();
  await getHeldRoom();
  await postRoomMessage("post-room-before-hibernation");
  await waitForHibernation();
  await postRoomMessage("same-held-room-after-hibernation");
}

function disconnect() {
  if (state.ws) {
    state.ws.close();
  }
  state.ws = null;
  state.root = null;
  state.heldCounter = null;
  state.heldRoom = null;
  state.counterValue = null;
  state.roomMessageCount = null;
  state.lastAction = "Disconnected";
  state.lastResult = null;
  state.lastError = null;
  state.lastStatus = "idle";
  state.socketState = "CLOSED";
  state.sentCount = 0;
  state.receivedCount = 0;
  state.lastSocketEvent = null;
  state.hubInstance = { before: null, current: null, hibernated: null };
  state.roomInstance = { before: null, current: null, hibernated: null };
  renderClientState();
}

function ensureRoot() {
  if (!state.root) {
    throw new Error("Connect the root stub first.");
  }
}

function ensureHeldCounter() {
  if (!state.heldCounter) {
    throw new Error("Acquire the held counter stub first.");
  }
}

function ensureHeldRoom() {
  if (!state.heldRoom) {
    throw new Error("Acquire the held room stub first.");
  }
}

async function fetchJson(path: string) {
  const response = await fetch(path);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request to ${path} failed with ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Request to ${path} did not return JSON. Response was: ${text}`);
  }
}

async function runUiAction(label: string, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    state.lastAction = label;
    state.lastError = error instanceof Error ? error.message : `${error}`;
    state.lastResult = null;
    state.lastStatus = "error";
    renderClientState();
    log(`${label} failed`, { error: state.lastError });
  }
}

function instrumentSocket(ws: PartySocket) {
  const originalSend = ws.send.bind(ws);
  ws.send = ((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    state.sentCount += 1;
    state.socketState = readyStateLabel(ws.readyState);
    state.lastSocketEvent = "send";
    log("Socket send", {
      readyState: ws.readyState,
      kind: typeof data === "string" ? "string" : data instanceof Blob ? "blob" : "binary",
      length: typeof data === "string"
          ? data.length
          : data instanceof Blob
            ? data.size
            : "byteLength" in data
              ? (data as ArrayBufferLike).byteLength
              : null,
    });
    renderClientState();
    return originalSend(data as any);
  }) as typeof ws.send;

  ws.addEventListener("open", () => {
    state.socketState = "OPEN";
    state.lastSocketEvent = "open";
    renderClientState();
    log("Socket open");
  });
  ws.addEventListener("close", (event) => {
    state.socketState = "CLOSED";
    state.lastSocketEvent = `close ${event.code}`;
    renderClientState();
    log("Socket close", { code: event.code, reason: event.reason, wasClean: event.wasClean });
  });
  ws.addEventListener("error", () => {
    state.socketState = readyStateLabel(ws.readyState);
    state.lastSocketEvent = "error";
    renderClientState();
    log("Socket error", { readyState: ws.readyState });
  });
  ws.addEventListener("message", (event) => {
    state.receivedCount += 1;
    state.socketState = readyStateLabel(ws.readyState);
    state.lastSocketEvent = "message";
    renderClientState();
    log("Socket message", {
      kind: typeof event.data,
      preview: typeof event.data === "string" ? event.data.slice(0, 160) : null,
    });
  });
}

function readyStateLabel(readyState: number) {
  switch (readyState) {
    case 0: return "CONNECTING";
    case 1: return "OPEN";
    case 2: return "CLOSING";
    case 3: return "CLOSED";
    default: return `UNKNOWN(${readyState})`;
  }
}
