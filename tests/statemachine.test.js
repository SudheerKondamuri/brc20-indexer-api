'use strict';

const {
  validateDeployFields,
  validateMintFields,
  validateTransferFields,
  validateMintAgainstToken,
  validateTransferAgainstBalance,
} = require('../src/brc20/statemachine');

describe('BRC-20 Deploy Validation', () => {
  describe('validateDeployFields', () => {
    test('valid deploy operation', () => {
      const op = { tick: 'ordi', max: '21000000', lim: '1000', dec: 18 };
      expect(validateDeployFields(op).valid).toBe(true);
    });

    test('valid deploy with decimal 0', () => {
      const op = { tick: 'test', max: '1000000', lim: '100', dec: 0 };
      expect(validateDeployFields(op).valid).toBe(true);
    });

    test('invalid: max_supply <= 0', () => {
      const op = { tick: 'test', max: '0', lim: '100', dec: 18 };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/max_supply/i);
    });

    test('invalid: negative max_supply', () => {
      const op = { tick: 'test', max: '-1000', lim: '100', dec: 18 };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: limit_per_mint > max_supply', () => {
      const op = { tick: 'test', max: '1000', lim: '5000', dec: 18 };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/limit_per_mint/i);
    });

    test('invalid: decimal_places > 18', () => {
      const op = { tick: 'test', max: '1000', lim: '100', dec: 19 };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/decimal_places/i);
    });

    test('invalid: non-numeric max', () => {
      const op = { tick: 'test', max: 'abc', lim: '100', dec: 18 };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: missing decimal_places', () => {
      const op = { tick: 'test', max: '1000', lim: '100', dec: undefined };
      const result = validateDeployFields(op);
      expect(result.valid).toBe(false);
    });
  });
});

describe('BRC-20 Mint Validation', () => {
  describe('validateMintFields', () => {
    test('valid mint operation', () => {
      const op = { tick: 'ordi', amt: '1000' };
      expect(validateMintFields(op).valid).toBe(true);
    });

    test('invalid: zero amount', () => {
      const op = { tick: 'ordi', amt: '0' };
      const result = validateMintFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: negative amount', () => {
      const op = { tick: 'ordi', amt: '-500' };
      const result = validateMintFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: non-numeric amount', () => {
      const op = { tick: 'ordi', amt: 'abc' };
      const result = validateMintFields(op);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateMintAgainstToken', () => {
    const tokenBase = {
      max_supply: '21000000',
      minted_supply: '0',
      limit_per_mint: '1000',
    };

    test('valid mint within limits', () => {
      const op = { amt: '500' };
      expect(validateMintAgainstToken(op, tokenBase).valid).toBe(true);
    });

    test('valid mint at exact limit', () => {
      const op = { amt: '1000' };
      expect(validateMintAgainstToken(op, tokenBase).valid).toBe(true);
    });

    test('invalid: amount exceeds limit_per_mint', () => {
      const op = { amt: '1001' };
      const result = validateMintAgainstToken(op, tokenBase);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/limit_per_mint/i);
    });

    test('invalid: max_supply already reached', () => {
      const token = { ...tokenBase, minted_supply: '21000000' };
      const op = { amt: '1' };
      const result = validateMintAgainstToken(op, token);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/max_supply/i);
    });

    test('invalid: mint would exceed max_supply', () => {
      const token = { ...tokenBase, minted_supply: '20999500' };
      const op = { amt: '1000' };
      const result = validateMintAgainstToken(op, token);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/max_supply/i);
    });

    test('valid: mint exactly remaining supply', () => {
      const token = { ...tokenBase, minted_supply: '20999000' };
      const op = { amt: '1000' };
      expect(validateMintAgainstToken(op, token).valid).toBe(true);
    });

    test('no limit_per_mint restriction when null', () => {
      const token = { ...tokenBase, limit_per_mint: null };
      const op = { amt: '10000000' };
      expect(validateMintAgainstToken(op, token).valid).toBe(true);
    });
  });
});

describe('BRC-20 Transfer Validation', () => {
  describe('validateTransferFields', () => {
    test('valid transfer amount', () => {
      const op = { tick: 'ordi', amt: '500' };
      expect(validateTransferFields(op).valid).toBe(true);
    });

    test('invalid: zero amount', () => {
      const op = { tick: 'ordi', amt: '0' };
      const result = validateTransferFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: negative amount', () => {
      const op = { tick: 'ordi', amt: '-100' };
      const result = validateTransferFields(op);
      expect(result.valid).toBe(false);
    });

    test('invalid: non-numeric', () => {
      const op = { tick: 'ordi', amt: 'xyz' };
      const result = validateTransferFields(op);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateTransferAgainstBalance', () => {
    test('valid: transfer within available balance', () => {
      expect(validateTransferAgainstBalance({ amt: '500' }, '1000').valid).toBe(true);
    });

    test('valid: transfer equal to available balance', () => {
      expect(validateTransferAgainstBalance({ amt: '1000' }, '1000').valid).toBe(true);
    });

    test('invalid: transfer exceeds available balance', () => {
      const result = validateTransferAgainstBalance({ amt: '1001' }, '1000');
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/available balance/i);
    });

    test('invalid: transfer with zero available balance', () => {
      const result = validateTransferAgainstBalance({ amt: '100' }, '0');
      expect(result.valid).toBe(false);
    });

    test('invalid: transfer with undefined balance defaults to 0', () => {
      const result = validateTransferAgainstBalance({ amt: '1' }, undefined);
      expect(result.valid).toBe(false);
    });
  });
});
