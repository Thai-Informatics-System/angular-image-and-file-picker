import { TestBed, discardPeriodicTasks, fakeAsync, flush, flushMicrotasks, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MobileSocketService } from './mobile-socket.service';

/** Minimal browser WebSocket stand-in: events go to whatever handler is set when they fire. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  /** Records the message; answers heartbeat pings and health checks like the backend does */
  send(data: string): void {
    const message = JSON.parse(data);
    this.sent.push(message);
    const route = message?.data?.route;
    if (route === 'ping') {
      setTimeout(() => this.receive({ status: 200, channel: 'ping', body: {} }));
    }
    if (route === 'tis-image-mobile-uploader/check-devices-online') {
      const online = { data: { desktop: { isOnline: true }, mobile: { isOnline: true } } };
      setTimeout(() => this.receive({ status: 200, channel: route, body: online }));
    }
  }

  /** Client close: the close event arrives later, like in a browser */
  close(code = 1000, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    setTimeout(() => this.onclose?.({ code, reason }));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Connection attempt failed: browsers fire error, then close */
  fail(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.({});
    this.onclose?.({ code: 1006, reason: '' });
  }

  /** Server/network dropped an open socket */
  drop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: '' });
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const SESSION_KEY = 'angular-mobile-session';
const DEVICE_ID_KEY = 'angular-mobile-device-id';
const DESKTOP_ID = 'desktop-1';
const PHONE_ID = 'phone-1';
const CHANNEL = `tis-mobile-upload-w-dev-${DESKTOP_ID}`;
const ESTABLISH_ROUTE = 'tis-image-mobile-uploader/establish-mobile-upload-link';

/** Unsigned JWT with the given iat/exp (seconds) */
function jwt(iat: number, exp: number): string {
  const payload = btoa(JSON.stringify({ iat, exp })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `e30.${payload}.sig`;
}

function storeSession(extra: object = {}): void {
  const now = Math.floor(Date.now() / 1000);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token: 'link-token',
    deviceId: DESKTOP_ID,
    userId: '7',
    apiUrl: 'https://api.test/api',
    socketUrl: 'wss://socket.test',
    accessToken: jwt(now, now + 3600),
    refreshToken: 'refresh-token',
    mobileDeviceId: PHONE_ID,
    storedAt: Date.now(),
    ...extra
  }));
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

/** Open the socket of a pending attempt and complete the link handshake */
function completeLink(socket: FakeWebSocket): void {
  socket.open();
  flushMicrotasks();
  socket.receive({ status: 200, channel: ESTABLISH_ROUTE, body: { success: true } });
  flushMicrotasks();
  socket.receive({ channel: CHANNEL, payload: { type: 'mobile-link-established', mobileDeviceId: PHONE_ID } });
  flushMicrotasks();
}

/** Pair with the stored session and return the live socket (inside fakeAsync) */
function pairFromStoredSession(service: MobileSocketService): FakeWebSocket {
  let paired = false;
  service.retryFromStoredSession().then(() => paired = true);
  flushMicrotasks();
  const socket = lastSocket();
  completeLink(socket);
  expect(paired).toBeTrue();
  return socket;
}

/** Stop timers the service left running so fakeAsync can finish */
function stop(service: MobileSocketService): void {
  service.endSession();
  discardPeriodicTasks();
  flush();
}

