'use strict';

/**
 * inscription.js
 *
 * Parses Ordinal inscriptions from Bitcoin transaction witness data.
 *
 * An inscription envelope in Bitcoin Script looks like:
 *   OP_FALSE OP_IF
 *     <"ord"> (protocol tag)
 *     OP_1 <content-type>   (tag 1 = content-type)
 *     [OP_2 <metadata>]     (tag 2 = metadata, optional)
 *     OP_0                  (tag 0 = body follows)
 *     <data chunks...>
 *   OP_ENDIF
 *
 * In the witness script, these appear as hex-encoded bytes within the
 * script of the second witness item (index 1) of the first input.
 */

const OP_FALSE = 0x00;
const OP_IF = 0x63;
const OP_ENDIF = 0x68;
const OP_0 = 0x00;
const OP_1 = 0x51;
const OP_2 = 0x52;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

const ORD_PROTOCOL = Buffer.from('ord');

/**
 * Decode a minimal-push integer opcode (OP_1..OP_16 → 1..16)
 */
function decodeSmallInt(opcode) {
  if (opcode >= 0x51 && opcode <= 0x60) return opcode - 0x50;
  return null;
}

/**
 * Read the next push item from `buf` at offset `pos`.
 * Returns { data: Buffer, nextPos: number } or null if invalid.
 */
function readPushData(buf, pos) {
  if (pos >= buf.length) return null;
  const opcode = buf[pos];

  // OP_0 / OP_FALSE → empty buffer
  if (opcode === OP_0) {
    return { data: Buffer.alloc(0), nextPos: pos + 1 };
  }

  // Direct push: 1..75 bytes
  if (opcode >= 0x01 && opcode <= 0x4b) {
    const len = opcode;
    if (pos + 1 + len > buf.length) return null;
    return { data: buf.slice(pos + 1, pos + 1 + len), nextPos: pos + 1 + len };
  }

  // OP_PUSHDATA1
  if (opcode === OP_PUSHDATA1) {
    if (pos + 2 > buf.length) return null;
    const len = buf[pos + 1];
    if (pos + 2 + len > buf.length) return null;
    return { data: buf.slice(pos + 2, pos + 2 + len), nextPos: pos + 2 + len };
  }

  // OP_PUSHDATA2
  if (opcode === OP_PUSHDATA2) {
    if (pos + 3 > buf.length) return null;
    const len = buf.readUInt16LE(pos + 1);
    if (pos + 3 + len > buf.length) return null;
    return { data: buf.slice(pos + 3, pos + 3 + len), nextPos: pos + 3 + len };
  }

  // OP_PUSHDATA4
  if (opcode === OP_PUSHDATA4) {
    if (pos + 5 > buf.length) return null;
    const len = buf.readUInt32LE(pos + 1);
    if (pos + 5 + len > buf.length) return null;
    return { data: buf.slice(pos + 5, pos + 5 + len), nextPos: pos + 5 + len };
  }

  // OP_1..OP_16 encoded as small integers — treat as single-byte push
  const small = decodeSmallInt(opcode);
  if (small !== null) {
    return { data: Buffer.from([small]), nextPos: pos + 1 };
  }

  return null;
}

/**
 * Attempt to parse an inscription from a single script buffer.
 * Returns { contentType, body } or null.
 */
