import { Injectable, OnDestroy, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Subject, Observable, firstValueFrom, throwError } from 'rxjs';
import { take, timeout, catchError } from 'rxjs/operators';
import { decodeApiUrl } from '../utils/upload-helpers';

// =============================================================================
// Types
// =============================================================================

export type ConnectionState = 
  | 'IDLE'
  | 'VALIDATING_TOKEN'
  | 'CONNECTING'
  | 'ESTABLISHING_LINK'
  | 'WAITING_FOR_DESKTOP'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR'
  | 'DISCONNECTED';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Parameters from QR code
 */
export interface QrCodeParams {
  token: string;        // UUID token for authentication
  deviceId: string;     // Desktop device ID
  userId: string;       // User ID
  apiUrl: string;       // API base URL
}

/**
 * Stored session data in localStorage
 */
export interface StoredSession {
  token: string;
  deviceId: string;
  userId: string;
  apiUrl: string;
  socketUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Local-clock time (ms) the access token expires, see `localExpiryOf`. */
  accessTokenExpiresAt?: number;
  mobileDeviceId?: string;
  storedAt: number;
}

/**
 * Rejection for a connect/link attempt that a newer attempt (retry, QR scan, reconnect) or a
 * disconnect replaced. Whoever replaced it owns the connection now, so callers just ignore it.
 */
export class SupersededError extends Error {
  constructor() {
    super('Connection attempt superseded');
  }
}

/**
 * Response from generate-login-and-refresh-token API
 */
interface TokenResponse {
  success?: boolean;
  accessToken: string;
  refreshToken: string;
  socketUrl: string;
  expiresIn?: number;
  uploadChannelPrefix?: string;
  desktopDeviceId?: string;
  mobileDeviceId?: string;
  data?: TokenResponse; // API may wrap response in data field
}

/**
 * Desktop message received via socket
 */
export interface DesktopMessage {
  type: string;
  state?: string;
  connectionState?: string;
  desktopDeviceId?: string;
  [key: string]: any;
}

/**
 * Channel stream for subscriptions
 */
export interface ChannelStream {
  channelName: string;
  data$: Subject<any>;
  responseCount: number;
  closeAfterFirstResponse: boolean;
}

/**
 * Channel subscription info
 */
interface ChannelSubscriptionInfo {
  subject: Subject<any>;
  closeAfterFirstResponse: boolean;
  isActive: boolean;
}

/**
 * Device online status
 */
export interface DeviceOnlineStatus {
  isOnline: boolean;
  deviceId: string;
  lastPing?: number;
  connectionId?: string;
}

/**
 * Combined device status for both desktop and mobile
 */
export interface DevicesOnlineStatus {
  desktop: DeviceOnlineStatus;
  mobile: DeviceOnlineStatus;
  lastChecked: number;
  isReadyForTransfer: boolean;
}

const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

// =============================================================================
// Service
// =============================================================================

@Injectable({ providedIn: 'root' })
export class MobileSocketService implements OnDestroy {
  private static readonly COMPONENT = 'MobileSocketService';
  private static readonly STORAGE_KEY = 'angular-mobile-session';
  // ponytail: read/migrate old localStorage key; remove after all clients refresh
  private static readonly LEGACY_STORAGE_KEY = 'tis-mobile-session';
  private static readonly SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly TOKEN_EXPIRY_BUFFER = 60 * 1000; // 1 minute buffer before expiry
  private static readonly DEVICE_ID_KEY = 'angular-mobile-device-id';

  private readonly http = inject(HttpClient);

  // Configuration
  private qrParams: QrCodeParams | null = null;
  private mobileDeviceId: string = this.loadOrCreateMobileDeviceId();
  private desktopDeviceId: string = '';
  private userId: string = '';
  private apiUrl: string = '';
  private socketUrl: string = '';
  private accessToken: string = '';
  private refreshToken: string = '';
  private accessTokenExpiresAt = 0;
  private channelName: string = '';

  // Socket
  private socket: WebSocket | null = null;
  private connectionState: ConnectionState = 'IDLE';

  // Observables
  private readonly _connectionState$ = new BehaviorSubject<ConnectionState>('IDLE');
  private readonly _connectionStatus$ = new BehaviorSubject<ConnectionStatus>('disconnected');
  private readonly _desktopMessages$ = new Subject<DesktopMessage>();
  private readonly _error$ = new BehaviorSubject<string | null>(null);
  private readonly destroy$ = new Subject<void>();

  // Public observables
  readonly connectionState$ = this._connectionState$.asObservable();
  readonly connectionStatus$ = this._connectionStatus$.asObservable();
  readonly desktopMessages$ = this._desktopMessages$.asObservable();
  readonly error$ = this._error$.asObservable();

  // Reconnection
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeoutId: any = null;

  // Heartbeat
  private heartbeatInterval: any = null;
  private lastPongReceived = 0;

  // Health check
  private healthCheckInterval: any = null;
  private readonly _devicesStatus$ = new BehaviorSubject<DevicesOnlineStatus | null>(null);
  private readonly _isCheckingStatus$ = new BehaviorSubject<boolean>(false);
  readonly devicesStatus$ = this._devicesStatus$.asObservable();
  readonly isCheckingStatus$ = this._isCheckingStatus$.asObservable();

  // Channel subscriptions
  private channels = new Map<string, ChannelStream>();
  private activeChannelSubscriptions = new Map<string, ChannelSubscriptionInfo>();
  private activePrefixes = new Set<string>();

  // State transition protection
  private isTransitioning = false;
  private stateTransitionQueue: ConnectionState[] = [];