describe('MobileSocketService', () => {
  let realWebSocket: unknown;

  beforeEach(() => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('tis-mobile-session');
    localStorage.removeItem(DEVICE_ID_KEY);
    realWebSocket = (window as any).WebSocket;
    (window as any).WebSocket = FakeWebSocket;
    FakeWebSocket.instances = [];

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
  });

  afterEach(() => {
    (window as any).WebSocket = realWebSocket;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(DEVICE_ID_KEY);
  });

  describe('mobile device id', () => {
    it('keeps an id already stored', async () => {
      localStorage.setItem(DEVICE_ID_KEY, 'kept-id');
      const service = TestBed.inject(MobileSocketService);
      expect(await service.getMobileDeviceId()).toBe('kept-id');
    });

    it('keeps the id of a session stored by an older app version', async () => {
      storeSession();
      const service = TestBed.inject(MobileSocketService);
      expect(await service.getMobileDeviceId()).toBe(PHONE_ID);
      expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(PHONE_ID);
    });

    it('creates a random UUID once and reuses it', async () => {
      const service = TestBed.inject(MobileSocketService);
      const id = await service.getMobileDeviceId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(id);
    });
  });

  it('does not reconnect after the user disconnects, also when the backend has no disconnect route', fakeAsync(() => {
    storeSession();
    const service = TestBed.inject(MobileSocketService);
    const socket = pairFromStoredSession(service);

    service.disconnect();
    flushMicrotasks();
    // servicemind-saas: unknown socket route answers 404
    socket.receive({ status: 404, channel: 'tis-image-mobile-uploader/disconnect-mobile-link', body: {} });
    flushMicrotasks();
    tick(60000);

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    stop(service);
  }));

  it('retries a failed reconnect once per attempt and keeps a single socket', fakeAsync(() => {
    storeSession();
    const service = TestBed.inject(MobileSocketService);
    const first = pairFromStoredSession(service);

    first.drop();
    tick(1000); // attempt 1
    flushMicrotasks();
    expect(FakeWebSocket.instances.length).toBe(2);

    lastSocket().fail(); // error + close of a socket that never opened
    flushMicrotasks();
    tick(2000); // attempt 2
    flushMicrotasks();
    expect(FakeWebSocket.instances.length).toBe(3);

    tick(10000);
    flushMicrotasks();
    expect(FakeWebSocket.instances.length).toBe(3);

    // A user retry replaces the pending attempt instead of running next to it
    service.retryFromStoredSession().catch(() => undefined);
    flushMicrotasks();
    expect(FakeWebSocket.instances.length).toBe(4);
    expect(FakeWebSocket.instances[2].readyState).toBe(FakeWebSocket.CLOSED);
    completeLink(lastSocket());
    expect(service.isConnected()).toBeTrue();
    stop(service);
  }));

  it('rejects API calls at once when the socket is not open', async () => {
    const service = TestBed.inject(MobileSocketService);
    await expectAsync(service.callApiViaSocketPromise('tis-image-mobile-uploader/file-uploaded', {}))
      .toBeRejectedWithError(/Not connected/);
  });

  it('rejects a 200 answer whose body says success: false', fakeAsync(() => {
    storeSession();
    const service = TestBed.inject(MobileSocketService);
    const socket = pairFromStoredSession(service);

    let error: Error | undefined;
    service.callApiViaSocketPromise('tis-image-mobile-uploader/file-uploaded', {}).catch(e => error = e);
    socket.receive({
      status: 200,
      channel: 'tis-image-mobile-uploader/file-uploaded',
      body: { success: false, message: 'Desktop device is not connected' }
    });
    flushMicrotasks();

    expect(error?.message).toBe('Desktop device is not connected');
    stop(service);
  }));

  it('ignores desktop messages addressed to another phone', fakeAsync(() => {
    storeSession();
    const service = TestBed.inject(MobileSocketService);
    const socket = pairFromStoredSession(service);

    const seen: string[] = [];
    service.desktopMessages$.subscribe(message => seen.push(`${message.type}:${message['mobileDeviceId'] ?? '-'}`));
    socket.receive({ channel: CHANNEL, payload: { type: 'field-request', mobileDeviceId: 'other-phone', field: {} } });
    socket.receive({ channel: CHANNEL, payload: { type: 'session-ended', mobileDeviceId: 'other-phone' } });
    socket.receive({ channel: CHANNEL, payload: { type: 'field-request', mobileDeviceId: PHONE_ID, field: {} } });
    socket.receive({ channel: CHANNEL, payload: { type: 'field-request', field: {} } }); // older payloads without an id

    expect(seen).toEqual(['field-request:phone-1', 'field-request:-']);
    stop(service);
  }));

  it('judges token expiry by its lifetime, not the phone clock', fakeAsync(() => {
    localStorage.setItem(DEVICE_ID_KEY, PHONE_ID);
    const http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(MobileSocketService);

    service.initialize({ token: 'link-token', deviceId: DESKTOP_ID, userId: '7', apiUrl: 'https%3A%2F%2Fapi.test%2Fapi' })
      .catch(() => undefined);
    flushMicrotasks();

    // Token issued by a server whose clock is 2 hours behind the phone: exp is "in the past" for the phone
    const serverNow = Math.floor(Date.now() / 1000) - 2 * 3600;
    http.expectOne('https://api.test/api/ease-of-access/generate-login-and-refresh-token-for-mobile-link-app')
      .flush({ accessToken: jwt(serverNow, serverNow + 1800), refreshToken: 'refresh-token', socketUrl: 'wss://socket.test' });
    flushMicrotasks();
    completeLink(lastSocket());
    expect(service.isConnected()).toBeTrue();

    // Reconnect 10 minutes later: still inside the 30-minute lifetime, so no refresh call
    tick(10 * 60 * 1000 - 30000);
    lastSocket().drop();
    tick(1000);
    flushMicrotasks();
    http.expectNone('https://api.test/api/ease-of-access/refresh-token-for-mobile-link-app');
    expect(FakeWebSocket.instances.length).toBe(2);

    http.verify();
    stop(service);
  }));
});
