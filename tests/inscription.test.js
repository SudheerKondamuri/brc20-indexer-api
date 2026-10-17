'use strict';

const { parseBrc20Inscription, extractInscriptionsFromTx } = require('../src/bitcoin/inscription');

describe('parseBrc20Inscription', () => {
  const makeBody = (json) => Buffer.from(JSON.stringify(json));

  describe('Protocol detection', () => {
    test('returns null for non-BRC-20 protocol', () => {
      const body = makeBody({ p: 'brc-21', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('accepts brc-20 (case insensitive)', () => {
      const body = makeBody({ p: 'BRC-20', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'text/plain')).not.toBeNull();
    });

    test('returns null for application/octet-stream content type', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'application/octet-stream')).toBeNull();
    });

    test('accepts application/json content type', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'application/json')).not.toBeNull();
    });

    test('accepts text/plain;charset=utf-8', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'text/plain;charset=utf-8')).not.toBeNull();
    });

    test('returns null for missing content type', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'test', max: '1000', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, null)).toBeNull();
    });
  });

  describe('Malformed JSON', () => {
    test('returns null for completely malformed JSON', () => {
      const body = Buffer.from('not json at all');
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('returns null for partial JSON', () => {
      const body = Buffer.from('{"p": "brc-20"');
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('returns null for empty buffer', () => {
      expect(parseBrc20Inscription(Buffer.alloc(0), 'text/plain')).toBeNull();
    });
  });

  describe('Deploy operation', () => {
    test('valid deploy returns parsed object', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'ORDI', max: '21000000', lim: '1000', dec: 18 });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result).not.toBeNull();
      expect(result.op).toBe('deploy');
      expect(result.tick).toBe('ordi'); // normalized to lowercase
      expect(result.max).toBe('21000000');
      expect(result.lim).toBe('1000');
      expect(result.dec).toBe(18);
    });

    test('deploy missing max returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'TEST', lim: '100', dec: 18 });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('deploy defaults lim to max when missing', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'TEST', max: '1000', dec: 18 });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result).not.toBeNull();
      expect(result.lim).toBe('1000');
    });

    test('deploy defaults dec to 18 when missing', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'TEST', max: '1000', lim: '100' });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result).not.toBeNull();
      expect(result.dec).toBe(18);
    });

    test('invalid dec > 18 returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'deploy', tick: 'TEST', max: '1000', lim: '100', dec: 19 });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });
  });

  describe('Mint operation', () => {
    test('valid mint returns parsed object', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', tick: 'ORDI', amt: '1000' });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result).not.toBeNull();
      expect(result.op).toBe('mint');
      expect(result.amt).toBe('1000');
    });

    test('mint missing amt returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', tick: 'ORDI' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });
  });

  describe('Transfer operation', () => {
    test('valid transfer returns parsed object', () => {
      const body = makeBody({ p: 'brc-20', op: 'transfer', tick: 'ORDI', amt: '500' });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result).not.toBeNull();
      expect(result.op).toBe('transfer');
      expect(result.amt).toBe('500');
    });

    test('transfer missing amt returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'transfer', tick: 'ORDI' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });
  });

  describe('Ticker validation', () => {
    test('tick is normalized to lowercase', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', tick: 'ORDI', amt: '100' });
      const result = parseBrc20Inscription(body, 'text/plain');
      expect(result.tick).toBe('ordi');
    });

    test('tick > 4 characters returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', tick: 'TOOLONG', amt: '100' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('empty tick returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', tick: '', amt: '100' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('missing tick returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'mint', amt: '100' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });
  });

  describe('Unknown operations', () => {
    test('unknown operation returns null', () => {
      const body = makeBody({ p: 'brc-20', op: 'burn', tick: 'TEST', amt: '100' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });

    test('missing operation returns null', () => {
      const body = makeBody({ p: 'brc-20', tick: 'TEST', amt: '100' });
      expect(parseBrc20Inscription(body, 'text/plain')).toBeNull();
    });
  });
});

describe('extractInscriptionsFromTx', () => {
  test('returns empty array for tx with no vin', () => {
    expect(extractInscriptionsFromTx({ txid: 'abc', vout: [] })).toEqual([]);
  });

  test('returns empty array for tx with no witness data', () => {
    const tx = {
      txid: 'abc',
      vin: [{ txid: 'prev', vout: 0 }],
      vout: [],
    };
    expect(extractInscriptionsFromTx(tx)).toEqual([]);
  });

  test('returns empty array when witness has only 1 item', () => {
    const tx = {
      txid: 'abc',
      vin: [{ txinwitness: ['deadbeef'] }],
      vout: [],
    };
    expect(extractInscriptionsFromTx(tx)).toEqual([]);
  });

  test('returns empty array for non-inscription witness script', () => {
    const tx = {
      txid: 'abc',
      vin: [{ txinwitness: ['01', 'cafecafe'] }], // not a valid inscription
      vout: [],
    };
    expect(extractInscriptionsFromTx(tx)).toEqual([]);
  });
});