  // Attempts still waiting on the current socket; closeSocket() cancels them (SupersededError)
  private pendingConnectReject: ((error: Error) => void) | null = null;
  private pendingLinkCancel: (() => void) | null = null;

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Mobile device ID: a random UUID kept in localStorage, so it is the same across reloads and tabs.
   * An ID already stored (or the one of a stored session from an older app version) is kept.
   */
  private loadOrCreateMobileDeviceId(): string {
    try {
      const existing =
        localStorage.getItem(MobileSocketService.DEVICE_ID_KEY) || this.getStoredSession()?.mobileDeviceId;
      if (existing) {
        localStorage.setItem(MobileSocketService.DEVICE_ID_KEY, existing);
        return existing;
      }
    } catch { }

    const id = crypto.randomUUID?.() || this.fallbackUUID();
    try {
      localStorage.setItem(MobileSocketService.DEVICE_ID_KEY, id);
    } catch { }
    return id;
  }

  /** UUID v4 for browsers without crypto.randomUUID (iOS < 15.4, non-HTTPS). */
  private fallbackUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get mobile device ID
   */
  async getMobileDeviceId(): Promise<string> {
    return this.mobileDeviceId;
  }

  /**
   * Get desktop device ID
   */
  getDesktopDeviceId(): string {
    return this.desktopDeviceId;
  }

  /**
   * Get API URL
   */
  getApiUrl(): string {
    return this.apiUrl;
  }

