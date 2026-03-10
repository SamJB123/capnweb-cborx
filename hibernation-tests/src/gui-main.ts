import "./gui-style.css";
import PartySocket from "partysocket";
import { RpcStub, RpcTarget, __experimental_debugRpcReference, newWebSocketRpcSession } from "../../src/index.ts";

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
  hiddenProbe: AnyStub | null;
  directRoomWs: PartySocket | null;
  directRoomRoot: AnyStub | null;
  directHeldRoom: AnyStub | null;
  clientCallback: AnyStub | null;
  clientCallbackName: string;
  clientCallbackCount: number | null;
  clientNotificationCount: number | null;
  lastClientNotification: string | null;
  key: string;
  roomName: string;
  roomUser: string;
  roomMessage: string;
  hiddenProbeLabel: string;
  hiddenProbeSecret: string;
  counterValue: number | null;
  roomMessageCount: number | null;
  directRoomMessageCount: number | null;
  lastAction: string | null;
  lastResult: unknown;
  lastError: string | null;
  lastStatus: Status;
  socketState: string;
  sentCount: number;
  receivedCount: number;
  lastSocketEvent: string | null;
  directSocketState: string;
  directSentCount: number;
  directReceivedCount: number;
  directLastSocketEvent: string | null;
  hubInstance: HubInstanceInfo;
  roomInstance: RoomInstanceInfo;
  directRoomInstance: RoomInstanceInfo;
};

