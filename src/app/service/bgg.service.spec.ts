import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { BggService } from './bgg.service';

/**
 * getBggGameInfo shares answers for 90 s so My Lists' refresh and the bell watcher don't fetch
 * the same game twice (2026-11-20). These pin down that behaviour.
 */
describe('BggService.getBggGameInfo sharing', () => {
  let service: BggService;
  let http: HttpTestingController;
  const url = (id: string) => `https://tabletop.events/api/librarygame/${id}`;
  const game = (id: string, out = 0) => ({ result: { id, name: 'Heat', is_checked_out: out } });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(BggService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shares one request between two callers while it is in flight', () => {
    const a: unknown[] = [];
    service.getBggGameInfo('G1').subscribe(r => a.push(r));
    service.getBggGameInfo('G1').subscribe(r => a.push(r));
    http.expectOne(r => r.url === url('G1')).flush(game('G1'));
    expect(a.length).toBe(2);
  });

  it('reuses a recent answer without a new request', () => {
    service.getBggGameInfo('G1').subscribe();
    http.expectOne(r => r.url === url('G1')).flush(game('G1'));
    let second: any;
    service.getBggGameInfo('G1').subscribe(r => (second = r));
    http.expectNone(r => r.url === url('G1'));
    expect(second.result.id).toBe('G1');
  });

  it('asks again after forgetGameInfo (the refresh button)', () => {
    service.getBggGameInfo('G1').subscribe();
    http.expectOne(r => r.url === url('G1')).flush(game('G1', 1));
    service.forgetGameInfo();
    let fresh: any;
    service.getBggGameInfo('G1').subscribe(r => (fresh = r));
    http.expectOne(r => r.url === url('G1')).flush(game('G1', 0));
    expect(fresh.result.is_checked_out).toBe(0);
  });

  it('does not keep a failed request', () => {
    service.getBggGameInfo('G1').subscribe({ error: () => undefined });
    http.expectOne(r => r.url === url('G1')).flush('busy', { status: 503, statusText: 'Busy' });
    service.getBggGameInfo('G1').subscribe();
    http.expectOne(r => r.url === url('G1')).flush(game('G1'));
  });

  it('asks again once the answer is older than 90 s', () => {
    const start = Date.now();
    spyOn(Date, 'now').and.returnValue(start);
    service.getBggGameInfo('G1').subscribe();
    http.expectOne(r => r.url === url('G1')).flush(game('G1'));
    (Date.now as jasmine.Spy).and.returnValue(start + 91_000);
    service.getBggGameInfo('G1').subscribe();
    http.expectOne(r => r.url === url('G1')).flush(game('G1'));
  });
});
