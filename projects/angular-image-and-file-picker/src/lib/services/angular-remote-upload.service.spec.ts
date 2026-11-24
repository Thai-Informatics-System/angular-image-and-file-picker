import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { AngularRemoteUploadService } from './angular-remote-upload.service';
import { AngularRemoteUploadConfig, AngularRemoteUploadEvent, AngularSocketAdapter } from '../interfaces/socket-adapter.interface';

/** In-memory socket: one channel subject per name; API answers come from `answers`. */
class FakeSocketAdapter implements AngularSocketAdapter {
  connectionStatus$ = new BehaviorSubject<boolean>(true);
  channels = new Map<string, Subject<any>>();
  channelSubscribeCalls = 0;
  calls: { route: string; body: any }[] = [];
  answers: Record<string, any> = {
    'tis-image-mobile-uploader/check-devices-online': { status: 200, body: { data: { desktop: { isOnline: true }, mobile: { isOnline: true } } } },
    'tis-image-mobile-uploader/field-request': { status: 200, body: { success: true } },
  };

  getDeviceId() { return 'desk-1'; }
  getUserId() { return '7'; }
  getApiUrl() { return 'http://api.test'; }
  isConnected() { return this.connectionStatus$.value; }
  subscribeToChannel(name: string): Observable<any> {
    this.channelSubscribeCalls++;
    if (!this.channels.has(name)) this.channels.set(name, new Subject<any>());
    return this.channels.get(name)!.asObservable();
  }
  callApiViaSocket(route: string, body: any): Observable<any> {
    this.calls.push({ route, body });
    return of(this.answers[route] ?? { status: 404, channel: route, body: {} });
  }
  emit(message: any) {
    this.channels.get('tis-mobile-upload-w-dev-desk-1')!.next(message);
  }
}

describe('AngularRemoteUploadService', () => {
  let service: AngularRemoteUploadService;
  let socket: FakeSocketAdapter;
  let config: AngularRemoteUploadConfig;

  const pair = (mobileDeviceId = 'phone-1') => socket.emit({ type: 'mobile-link-established', mobileDeviceId });
  const upload = (mobileDeviceId = 'phone-1', name = 'a.jpg') => socket.emit({
    type: 'file-uploaded', mobileDeviceId,
    files: [{ s3Url: `https://s3.test/${name}`, title: name }],
  });

  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(AngularRemoteUploadService);
    socket = new FakeSocketAdapter();
    config = { enabled: true, socketAdapter: socket, autoAcceptFiles: true };
    await service.configure(config);
  });

  afterEach(() => {
    service.ngOnDestroy();
    localStorage.clear();
  });

  it('listens to the socket once however many pickers configure it', async () => {
    const before = socket.channelSubscribeCalls;
    await service.configure(config);
    await service.configure({ ...config });
    expect(socket.channelSubscribeCalls).toBe(before);

    // a reconnect re-subscribes the channel once, not once per picker
    socket.connectionStatus$.next(false);
    socket.connectionStatus$.next(true);
    expect(socket.channelSubscribeCalls).toBe(before + 1);
  });

  it('tags phone files with the picker that asked and uses that picker\'s callback', () => {
    pair();
    const accepted: string[] = [];
    const lastConfigured = jasmine.createSpy('last configure() callback');
    service.configure({ ...config, onFileAccept: lastConfigured });
    service.setActiveRequester('picker-b', { ...config, onFileAccept: (f) => accepted.push(f.fileName) });

    const events: AngularRemoteUploadEvent[] = [];
    service.getRemoteUploads().subscribe((e) => events.push(e));
    upload();

    expect(events.length).toBe(1);
    expect(events[0].requesterId).toBe('picker-b');
    expect(accepted).toEqual(['a.jpg']);
    expect(lastConfigured).not.toHaveBeenCalled();
  });

  it('ignores files when not paired or from another phone', () => {
    const events: AngularRemoteUploadEvent[] = [];
    service.getRemoteUploads().subscribe((e) => events.push(e));

    upload('phone-1');
    expect(events.length).toBe(0);

    pair('phone-1');
    upload('phone-2');
    expect(events.length).toBe(0);

    upload('phone-1');
    expect(events.length).toBe(1);
  });

  it('forgets the requester when its picker goes away', () => {
    service.setActiveRequester('picker-a');
    service.releaseRequester('picker-other');
    expect(service.getActiveRequesterId()).toBe('picker-a');
    service.releaseRequester('picker-a');
    expect(service.getActiveRequesterId()).toBeNull();
  });

  it('stops waiting and reports false when the phone did not get the request', async () => {
    pair();
    socket.answers['tis-image-mobile-uploader/field-request'] = { status: 200, body: { success: false, message: 'Mobile device is not connected' } };
    const waiting: boolean[] = [];
    service.getIsWaitingForUpload().subscribe((w) => waiting.push(w));

    const sent = await service.sendFieldRequest({ label: 'Photo', accept: 'image/*', type: 'image' });

    expect(sent).toBeFalse();
    expect(waiting[waiting.length - 1]).toBeFalse();
  });

  it('reports true when the phone got the request', async () => {
    pair();
    const sent = await service.sendFieldRequest({ label: 'Photo', accept: 'image/*', type: 'image' });
    expect(sent).toBeTrue();
  });

  it('reports false without calling the API when not paired', async () => {
    const sent = await service.sendFieldRequest({ label: 'Photo', accept: 'image/*', type: 'image' });
    expect(sent).toBeFalse();
    expect(socket.calls.some((c) => c.route === 'tis-image-mobile-uploader/field-request')).toBeFalse();
  });

  it('keeps the pairing when an older phone disconnects, ends it when the paired phone does', () => {
    pair('phone-2');
    socket.emit({ type: 'mobile-link-disconnected', mobileDeviceId: 'phone-1' });
    expect(service.isPaired()).toBeTrue();

    socket.emit({ type: 'mobile-link-disconnected', mobileDeviceId: 'phone-2' });
    expect(service.isPaired()).toBeFalse();
  });

  it('stops waiting when the phone disconnects', async () => {
    pair();
    await service.sendFieldRequest({ label: 'Photo', accept: 'image/*', type: 'image' });
    const waiting: boolean[] = [];
    service.getIsWaitingForUpload().subscribe((w) => waiting.push(w));
    expect(waiting[waiting.length - 1]).toBeTrue();

    socket.emit({ type: 'mobile-link-disconnected', mobileDeviceId: 'phone-1' });
    expect(waiting[waiting.length - 1]).toBeFalse();
  });
});