const state: ScenarioState = {
  ws: null,
  root: null,
  heldCounter: null,
  heldRoom: null,
  hiddenProbe: null,
  directRoomWs: null,
  directRoomRoot: null,
  directHeldRoom: null,
  clientCallback: null,
  clientCallbackName: `client-callback-${Date.now()}`,
  clientCallbackCount: null,
  clientNotificationCount: null,
  lastClientNotification: null,
  key: `gui-${Date.now()}`,
  roomName: "general",
  roomUser: "sam",
  roomMessage: "hello room",
  hiddenProbeLabel: "visible-label",
  hiddenProbeSecret: "super-secret-value",
  counterValue: null,
  roomMessageCount: null,
  directRoomMessageCount: null,
  lastAction: null,
  lastResult: null,
  lastError: null,
  lastStatus: "idle",
  socketState: "CLOSED",
  sentCount: 0,
  receivedCount: 0,
  lastSocketEvent: null,
  directSocketState: "CLOSED",
  directSentCount: 0,
  directReceivedCount: 0,
  directLastSocketEvent: null,
  hubInstance: { before: null, current: null, hibernated: null },
  roomInstance: { before: null, current: null, hibernated: null },
  directRoomInstance: { before: null, current: null, hibernated: null },
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

    <section class="controls controls--global">
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
        <label class="field">
          <span>Callback name</span>
          <input id="callback-name" value="${state.clientCallbackName}" />
        </label>
        <label class="field">
          <span>Room message</span>
          <input id="room-message" value="${state.roomMessage}" />
        </label>
        <label class="field">
          <span>Hidden probe label</span>
          <input id="hidden-probe-label" value="${state.hiddenProbeLabel}" />
        </label>
        <label class="field">
          <span>Hidden probe secret</span>
          <input id="hidden-probe-secret" value="${state.hiddenProbeSecret}" />
        </label>
      </div>
    </section>

    <section class="scenario-grid">
      <article class="controls scenario">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Hub websocket</p>
          <h2>Counter through hub</h2>
          <p>Browser connects to the hub over one websocket and keeps a counter stub across hibernation.</p>
        </div>
        <div class="buttons">
        <button id="connect">Connect root</button>
        <button id="get-counter">Get held counter stub</button>
        <button id="increment-now">Increment held counter now</button>
        <button id="wait-hibernate">Wait ~15s for hibernation</button>
        <button id="increment-after">Increment same counter after wake</button>
        </div>
      </article>

      <article class="controls scenario">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Hub capability passing</p>
          <h2>Room capability through hub</h2>
          <p>Browser gets a room capability from the hub and keeps using the same held room stub after the hub sleeps.</p>
        </div>
        <div class="buttons">
        <button id="get-room">Get held room stub</button>
        <button id="post-room-now">Post room message now</button>
        <button id="post-room-after">Post same room stub after wake</button>
        <button id="run-room-scenario">Run full room scenario</button>
        </div>
      </article>

      <article class="controls scenario">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Bidirectional RPC</p>
          <h2>Client callback stored in hub</h2>
          <p>Browser mints a callback RpcTarget, passes it to the hub, and checks whether the hub can still hibernate while holding it.</p>
        </div>
        <div class="buttons">
        <button id="register-client-callback">Register client callback</button>
        <button id="invoke-client-callback">Invoke stored client callback</button>
        </div>
      </article>

      <article class="controls scenario">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Reflection probe</p>
          <h2>Hidden constructor arg</h2>
          <p>Hub creates a RpcTarget with a real private constructor arg so we can compare the live hook dump with what the class actually uses.</p>
        </div>
        <div class="buttons">
        <button id="get-hidden-probe">Get hidden probe</button>
        <button id="call-hidden-probe">Call hidden probe</button>
        </div>
      </article>

      <article class="controls scenario">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Direct room websocket</p>
          <h2>Direct connection to room</h2>
          <p>Browser connects straight to the room over capnweb and keeps the room capability working after the room sleeps.</p>
        </div>
        <div class="buttons">
        <button id="connect-direct-room">Connect direct room</button>
        <button id="get-direct-room">Get direct room capability</button>
        <button id="post-direct-room-now">Post direct room now</button>
        <button id="wait-direct-room-hibernate">Wait ~15s for direct room hibernation</button>
        <button id="post-direct-room-after">Post same direct room after wake</button>
        <button id="run-direct-room-scenario">Run full direct room scenario</button>
        </div>
      </article>

      <article class="controls scenario scenario--utility">
        <div class="scenario__header">
          <p class="scenario__eyebrow">Utility</p>
          <h2>Diagnostics and reset</h2>
          <p>Refresh the server-side view or clear the current browser-held state.</p>
        </div>
        <div class="buttons">
        <button id="refresh-diag">Refresh diagnostics</button>
        <button id="disconnect" class="secondary">Disconnect</button>
        </div>
      </article>
    </section>

    <section class="status-grid status-grid--twelve">
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
      <article class="status-card status-card--value">
        <span class="status-label">Direct room count</span>
        <strong id="direct-room-count" class="status-value">-</strong>
      </article>
      <article class="status-card status-card--value">
        <span class="status-label">Stored callbacks</span>
        <strong id="callback-count" class="status-value">-</strong>
      </article>
      <article id="direct-room-instance-card" class="status-card status-card--instance">
        <span class="status-label">Direct room instance</span>
        <strong id="direct-room-instance-status" class="status-value status-value--small">Unknown</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Client callback</span>
        <strong id="client-callback-status" class="status-value status-value--small">Not registered</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Direct room socket</span>
        <strong id="direct-socket-status" class="status-value status-value--small">CLOSED</strong>
      </article>
      <article class="status-card">
        <span class="status-label">Direct room wire</span>
        <strong id="direct-wire-status" class="status-value status-value--small">sent 0 / received 0</strong>
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
const callbackNameInput = document.querySelector<HTMLInputElement>("#callback-name")!;
const roomMessageInput = document.querySelector<HTMLInputElement>("#room-message")!;
const hiddenProbeLabelInput = document.querySelector<HTMLInputElement>("#hidden-probe-label")!;
const hiddenProbeSecretInput = document.querySelector<HTMLInputElement>("#hidden-probe-secret")!;
const clientStateEl = document.querySelector<HTMLElement>("#client-state")!;
const serverStateEl = document.querySelector<HTMLElement>("#server-state")!;
const logEl = document.querySelector<HTMLElement>("#log")!;
const counterValueEl = document.querySelector<HTMLElement>("#counter-value")!;
const roomCountEl = document.querySelector<HTMLElement>("#room-count")!;
const directRoomCountEl = document.querySelector<HTMLElement>("#direct-room-count")!;
const callbackCountEl = document.querySelector<HTMLElement>("#callback-count")!;
const lastActionEl = document.querySelector<HTMLElement>("#last-action")!;
const lastOutcomeEl = document.querySelector<HTMLElement>("#last-outcome")!;
const hubInstanceCardEl = document.querySelector<HTMLElement>("#hub-instance-card")!;
const roomInstanceCardEl = document.querySelector<HTMLElement>("#room-instance-card")!;
const directRoomInstanceCardEl = document.querySelector<HTMLElement>("#direct-room-instance-card")!;
const hubInstanceStatusEl = document.querySelector<HTMLElement>("#hub-instance-status")!;
const roomInstanceStatusEl = document.querySelector<HTMLElement>("#room-instance-status")!;
const directRoomInstanceStatusEl = document.querySelector<HTMLElement>("#direct-room-instance-status")!;
const socketStatusEl = document.querySelector<HTMLElement>("#socket-status")!;
const wireStatusEl = document.querySelector<HTMLElement>("#wire-status")!;
const directSocketStatusEl = document.querySelector<HTMLElement>("#direct-socket-status")!;
const directWireStatusEl = document.querySelector<HTMLElement>("#direct-wire-status")!;
const clientCallbackStatusEl = document.querySelector<HTMLElement>("#client-callback-status")!;

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
document.querySelector<HTMLButtonElement>("#register-client-callback")!.addEventListener("click", () => {
  void runUiAction("Register client callback", registerClientCallback);
});
document.querySelector<HTMLButtonElement>("#invoke-client-callback")!.addEventListener("click", () => {
  void runUiAction("Invoke stored client callback", invokeStoredClientCallback);
});
document.querySelector<HTMLButtonElement>("#get-hidden-probe")!.addEventListener("click", () => {
  void runUiAction("Get hidden probe", getHiddenProbe);
});
document.querySelector<HTMLButtonElement>("#call-hidden-probe")!.addEventListener("click", () => {
  void runUiAction("Call hidden probe", callHiddenProbe);
});
document.querySelector<HTMLButtonElement>("#connect-direct-room")!.addEventListener("click", () => {
  void runUiAction("Connect direct room", connectDirectRoom);
});
document.querySelector<HTMLButtonElement>("#get-direct-room")!.addEventListener("click", () => {
  void runUiAction("Get direct room capability", getDirectHeldRoom);
});
document.querySelector<HTMLButtonElement>("#post-direct-room-now")!.addEventListener("click", () => {
  void runUiAction("Post direct room now", () => postDirectRoomMessage("post-direct-room-now"));
});
document.querySelector<HTMLButtonElement>("#wait-direct-room-hibernate")!.addEventListener("click", () => {
  void runUiAction("Wait for direct room hibernation", waitForDirectRoomHibernation);
});
document.querySelector<HTMLButtonElement>("#post-direct-room-after")!.addEventListener("click", () => {
  void runUiAction("Post same direct room after wake", () => postDirectRoomMessage("post-direct-room-after-wake"));
});
document.querySelector<HTMLButtonElement>("#run-direct-room-scenario")!.addEventListener("click", () => {
  void runUiAction("Run full direct room scenario", runDirectRoomScenario);
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
  state.clientCallbackName = callbackNameInput.value.trim() || state.clientCallbackName;
  state.roomMessage = roomMessageInput.value.trim() || state.roomMessage;
  state.hiddenProbeLabel = hiddenProbeLabelInput.value.trim() || state.hiddenProbeLabel;
  state.hiddenProbeSecret = hiddenProbeSecretInput.value.trim() || state.hiddenProbeSecret;
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
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      card.classList.add("status-card--celebrate");
    });
  });
}