  /**
   * Get channel name
   */
  getChannelName(): string {
    return this.channelName;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'CONNECTED' && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Try to restore session from localStorage
   */
  hasStoredSession(): boolean {
    try {
      const stored =
        localStorage.getItem(MobileSocketService.STORAGE_KEY) ??
        localStorage.getItem(MobileSocketService.LEGACY_STORAGE_KEY);
      if (!stored) return false;
      
      const session: StoredSession = JSON.parse(stored);
      return Date.now() - session.storedAt < MobileSocketService.SESSION_TTL;
    } catch {
      return false;
    }
  }

  /**
   * Initialize from QR code parameters
   * Flow:
   * 1. Call API with token, deviceId, userId to get accessToken, refreshToken, socketUrl
   * 2. Connect to WebSocket
   * 3. Call 'establish-mobile-upload-link' via socket
   * 4. Wait for SUCCESS from desktop
   */
  async initialize(params: QrCodeParams): Promise<void> {
    console.log(`[${MobileSocketService.COMPONENT}] Initializing with params:`, params);

    // Drop any previous socket, reconnect timer and pending attempt before pairing with this QR code
    this.cleanup();

    // Store params
    this.qrParams = params;
    this.desktopDeviceId = params.deviceId;
    this.userId = params.userId;
    this.apiUrl = decodeApiUrl(params.apiUrl);
    this.channelName = `tis-mobile-upload-w-dev-${params.deviceId}`;

    // Save to localStorage for retry (replaces the previous session: the new QR code wins)
    this.saveSession({
      token: params.token,
      deviceId: params.deviceId,
      userId: params.userId,
      apiUrl: this.apiUrl,
      mobileDeviceId: this.mobileDeviceId,
      storedAt: Date.now()
    });

    this._error$.next(null);
    this.reconnectAttempts = 0;

    await this.failOnError(async () => {
      // Step 1: Get tokens from API
      await this.fetchTokens(params.token);

      // Step 2: Connect to WebSocket (the tokens were just issued: no expiry check)
      await this.connect(false);

      // Step 3: Establish link with desktop
      await this.establishMobileUploadLink();

      console.log(`[${MobileSocketService.COMPONENT}] Initialization complete!`);
    });
  }

  /**
   * True when the stored session already holds tokens for this QR code (same link token and desktop),
   * so a reload can reconnect with them instead of exchanging the (possibly expired) link token again.
   */
  hasStoredTokensFor(params: Pick<QrCodeParams, 'token' | 'deviceId'>): boolean {
    const stored = this.getStoredSession();
    return !!stored?.accessToken && !!stored.socketUrl &&
      stored.token === params.token && stored.deviceId === params.deviceId;
  }

  /**
   * Retry connection using stored session
   */
  async retryFromStoredSession(): Promise<void> {
    const stored = this.getStoredSession();
    if (!stored) {
      throw new Error('No stored session found');
    }

    // If we have valid tokens, try to reconnect directly
    if (stored.accessToken && stored.socketUrl) {
      this.desktopDeviceId = stored.deviceId;
      this.userId = stored.userId;
      this.apiUrl = decodeApiUrl(stored.apiUrl);
      this.socketUrl = stored.socketUrl;
      this.accessToken = stored.accessToken;
      this.refreshToken = stored.refreshToken || '';
      this.accessTokenExpiresAt = stored.accessTokenExpiresAt || 0;
      this.channelName = `tis-mobile-upload-w-dev-${stored.deviceId}`;

      // Keep the device ID the desktop was paired with
      if (stored.mobileDeviceId) {
        this.mobileDeviceId = stored.mobileDeviceId;
      }
      this._error$.next(null);
      this.reconnectAttempts = 0;

      await this.failOnError(async () => {
        await this.connect();
        await this.establishMobileUploadLink();
      });
    } else {
      // Re-initialize with stored params
      await this.initialize({
        token: stored.token,
        deviceId: stored.deviceId,
        userId: stored.userId,
        apiUrl: stored.apiUrl
      });
    }
  }

  /**
   * Run a connect attempt; on failure stop everything it started (so nothing reconnects behind the
   * error screen), report ERROR and rethrow. A superseded attempt is rethrown untouched.
   */
  private async failOnError(attempt: () => Promise<void>): Promise<void> {
    try {
      await attempt();
    } catch (error: any) {
      if (error instanceof SupersededError) throw error;
      console.error(`[${MobileSocketService.COMPONENT}] Connection attempt failed:`, error);
      this.cleanup();
      this._error$.next(error?.message || 'Initialization failed');
      this.transitionTo('ERROR');
      throw error;
    }
  }

  // ===========================================================================
  // Token Management
  // ===========================================================================

  /**
   * Fetch tokens from API using the link token
   */
  private async fetchTokens(token: string): Promise<void> {
    this.transitionTo('VALIDATING_TOKEN');

    const endpoint = `${this.apiUrl}/ease-of-access/generate-login-and-refresh-token-for-mobile-link-app`;
    
    console.log(`[${MobileSocketService.COMPONENT}] Fetching tokens from:`, endpoint);

    try {
      const apiResponse = await firstValueFrom(
        this.http.post<TokenResponse>(endpoint, {
          token,
          deviceId: this.desktopDeviceId,
          userId: this.userId,
          mobileDeviceId: await this.getMobileDeviceId()
        }).pipe(
          timeout(30000),
          catchError(err => {
            throw new Error(err.error?.message || 'Failed to validate token');
          })
        )
      );

      // Handle both direct response and data-wrapped response
      const response = apiResponse.data || apiResponse;
      
      console.log(`[${MobileSocketService.COMPONENT}] API Response:`, JSON.stringify(apiResponse, null, 2));

      if (!response.accessToken || !response.socketUrl) {
        throw new Error('Invalid token response: missing accessToken or socketUrl');
      }

      this.accessToken = response.accessToken;
      this.refreshToken = response.refreshToken;
      this.accessTokenExpiresAt = this.localExpiryOf(response.accessToken);
      this.socketUrl = response.socketUrl;

      // Update stored session with tokens
      const stored = this.getStoredSession();
      if (stored) {
        this.saveSession({
          ...stored,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          accessTokenExpiresAt: this.accessTokenExpiresAt,
          socketUrl: this.socketUrl,
          mobileDeviceId: await this.getMobileDeviceId()
        });
      }

      console.log(`[${MobileSocketService.COMPONENT}] Tokens received, socket URL:`, this.socketUrl);

    } catch (error: any) {
      console.error(`[${MobileSocketService.COMPONENT}] Token fetch failed:`, error);
      throw error;
    }
  }

  // ===========================================================================
  // Token Validation & Refresh
  // ===========================================================================

  /**
   * Decode JWT token payload (without verification)
   */
  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = parts[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch (e) {
      console.warn(`[${MobileSocketService.COMPONENT}] Failed to decode JWT:`, e);
      return null;
    }
  }

  /**
   * Local-clock time (ms) a just-received token expires: its lifetime (exp - iat) counted from now,
   * so a phone clock that is off does not matter. 0 when the token has no exp/iat.
   */
  private localExpiryOf(token: string): number {
    const payload = this.decodeJwtPayload(token);
    if (!payload?.exp || !payload?.iat) return 0;
    return Date.now() + (payload.exp - payload.iat) * 1000;
  }

  /**
   * Check if JWT token is expired or about to expire.
   * Uses the receipt-based expiry when known, else the token's exp against the phone clock.
   */
  private isTokenExpired(token: string): boolean {
    let expiryTime = token === this.accessToken ? this.accessTokenExpiresAt : 0;
    if (!expiryTime) {
      const payload = this.decodeJwtPayload(token);
      if (!payload || !payload.exp) {
        // If we can't decode or no exp claim, assume expired
        return true;
      }
      expiryTime = payload.exp * 1000; // Convert to milliseconds
    }

    const now = Date.now();
    const isExpired = now >= (expiryTime - MobileSocketService.TOKEN_EXPIRY_BUFFER);
    
    if (isExpired) {
      console.log(`[${MobileSocketService.COMPONENT}] Token expired or expiring soon. Expiry: ${new Date(expiryTime).toISOString()}, Now: ${new Date(now).toISOString()}`);
    }
    
    return isExpired;
  }

  /**
   * Refresh the access token using refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const endpoint = `${this.apiUrl}/ease-of-access/refresh-token-for-mobile-link-app`;
    
    console.log(`[${MobileSocketService.COMPONENT}] Refreshing access token...`);

    try {
      const apiResponse = await firstValueFrom(
        this.http.post<TokenResponse>(endpoint, {
          refreshToken: this.refreshToken,
          mobileDeviceId: await this.getMobileDeviceId(),
          desktopDeviceId: this.desktopDeviceId
        }).pipe(
          timeout(30000),
          catchError(err => {
            throw new Error(err.error?.message || 'Failed to refresh token');
          })
        )
      );

      // Handle both direct response and data-wrapped response
      const response = apiResponse.data || apiResponse;

      if (!response.accessToken) {
        throw new Error('Invalid refresh token response: missing accessToken');
      }

      this.accessToken = response.accessToken;
      this.accessTokenExpiresAt = this.localExpiryOf(response.accessToken);

      // Update refresh token if provided
      if (response.refreshToken) {
        this.refreshToken = response.refreshToken;
      }

      // Update stored session with new tokens
      const stored = this.getStoredSession();
      if (stored) {
        this.saveSession({
          ...stored,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          accessTokenExpiresAt: this.accessTokenExpiresAt
        });
      }

      console.log(`[${MobileSocketService.COMPONENT}] Access token refreshed successfully`);

    } catch (error: any) {
      console.error(`[${MobileSocketService.COMPONENT}] Token refresh failed:`, error);
      throw error;
    }
  }

  /**
   * Validate access token and refresh if expired
   */
  private async validateAndRefreshToken(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('No access token available');
    }

    if (this.isTokenExpired(this.accessToken)) {
      console.log(`[${MobileSocketService.COMPONENT}] Access token expired, attempting refresh...`);
      
      if (!this.refreshToken) {
        throw new Error('Access token expired and no refresh token available. Please scan QR code again.');
      }

      try {
        await this.refreshAccessToken();
      } catch (error: any) {
        // If refresh fails, clear session and throw
        this.clearStoredSession();
        throw new Error('Session expired. Please scan QR code again.');
      }
    } else {
      console.log(`[${MobileSocketService.COMPONENT}] Access token is valid`);
    }
  }