function parseInscriptionFromScript(scriptBuf) {
  let pos = 0;

  // Scan for OP_FALSE OP_IF envelope
  while (pos < scriptBuf.length - 2) {
    if (scriptBuf[pos] === OP_FALSE && scriptBuf[pos + 1] === OP_IF) {
      pos += 2; // skip OP_FALSE OP_IF

      // Read the protocol tag (should be "ord")
      const proto = readPushData(scriptBuf, pos);
      if (!proto || !proto.data.equals(ORD_PROTOCOL)) {
        pos += 1;
        continue;
      }
      pos = proto.nextPos;

      let contentType = null;
      let bodyChunks = [];
      let inBody = false;

      // Parse tag-value pairs until OP_ENDIF
      while (pos < scriptBuf.length) {
        const opcode = scriptBuf[pos];

        if (opcode === OP_ENDIF) {
          // End of envelope
          if (contentType !== null) {
            return {
              contentType,
              body: Buffer.concat(bodyChunks),
            };
          }
          break;
        }

        if (inBody) {
          // Read data chunks
          const chunk = readPushData(scriptBuf, pos);
          if (!chunk) break;
          if (chunk.data.length > 0) bodyChunks.push(chunk.data);
          pos = chunk.nextPos;
          continue;
        }

        // Read tag
        const tagItem = readPushData(scriptBuf, pos);
        if (!tagItem) break;
        pos = tagItem.nextPos;

        // OP_0 (empty push) means body follows
        if (tagItem.data.length === 0) {
          inBody = true;
          continue;
        }

        const tag = tagItem.data[0];

        // Tag 1 = content-type
        if (tag === 1) {
          const valueItem = readPushData(scriptBuf, pos);
          if (!valueItem) break;
          contentType = valueItem.data.toString('utf8');
          pos = valueItem.nextPos;
          continue;
        }

        // Tag 2 = metadata (skip for BRC-20 purposes)
        if (tag === 2) {
          const valueItem = readPushData(scriptBuf, pos);
          if (!valueItem) break;
          pos = valueItem.nextPos;
          continue;
        }

        // Unknown tag — try to skip its value
        const skip = readPushData(scriptBuf, pos);
        if (!skip) break;
        pos = skip.nextPos;
      }
    } else {
      pos += 1;
    }
  }

  return null;
}

/**
 * Extract all inscriptions from a transaction's inputs.
 * Returns an array of { contentType, body, inputIndex, txid }.
 *
 * @param {Object} tx - decoded transaction object from Bitcoin RPC
 * @returns {Array}
 */
function extractInscriptionsFromTx(tx) {
  const inscriptions = [];

  if (!tx.vin) return inscriptions;

  tx.vin.forEach((input, inputIndex) => {
    if (!input.txinwitness || input.txinwitness.length < 2) return;

    // Ordinal inscription is in the second witness item (index 1)
    // The last witness item is the annex if it starts with 0x50
    const witnessItems = input.txinwitness;

    for (let wi = 1; wi < witnessItems.length; wi++) {
      const scriptHex = witnessItems[wi];
      if (!scriptHex || typeof scriptHex !== 'string') continue;

      let scriptBuf;
      try {
        scriptBuf = Buffer.from(scriptHex, 'hex');
      } catch {
        continue;
      }

      const result = parseInscriptionFromScript(scriptBuf);
      if (result) {
        inscriptions.push({
          ...result,
          inputIndex,
          witnessIndex: wi,
          txid: tx.txid,
        });
      }
    }
  });

  return inscriptions;
}

/**
 * Parse inscription body as BRC-20 JSON.
 * Returns a validated BRC-20 operation object or null.
 *
 * @param {Buffer} body
 * @param {string} contentType
 * @returns {Object|null}
 */
function parseBrc20Inscription(body, contentType) {
  if (!contentType) return null;

  const ct = contentType.toLowerCase().split(';')[0].trim();
  if (ct !== 'text/plain' && ct !== 'application/json') return null;

  let text;
  try {
    text = body.toString('utf8');
  } catch {
    return null;
  }

  // Must be valid JSON
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  // Must have protocol = "brc-20"
  if (!json.p || json.p.toLowerCase() !== 'brc-20') return null;

  // Must have a valid operation
  const op = (json.op || '').toLowerCase();
  if (!['deploy', 'mint', 'transfer'].includes(op)) return null;

  // Must have a ticker (1-4 chars)
  if (!json.tick || typeof json.tick !== 'string') return null;
  const tick = json.tick.toLowerCase().trim();
  if (tick.length < 1 || tick.length > 4) return null;

  const parsed = { p: 'brc-20', op, tick };

  switch (op) {
    case 'deploy':
      if (!json.max) return null;
      parsed.max = json.max.toString();
      parsed.lim = json.lim !== undefined ? json.lim.toString() : json.max.toString();
      parsed.dec = json.dec !== undefined ? parseInt(json.dec, 10) : 18;
      if (isNaN(parsed.dec) || parsed.dec < 0 || parsed.dec > 18) return null;
      break;

    case 'mint':
      if (!json.amt) return null;
      parsed.amt = json.amt.toString();
      break;

    case 'transfer':
      if (!json.amt) return null;
      parsed.amt = json.amt.toString();
      break;

    default:
      return null;
  }

  return parsed;
}

module.exports = {
  extractInscriptionsFromTx,
  parseBrc20Inscription,
  parseInscriptionFromScript,
  readPushData,
};