function renderClientState(extra: Record<string, unknown> = {}) {
  clientStateEl.textContent = JSON.stringify({
    connected: !!state.ws,
    root: state.root ? __experimental_debugRpcReference(state.root) : null,
    heldCounter: state.heldCounter ? __experimental_debugRpcReference(state.heldCounter) : null,
    heldRoom: state.heldRoom ? __experimental_debugRpcReference(state.heldRoom) : null,
    hiddenProbe: state.hiddenProbe ? __experimental_debugRpcReference(state.hiddenProbe) : null,
    directRoomRoot: state.directRoomRoot ? __experimental_debugRpcReference(state.directRoomRoot) : null,
    directHeldRoom: state.directHeldRoom ? __experimental_debugRpcReference(state.directHeldRoom) : null,
    clientCallback: state.clientCallback ? __experimental_debugRpcReference(state.clientCallback) : null,
    clientCallbackName: state.clientCallbackName,
    clientCallbackCount: state.clientCallbackCount,
    clientNotificationCount: state.clientNotificationCount,
    lastClientNotification: state.lastClientNotification,
    key: state.key,
    roomName: state.roomName,
    roomUser: state.roomUser,
    roomMessage: state.roomMessage,
    hiddenProbeLabel: state.hiddenProbeLabel,
    hiddenProbeSecret: state.hiddenProbeSecret,
    ...extra,
  }, null, 2);

  counterValueEl.textContent = state.counterValue === null ? "-" : String(state.counterValue);
  roomCountEl.textContent = state.roomMessageCount === null ? "-" : String(state.roomMessageCount);
  directRoomCountEl.textContent = state.directRoomMessageCount === null ? "-" : String(state.directRoomMessageCount);
  callbackCountEl.textContent = state.clientCallbackCount === null ? "-" : String(state.clientCallbackCount);
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
  directRoomInstanceCardEl.classList.toggle("status-card--hibernated", state.directRoomInstance.hibernated === true);
  hubInstanceStatusEl.textContent = formatInstanceStatus(state.hubInstance);
  roomInstanceStatusEl.textContent = formatInstanceStatus(state.roomInstance);
  directRoomInstanceStatusEl.textContent = formatInstanceStatus(state.directRoomInstance);
  socketStatusEl.textContent = `${state.socketState}${state.lastSocketEvent ? ` / ${state.lastSocketEvent}` : ""}`;
  wireStatusEl.textContent = `sent ${state.sentCount} / received ${state.receivedCount}`;
  directSocketStatusEl.textContent = `${state.directSocketState}${state.directLastSocketEvent ? ` / ${state.directLastSocketEvent}` : ""}`;
  directWireStatusEl.textContent = `sent ${state.directSentCount} / received ${state.directReceivedCount}`;
  clientCallbackStatusEl.textContent = state.clientCallback
    ? `stored as ${state.clientCallbackName}${state.lastClientNotification ? ` / last: ${state.lastClientNotification}` : ""}`
    : "Not registered";
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
  state.directRoomInstance.current = roomInstance?.instanceId ?? null;
  state.roomMessageCount = roomDiagnostics?.messageCount ?? state.roomMessageCount;
  state.directRoomMessageCount = roomDiagnostics?.messageCount ?? state.directRoomMessageCount;
  state.clientCallbackCount = hubDiagnostics?.counters?.clientCallbackCount ?? state.clientCallbackCount;

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

async function connectDirectRoom() {
  if (state.directRoomWs) {
    state.directRoomWs.close();
  }
  syncInputsToState();

  const ws = new PartySocket({
    host: location.host,
    basePath: `chat-room-ws?room=${encodeURIComponent(state.roomName)}`,
    protocol: location.protocol === "https:" ? "wss" : "ws",
  });
  instrumentSocket(ws, "direct");
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Direct room WebSocket failed to open")), { once: true });
  });

  state.directRoomWs = ws;
  state.directRoomRoot = newWebSocketRpcSession<any>(ws as any);
  state.lastAction = "Connected direct room";
  state.lastResult = "connected";
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Connected direct room root stub", __experimental_debugRpcReference(state.directRoomRoot));
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