  // ===========================================================================
  // WebSocket Connection
  // ===========================================================================

  /**
   * Connect to WebSocket. Replaces any previous socket (and cancels attempts still waiting on it).
   * @param checkToken false right after fetchTokens: the tokens were just issued
   */
  private async connect(checkToken = true): Promise<void> {
    // A pending reconnect timer must not start a second socket alongside this one
    this.clearReconnectTimer();

    const deviceId = await this.getMobileDeviceId();

    // Validate and refresh token if needed before connecting
    if (checkToken) {
      await this.validateAndRefreshToken();
    }

    return new Promise((resolve, reject) => {
      this.transitionTo('CONNECTING');

      if (!this.socketUrl) {
        reject(new Error('Socket URL not available'));
        return;
      }

      if (!deviceId) {
        reject(new Error('Mobile device ID not available'));
        return;
      }

      // Add auth token and device ID to socket URL
      const url = new URL(this.socketUrl);
      url.searchParams.set('Auth', this.accessToken);
      url.searchParams.set('deviceId', deviceId);

      console.log(`[${MobileSocketService.COMPONENT}] Connecting to WebSocket with deviceId:`, deviceId);

      try {
        // Only one socket at a time (done here, synchronously, so two racing connect() calls can't both keep one)
        this.closeSocket();
        const socket = new WebSocket(url.toString());
        this.socket = socket;
        this.pendingConnectReject = reject;
        let opened = false;

        socket.onopen = () => {
          console.log(`[${MobileSocketService.COMPONENT}] WebSocket connected`);
          opened = true;
          this.pendingConnectReject = null;
          this.startHeartbeat();
          resolve();
        };

        socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        socket.onerror = (error) => {
          console.error(`[${MobileSocketService.COMPONENT}] WebSocket error:`, error);
          if (!opened) {
            this.pendingConnectReject = null;
            reject(new Error('WebSocket connection failed'));
          }
        };

        socket.onclose = (event) => {
          console.log(`[${MobileSocketService.COMPONENT}] WebSocket closed:`, event.code, event.reason);
          if (!opened) {
            // Never opened: the caller of connect() handles the failure (and any retry)
            this.pendingConnectReject = null;
            reject(new Error('WebSocket connection failed'));
            return;
          }
          this.handleDisconnect(event.code);
        };

      } catch (error) {
        this.pendingConnectReject = null;
        reject(error);
      }
    });
  }

  /**
   * Detach and close the current socket so its late events (close, messages) can't reach us or
   * start a reconnect, and cancel any connect/link attempt still waiting on it.
   */
  private closeSocket(): void {
    const rejectConnect = this.pendingConnectReject;
    const cancelLink = this.pendingLinkCancel;
    this.pendingConnectReject = null;
    this.pendingLinkCancel = null;
    rejectConnect?.(new SupersededError());
    cancelLink?.();

    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close(1000, 'Client disconnect');
    } catch { }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  /**
   * Establish mobile upload link with desktop
   */
  private async establishMobileUploadLink(): Promise<void> {
    this.transitionTo('ESTABLISHING_LINK');

    console.log(`[${MobileSocketService.COMPONENT}] Establishing link with desktop...`);

    // Subscribe to channel for desktop messages
    this.subscribeToChannel(this.channelName);

    // Set up the response listener BEFORE making the API call
    // This ensures we don't miss the mobile-link-established message
    const connectionPromise = new Promise<void>((resolve, reject) => {
      // Every way out (link up, desktop disconnect, timeout, superseded) clears the timer and the listener
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        sub.unsubscribe();
        if (this.pendingLinkCancel === cancel) this.pendingLinkCancel = null;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const cancel = () => finish(new SupersededError());
      this.pendingLinkCancel = cancel;

      const timeout = setTimeout(() => {
        console.warn(`[${MobileSocketService.COMPONENT}] Connection timeout - desktop did not respond in 30s`);
        finish(new Error('Desktop did not respond. Please ensure the desktop app is open.'));
      }, 30000);

      const sub = this._desktopMessages$.subscribe(msg => {
        // Handle mobile-link-established from backend (via desktop channel)
        if (msg.type === 'mobile-link-established') {
          console.log(`[${MobileSocketService.COMPONENT}] ✅ Mobile link established`);
          this.reconnectAttempts = 0;
          this.transitionTo('CONNECTED');
          finish();
        }
        // Also handle legacy SUCCESS response
        else if (msg.type === 'connectionState' && (msg.state === 'SUCCESS' || msg.connectionState === 'SUCCESS')) {
          console.log(`[${MobileSocketService.COMPONENT}] ✅ Connection confirmed (legacy)`);
          this.reconnectAttempts = 0;
          this.transitionTo('CONNECTED');
          finish();
        }
        // Handle disconnect from desktop
        else if (msg.type === 'mobile-link-disconnected' || msg.type === 'disconnect') {
          console.log(`[${MobileSocketService.COMPONENT}] Desktop disconnected`);
          finish(new Error('Desktop disconnected the session.'));
          this.handleRemoteDisconnect();
        }
      });
    });

    try {
      // Call establish-mobile-upload-link action via proper API route
      const response = await this.callApiViaSocketPromise('tis-image-mobile-uploader/establish-mobile-upload-link', {
        desktopDeviceId: this.desktopDeviceId,
        mobileDeviceId: await this.getMobileDeviceId(),
        userId: this.userId,
        channel: this.channelName
      });

      console.log(`[${MobileSocketService.COMPONENT}] Establish link response:`, response);

    } catch (error: any) {
      console.warn(`[${MobileSocketService.COMPONENT}] Establish link API call failed:`, error);
      // Continue anyway - the channel subscription should still work
    }

    // Only transition to WAITING_FOR_DESKTOP if we haven't already connected
    // (the mobile-link-established message might arrive before the API response)
    if (this.connectionState !== 'CONNECTED') {
      this.transitionTo('WAITING_FOR_DESKTOP');
    }

    // Wait for the connection response
    return connectionPromise;
  }

  /**
   * Handle disconnect initiated from remote (desktop) side
   */
  private handleRemoteDisconnect(): void {
    console.log(`[${MobileSocketService.COMPONENT}] Handling remote disconnect...`);
    this.endSession();
    this._error$.next('Connection was ended by the desktop app.');
  }

  /**
   * End the session locally (desktop ended it, or the user disconnected): close the socket without
   * reconnecting and forget the stored session and tokens, so nothing can pair again by itself.
   */
  endSession(): void {
    this.cleanup();
    this.clearStoredSession();
    this.accessToken = '';
    this.refreshToken = '';
    this.accessTokenExpiresAt = 0;
    this.transitionTo('DISCONNECTED');
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Send raw message via socket (internal use only - for ping/pong and callApiViaSocket)
   */
  private sendRawMessage(message: any): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn(`[${MobileSocketService.COMPONENT}] Cannot send, socket not open`);
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (e) {
      console.error(`[${MobileSocketService.COMPONENT}] Send failed:`, e);
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      // Only log non-ping/pong messages to reduce noise
      if (parsed.channel !== 'pong' && parsed.action !== 'pong') {
        console.log(`[${MobileSocketService.COMPONENT}] Message received:`, parsed.channel || parsed.action, parsed.payload?.type || '');
      }

      // Handle pong
      if (parsed.action === 'pong' || parsed.channel === 'pong') {
        this.lastPongReceived = Date.now();
        return;
      }

      // Check if this is a desktop message (from our channel)
      if (parsed.channel === this.channelName || 
          (Array.isArray(parsed.channel) && parsed.channel.includes(this.channelName))) {
        const message: DesktopMessage = parsed.data || parsed.payload || parsed;
        // The backend sends upload-channel messages to every socket of the user, so another phone (or an
        // older pairing) linked to the same desktop gets them too: skip those addressed to a different phone.
        if (message?.['mobileDeviceId'] && message['mobileDeviceId'] !== this.mobileDeviceId) {
          console.log(`[${MobileSocketService.COMPONENT}] Ignoring desktop message for another phone:`, message.type);
        } else {
          console.log(`[${MobileSocketService.COMPONENT}] ✅ Desktop message received:`, message);
          this._desktopMessages$.next(message);
        }
      }
      // Note: Other channels (API responses, subscribe confirmations, welcome) are handled by channel routing below

      // Route to channel subscribers (including API responses)
      if (parsed.channel) {
        const channels = Array.isArray(parsed.channel) ? parsed.channel : [parsed.channel];
        channels.forEach((ch: string) => {
          // First try exact match
          let channelStream = this.channels.get(ch);
          
          // If no exact match, try to find a channel that starts with this route (for API responses)
          if (!channelStream) {
            for (const [key, value] of this.channels.entries()) {
              if (key.startsWith(ch + '_') || ch.startsWith(key)) {
                channelStream = value;
                break;
              }
            }
          }
          
          // Also check prefix subscriptions
          if (!channelStream) {
            for (const prefix of this.activePrefixes) {
              if (ch.startsWith(prefix)) {
                channelStream = this.channels.get(`_prefix_${prefix}`);
                break;
              }
            }
          }
          
          if (channelStream) {
            channelStream.data$.next(parsed);
            channelStream.responseCount++;
            
            // Auto-close channel after first response if configured
            if (channelStream.closeAfterFirstResponse && channelStream.responseCount >= 1) {
              this.unsubscribeFromChannel(ch);
            }
          }
        });
      }

    } catch (e) {
      console.error(`[${MobileSocketService.COMPONENT}] Failed to parse message:`, e);
    }
  }

  /**
   * Subscribe to a channel
   */
  subscribeToChannel(channelName: string, closeChannelAfterFirstResponse = false): ChannelStream {
    let info = this.activeChannelSubscriptions.get(channelName);
    const isNew = !info;

    if (!info) {
      info = { subject: new Subject<any>(), closeAfterFirstResponse: closeChannelAfterFirstResponse, isActive: true };
      this.activeChannelSubscriptions.set(channelName, info);
    } else {
      info.isActive = true;
      info.closeAfterFirstResponse = closeChannelAfterFirstResponse;
    }

    // Note: Backend subscription calls removed as they're not being used on server side
    // Client-side channel management still works for routing messages

    let channel = this.channels.get(channelName);
    if (!channel) {
      channel = { channelName, data$: info.subject, responseCount: 0, closeAfterFirstResponse: closeChannelAfterFirstResponse };
      this.channels.set(channelName, channel);
    }
    return channel;
  }