async function registerClientCallback() {
  ensureRoot();
  syncInputsToState();

  class GuiClientCallback extends RpcTarget {
    notifications: string[] = [];

    notify(message: string) {
      this.notifications.push(message);
      state.clientNotificationCount = this.notifications.length;
      state.lastClientNotification = message;
      renderClientState();
      log("Client callback received notification", { message, count: this.notifications.length });
      return { ok: true, count: this.notifications.length };
    }
  }

  const callbackTarget = new GuiClientCallback();
  state.clientCallback = new RpcStub(callbackTarget);
  state.clientNotificationCount = 0;
  state.lastClientNotification = null;
  const stored = await state.root!.storeClientCallback(
      state.clientCallbackName,
      state.clientCallback);
  state.clientCallbackCount = Number(stored);
  state.lastAction = "Registered client callback";
  state.lastResult = { storedCallbacks: state.clientCallbackCount, callbackName: state.clientCallbackName };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Registered client callback", {
    callbackName: state.clientCallbackName,
    clientCallback: __experimental_debugRpcReference(state.clientCallback),
    storedCallbacks: state.clientCallbackCount,
  });
  await refreshDiagnostics();
}

async function invokeStoredClientCallback() {
  ensureRoot();
  syncInputsToState();
  state.lastAction = "Invoke stored client callback";
  state.lastError = null;
  state.lastResult = null;
  state.lastStatus = "pending";
  renderClientState();
  const message = `notify-${Date.now()}`;
  const result = await state.root!.invokeStoredClientCallback(state.clientCallbackName, message);
  state.lastResult = result;
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Invoked stored client callback", { callbackName: state.clientCallbackName, message, result });
  await refreshDiagnostics();
}