  /**
   * Subscribe to a channel prefix (for receiving messages on multiple channels with same prefix)
   */
  subscribeToChannelPrefix(prefix: string): ChannelStream {
    if (!this.activePrefixes.has(prefix)) {
      this.activePrefixes.add(prefix);
    }
    
    const tempChannelName = `_prefix_${prefix}`;
    let info = this.activeChannelSubscriptions.get(tempChannelName);
    if (!info) {
      info = { subject: new Subject<any>(), closeAfterFirstResponse: false, isActive: true };
      this.activeChannelSubscriptions.set(tempChannelName, info);
    } else {
      info.isActive = true;
    }
    
    let existing = this.channels.get(tempChannelName);
    if (!existing) {
      existing = { channelName: tempChannelName, data$: info.subject, responseCount: 0, closeAfterFirstResponse: false };
      this.channels.set(tempChannelName, existing);
    }
    return existing;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeFromChannel(channelName: string): void {
    const channelInfo = this.activeChannelSubscriptions.get(channelName);
    if (channelInfo) {
      channelInfo.isActive = false;
      try { channelInfo.subject.complete(); } catch { }
      this.activeChannelSubscriptions.delete(channelName);
      this.channels.delete(channelName);

      // Notify server of unsubscription
      if (this.connectionState === 'CONNECTED' && !channelName.startsWith('_prefix_')) {
        // this.sendRawMessage({ action: 'unsubscribe', data: { channel: channelName } });
      }

      // Handle prefix channels
      if (channelName.startsWith('_prefix_')) {
        const prefix = channelName.slice('_prefix_'.length);
        this.activePrefixes.delete(prefix);
      }
      
      console.log(`[${MobileSocketService.COMPONENT}] Unsubscribed from channel: ${channelName}`);
    }
  }

  /**
   * Unsubscribe from a channel prefix
   */
  unsubscribeFromChannelPrefix(prefix: string): void {
    console.log(`[${MobileSocketService.COMPONENT}] Unsubscribe prefix "${prefix}"`);
    const tempName = `_prefix_${prefix}`;
    this.unsubscribeFromChannel(tempName);
  }

  /**
   * Send channel subscription to server
   * NOTE: Disabled - backend team confirmed this is not being used
   */
  private sendChannelSubscription(channelName: string): void {
    // const socketBodyPayload = { route: 'tis-image-mobile-uploader/subscribe', body: { channel: channelName } };
    // this.sendRawMessage({ action: 'api', data: socketBodyPayload });
  }

  // ===========================================================================
  // API Calls via Socket
  // ===========================================================================

  /**
   * Call API via socket - returns Observable for the response
   */
  callApiViaSocket(url: string, body: any = null): Observable<any> {
    // A message sent on a closed socket is silently lost: fail now instead of waiting for a timeout
    if (!this.isSocketOpen()) {
      console.warn(`[${MobileSocketService.COMPONENT}] Socket not connected, not sending:`, url);
      return throwError(() => new Error('Not connected to the server. Please wait for the connection to come back and try again.'));
    }
    const socketBodyPayload = { route: url, body };
    this.sendRawMessage({ action: 'api', data: socketBodyPayload });
    const channel = this.subscribeToChannel(url, true);
    return channel.data$.asObservable();
  }

  /**
   * Call API via socket - returns Promise for convenience.
   * Rejects on a non-200 status and on a 200 whose body says `success: false`
   * (e.g. file-uploaded answers that when the desktop is not connected).
   */
  callApiViaSocketPromise(url: string, body: any = null): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API call timeout'));
      }, 30000);

      this.callApiViaSocket(url, body).pipe(take(1)).subscribe({
        next: (response) => {
          clearTimeout(timeout);
          const result = response.payload || response.body || response;
          if ((response.status === 200 || response.statusCode === 200) && result?.success !== false) {
            resolve(result);
          } else {
            reject(new Error(response.message || response.body?.message || 'API call failed'));
          }
        },
        error: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        // The channel was closed (disconnect/cleanup) before any response arrived
        complete: () => {
          clearTimeout(timeout);
          reject(new Error('Connection closed before the server answered'));
        }
      });
    });
  }

  private isSocketOpen(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  // ===========================================================================
  // Heartbeat & Reconnection
  // ===========================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongReceived = Date.now();

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        const now = Date.now();
        
        // Check if pong received from last ping (before sending new one)
        if (now - this.lastPongReceived > 45000) {
          console.warn(`[${MobileSocketService.COMPONENT}] No pong received in 45s, reconnecting...`);
          // A dead link may never deliver a close event: drop the socket and reconnect right away
          this.closeSocket();
          this.handleDisconnect(4000);
          return;
        }

        // Send ping via API route and wait for response
        this.callApiViaSocket('ping', { timestamp: now }).pipe(take(1)).subscribe({
          next: () => {
            this.lastPongReceived = Date.now();
          },
          error: (err: any) => {
            console.warn(`[${MobileSocketService.COMPONENT}] Heartbeat ping error:`, err);
          }
        });
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ===========================================================================
  // Device Health Check
  // ===========================================================================

  /**
   * Start periodic health check for device online status
   */
  startHealthCheck(): void {
    this.stopHealthCheck();

    if (!this.desktopDeviceId || !this.mobileDeviceId) {
      console.warn(`[${MobileSocketService.COMPONENT}] Cannot start health check - missing device IDs`);
      return;
    }

    console.log(`[${MobileSocketService.COMPONENT}] Starting health check (every ${HEALTH_CHECK_INTERVAL / 1000}s)`);

    // Set initial checking state (blinking)
    this._isCheckingStatus$.next(true);

    // Run first check immediately
    this.checkDevicesOnline();

    // Then run periodically
    this.healthCheckInterval = setInterval(() => {
      this.checkDevicesOnline();
    }, HEALTH_CHECK_INTERVAL);
  }

  /**
   * Stop health check
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this._devicesStatus$.next(null);
    this._isCheckingStatus$.next(false);
  }

  /**
   * Check if both devices are online via API
   */
  async checkDevicesOnline(): Promise<DevicesOnlineStatus | null> {
    if (!this.desktopDeviceId || !this.mobileDeviceId) {
      console.warn(`[${MobileSocketService.COMPONENT}] Cannot check devices - missing device IDs`);
      return null;
    }

    try {
      const response = await firstValueFrom(
        this.callApiViaSocket('tis-image-mobile-uploader/check-devices-online', {
          desktopDeviceId: this.desktopDeviceId,
          mobileDeviceId: await this.getMobileDeviceId()
        }).pipe(take(1), timeout(15000))
      );

      // Response structure: { body: { data: { desktop: {...}, mobile: {...} } } }
      const data = response?.body?.data || response?.data || response;
      
      const status: DevicesOnlineStatus = {
        desktop: {
          isOnline: data?.desktop?.isOnline ?? false,
          deviceId: data?.desktop?.deviceId || this.desktopDeviceId,
          lastPing: data?.desktop?.lastPing,
          connectionId: data?.desktop?.connectionId
        },
        mobile: {
          isOnline: data?.mobile?.isOnline ?? false,
          deviceId: data?.mobile?.deviceId || await this.getMobileDeviceId(),
          lastPing: data?.mobile?.lastPing,
          connectionId: data?.mobile?.connectionId
        },
        lastChecked: Date.now(),
        isReadyForTransfer: (data?.desktop?.isOnline ?? false) && (data?.mobile?.isOnline ?? false)
      };

      this._devicesStatus$.next(status);
      this._isCheckingStatus$.next(false);

      console.log(`[${MobileSocketService.COMPONENT}] Devices status:`, {
        desktop: status.desktop.isOnline ? '🟢' : '🔴',
        mobile: status.mobile.isOnline ? '🟢' : '🔴',
        readyForTransfer: status.isReadyForTransfer
      });

      // If mobile device (this device) is offline, send immediate ping to update status
      if (!status.mobile.isOnline && this.socket?.readyState === WebSocket.OPEN) {
        console.log(`[${MobileSocketService.COMPONENT}] Mobile detected as offline, sending immediate ping...`);
        this.callApiViaSocket('ping', { timestamp: Date.now() }).pipe(take(1)).subscribe({
          next: () => {
            console.log(`[${MobileSocketService.COMPONENT}] Immediate ping sent, rechecking status...`);
            // Recheck status after a short delay (unless the health check was stopped meanwhile)
            setTimeout(() => this.healthCheckInterval && this.checkDevicesOnline(), 1000);
          },
          error: (err: any) => {
            console.warn(`[${MobileSocketService.COMPONENT}] Immediate ping failed:`, err);
          }
        });
      }

      return status;
    } catch (error: any) {
      console.warn(`[${MobileSocketService.COMPONENT}] Health check failed:`, error?.message || error);
      
      // On error, mark both as unknown/offline
      const status: DevicesOnlineStatus = {
        desktop: { isOnline: false, deviceId: this.desktopDeviceId },
        mobile: { isOnline: false, deviceId: await this.getMobileDeviceId() },
        lastChecked: Date.now(),
        isReadyForTransfer: false
      };
      this._devicesStatus$.next(status);
      this._isCheckingStatus$.next(false);
      
      return status;
    }
  }

  /**
   * Force an immediate health check
   */
  async refreshDevicesStatus(): Promise<DevicesOnlineStatus | null> {
    this._isCheckingStatus$.next(true);
    return this.checkDevicesOnline();
  }

  /**
   * Get current devices status value
   */
  getDevicesStatusValue(): DevicesOnlineStatus | null {
    return this._devicesStatus$.value;
  }

  /**
   * Check if both devices are online and ready for transfer
   */
  isReadyForTransfer(): boolean {
    return this._devicesStatus$.value?.isReadyForTransfer ?? false;
  }

  private handleDisconnect(code: number): void {
    // An ended session (user disconnect, desktop ended it) must never reconnect by itself
    if (this.connectionState === 'DISCONNECTED') return;

    this._connectionStatus$.next('disconnected');
    this.stopHeartbeat();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      this.giveUpReconnecting();
    }
  }

  private scheduleReconnect(): void {
    this.transitionTo('RECONNECTING');
    this.reconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[${MobileSocketService.COMPONENT}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.clearReconnectTimer();
    this.reconnectTimeoutId = setTimeout(async () => {
      this.reconnectTimeoutId = null;
      try {
        await this.connect();
        await this.establishMobileUploadLink();
      } catch (err) {
        // A newer attempt (user retry, QR scan) or a disconnect took over: leave it to that one
        if (err instanceof SupersededError || this.connectionState === 'DISCONNECTED') return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.giveUpReconnecting();
        }
      }
    }, delay);
  }

  private giveUpReconnecting(): void {
    this.cleanup();
    this._error$.next('Connection lost. Please scan QR code again.');
    this.transitionTo('ERROR');
  }

  // ===========================================================================
  // State Management
  // ===========================================================================

  private transitionTo(state: ConnectionState): void {
    if (this.connectionState === state) return;

    // If currently transitioning, queue this state transition
    if (this.isTransitioning) {
      console.log(`[${MobileSocketService.COMPONENT}] Queuing state transition to ${state} (currently transitioning to ${this.connectionState})`);
      this.stateTransitionQueue.push(state);
      return;
    }

    // Start the transition
    this.performStateTransition(state);
  }

  private performStateTransition(state: ConnectionState): void {
    this.isTransitioning = true;

    try {
      console.log(`[${MobileSocketService.COMPONENT}] State: ${this.connectionState} -> ${state}`);
      this.connectionState = state;
      this._connectionState$.next(state);

      // Log and handle each state transition explicitly
      switch (state) {
        case 'IDLE':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: IDLE - Service is idle, waiting for initialization`);
          this._connectionStatus$.next('disconnected');
          break;
        case 'VALIDATING_TOKEN':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: VALIDATING_TOKEN - Validating QR code token with backend`);
          this._connectionStatus$.next('connecting');
          break;
        case 'CONNECTING':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: CONNECTING - Establishing WebSocket connection`);
          this._connectionStatus$.next('connecting');
          break;
        case 'ESTABLISHING_LINK':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: ESTABLISHING_LINK - Setting up mobile-desktop link`);
          this._connectionStatus$.next('connecting');
          break;
        case 'WAITING_FOR_DESKTOP':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: WAITING_FOR_DESKTOP - Waiting for desktop confirmation`);
          this._connectionStatus$.next('connecting');
          break;
        case 'CONNECTED':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: CONNECTED - Successfully connected to desktop`);
          this._connectionStatus$.next('connected');
          // Start health check when connected
          this.startHealthCheck();
          break;
        case 'RECONNECTING':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: RECONNECTING - Attempting to reconnect after disconnection`);
          this._connectionStatus$.next('connecting');
          break;
        case 'ERROR':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: ERROR - Connection failed or encountered an error`);
          this._connectionStatus$.next('error');
          this.stopHealthCheck();
          break;
        case 'DISCONNECTED':
          console.log(`[${MobileSocketService.COMPONENT}] 🔄 State: DISCONNECTED - Connection terminated`);
          this._connectionStatus$.next('disconnected');
          this.stopHealthCheck();
          break;
        default:
          console.warn(`[${MobileSocketService.COMPONENT}] ⚠️ Unknown state transition to: ${state}`);
          this._connectionStatus$.next('connecting');
      }

      // Process next queued transition if any
      this.processNextQueuedTransition();

    } finally {
      this.isTransitioning = false;
    }
  }

  private processNextQueuedTransition(): void {
    if (this.stateTransitionQueue.length > 0) {
      const nextState = this.stateTransitionQueue.shift()!;
      console.log(`[${MobileSocketService.COMPONENT}] Processing queued state transition to ${nextState}`);
      
      // Use setTimeout to ensure the current transition is fully complete
      setTimeout(() => this.performStateTransition(nextState), 0);
    }
  }

  // ===========================================================================
  // Storage
  // ===========================================================================

  private saveSession(session: StoredSession): void {
    try {
      localStorage.setItem(MobileSocketService.STORAGE_KEY, JSON.stringify(session));
      localStorage.removeItem(MobileSocketService.LEGACY_STORAGE_KEY);
    } catch (e) {
      console.warn(`[${MobileSocketService.COMPONENT}] Failed to save session:`, e);
    }
  }

  private getStoredSession(): StoredSession | null {
    try {
      const stored =
        localStorage.getItem(MobileSocketService.STORAGE_KEY) ??
        localStorage.getItem(MobileSocketService.LEGACY_STORAGE_KEY);
      if (!stored) return null;
      
      const session: StoredSession = JSON.parse(stored);
      if (Date.now() - session.storedAt > MobileSocketService.SESSION_TTL) {
        this.clearStoredSession();
        return null;
      }
      // Migrate legacy key if present
      if (!localStorage.getItem(MobileSocketService.STORAGE_KEY)) {
        this.saveSession(session);
      }
      return session;
    } catch {
      return null;
    }
  }

  private clearStoredSession(): void {
    try {
      localStorage.removeItem(MobileSocketService.STORAGE_KEY);
      localStorage.removeItem(MobileSocketService.LEGACY_STORAGE_KEY);
    } catch (e) {
      console.warn(`[${MobileSocketService.COMPONENT}] Failed to clear session:`, e);
    }
  }

  // ===========================================================================
  // Disconnect & Cleanup
  // ===========================================================================

  async disconnect(): Promise<void> {
    console.log(`[${MobileSocketService.COMPONENT}] Disconnecting...`);

    // Notify backend via API
    if (this.isConnected()) {
      try {
        await this.callApiViaSocketPromise('tis-image-mobile-uploader/disconnect-mobile-link', {
          mobileDeviceId: this.mobileDeviceId,
          desktopDeviceId: this.desktopDeviceId,
          initiatedBy: 'mobile'
        });
      } catch (error: any) {
        console.warn(`[${MobileSocketService.COMPONENT}] Disconnect API call failed:`, error);
        // Continue with local cleanup anyway
      }
    }

    this.endSession();
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.stopHealthCheck();
    this.clearReconnectTimer();

    // Detached close: no close event, so no reconnect (and pending attempts are cancelled)
    this.closeSocket();

    // Close all channel subscriptions
    this.activeChannelSubscriptions.forEach((info, channelName) => {
      try { info.subject.complete(); } catch {}
    });
    this.activeChannelSubscriptions.clear();
    this.channels.clear();
    this.activePrefixes.clear();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }
}