async function getHiddenProbe() {
  ensureRoot();
  syncInputsToState();
  state.hiddenProbe = await state.root!.getHiddenArgProbe(
      state.hiddenProbeLabel,
      state.hiddenProbeSecret);
  state.lastAction = "Acquired hidden probe";
  state.lastResult = {
    label: await state.hiddenProbe.getVisibleLabel(),
    secretLength: await state.hiddenProbe.getSecretLength(),
  };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Acquired hidden probe", __experimental_debugRpcReference(state.hiddenProbe));
  await refreshDiagnostics();
}

async function callHiddenProbe() {
  ensureRoot();
  if (!state.hiddenProbe) {
    throw new Error("Acquire the hidden probe first.");
  }
  state.lastAction = "Call hidden probe";
  state.lastError = null;
  state.lastResult = null;
  state.lastStatus = "pending";
  renderClientState();
  const result = {
    label: await state.hiddenProbe.getVisibleLabel(),
    secret: await state.hiddenProbe.getSecretEcho(),
    secretLength: await state.hiddenProbe.getSecretLength(),
    storageKind: await state.hiddenProbe.getStorageKind(),
  };
  state.lastResult = result;
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Called hidden probe", result);
  await refreshDiagnostics();
}

async function getDirectHeldRoom() {
  ensureDirectRoomRoot();
  syncInputsToState();
  state.directHeldRoom = await state.directRoomRoot!.getRoomCapability();
  state.directRoomMessageCount = await state.directHeldRoom.getMessageCount();
  state.lastAction = "Acquired direct room capability";
  state.lastResult = { directRoomMessageCount: state.directRoomMessageCount };
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log("Acquired direct room capability", __experimental_debugRpcReference(state.directHeldRoom));
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

async function postDirectRoomMessage(label: string) {
  ensureDirectHeldRoom();
  syncInputsToState();
  state.lastAction = label;
  state.lastError = null;
  state.lastResult = null;
  state.lastStatus = "pending";
  renderClientState();
  log(`Posting via direct room capability: ${label}`, {
    directHeldRoom: __experimental_debugRpcReference(state.directHeldRoom),
    roomName: state.roomName,
    roomUser: state.roomUser,
    roomMessage: state.roomMessage,
  });
  const result = await state.directHeldRoom!.postMessage(state.roomUser, state.roomMessage);
  state.directRoomMessageCount = Number(result.count);
  state.lastResult = result;
  state.lastError = null;
  state.lastStatus = "success";
  renderClientState();
  log(`Direct room result: ${label}`, result);
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
  if (state.hubInstance.hibernated) {
    triggerHibernateCelebration(hubInstanceCardEl);
  }
  if (state.roomInstance.hibernated) {
    triggerHibernateCelebration(roomInstanceCardEl);
  }
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

async function waitForDirectRoomHibernation() {
  syncInputsToState();
  const roomBefore = await fetchJson(`/chat-room-instance?room=${encodeURIComponent(state.roomName)}`);
  state.directRoomInstance.before = roomBefore.instanceId ?? null;
  state.directRoomInstance.hibernated = null;
  state.lastAction = "Waiting for direct room hibernation";
  state.lastResult = { before: state.directRoomInstance.before };
  state.lastError = null;
  state.lastStatus = "pending";
  renderClientState();
  log("Waiting ~15s for direct room hibernation", roomBefore);
  await new Promise(resolve => setTimeout(resolve, 15_000));
  const roomAfter = await fetchJson(`/chat-room-instance?room=${encodeURIComponent(state.roomName)}`);
  state.directRoomInstance.current = roomAfter.instanceId ?? null;
  state.directRoomInstance.hibernated =
    state.directRoomInstance.before !== null &&
    state.directRoomInstance.before !== state.directRoomInstance.current;
  state.lastResult = {
    before: state.directRoomInstance.before,
    after: state.directRoomInstance.current,
    hibernated: state.directRoomInstance.hibernated,
  };
  state.lastStatus = "success";
  renderClientState();
  if (state.directRoomInstance.hibernated) {
    triggerHibernateCelebration(directRoomInstanceCardEl);
  }
  log("Checked direct room instance IDs before/after wait", state.lastResult);
  await refreshDiagnostics();
}

async function runDirectRoomScenario() {
  await connectDirectRoom();
  await getDirectHeldRoom();
  await postDirectRoomMessage("post-direct-room-before-hibernation");
  await waitForDirectRoomHibernation();
  await postDirectRoomMessage("same-direct-room-after-hibernation");
}

function disconnect() {
  if (state.ws) {
    state.ws.close();
  }
  if (state.directRoomWs) {
    state.directRoomWs.close();
  }
  state.ws = null;
  state.root = null;
  state.heldCounter = null;
  state.heldRoom = null;
  state.hiddenProbe = null;
  state.directRoomWs = null;
  state.directRoomRoot = null;
  state.directHeldRoom = null;
  state.clientCallback = null;
  state.clientCallbackCount = null;
  state.clientNotificationCount = null;
  state.lastClientNotification = null;
  state.counterValue = null;
  state.roomMessageCount = null;
  state.directRoomMessageCount = null;
  state.lastAction = "Disconnected";
  state.lastResult = null;
  state.lastError = null;
  state.lastStatus = "idle";
  state.socketState = "CLOSED";
  state.sentCount = 0;
  state.receivedCount = 0;
  state.lastSocketEvent = null;
  state.directSocketState = "CLOSED";
  state.directSentCount = 0;
  state.directReceivedCount = 0;
  state.directLastSocketEvent = null;
  state.hubInstance = { before: null, current: null, hibernated: null };
  state.roomInstance = { before: null, current: null, hibernated: null };
  state.directRoomInstance = { before: null, current: null, hibernated: null };
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

function ensureDirectRoomRoot() {
  if (!state.directRoomRoot) {
    throw new Error("Connect the direct room first.");
  }
}

function ensureDirectHeldRoom() {
  if (!state.directHeldRoom) {
    throw new Error("Acquire the direct room capability first.");
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

function instrumentSocket(ws: PartySocket, channel: "hub" | "direct" = "hub") {
  const setSocketSnapshot = (patch: {
    sentIncrement?: boolean;
    receivedIncrement?: boolean;
    state?: string;
    event?: string | null;
  }) => {
    if (channel === "hub") {
      if (patch.sentIncrement) state.sentCount += 1;
      if (patch.receivedIncrement) state.receivedCount += 1;
      if (patch.state) state.socketState = patch.state;
      if (patch.event !== undefined) state.lastSocketEvent = patch.event;
    } else {
      if (patch.sentIncrement) state.directSentCount += 1;
      if (patch.receivedIncrement) state.directReceivedCount += 1;
      if (patch.state) state.directSocketState = patch.state;
      if (patch.event !== undefined) state.directLastSocketEvent = patch.event;
    }
  };
  const originalSend = ws.send.bind(ws);
  ws.send = ((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    setSocketSnapshot({
      sentIncrement: true,
      state: readyStateLabel(ws.readyState),
      event: "send",
    });
    log(channel === "hub" ? "Socket send" : "Direct room socket send", {
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
    setSocketSnapshot({ state: "OPEN", event: "open" });
    renderClientState();
    log(channel === "hub" ? "Socket open" : "Direct room socket open");
  });
  ws.addEventListener("close", (event) => {
    setSocketSnapshot({ state: "CLOSED", event: `close ${event.code}` });
    renderClientState();
    log(channel === "hub" ? "Socket close" : "Direct room socket close",
        { code: event.code, reason: event.reason, wasClean: event.wasClean });
  });
  ws.addEventListener("error", () => {
    setSocketSnapshot({ state: readyStateLabel(ws.readyState), event: "error" });
    renderClientState();
    log(channel === "hub" ? "Socket error" : "Direct room socket error", { readyState: ws.readyState });
  });
  ws.addEventListener("message", (event) => {
    setSocketSnapshot({
      receivedIncrement: true,
      state: readyStateLabel(ws.readyState),
      event: "message",
    });
    renderClientState();
    log(channel === "hub" ? "Socket message" : "Direct room socket message", {
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
