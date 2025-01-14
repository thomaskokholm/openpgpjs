// GPG4Browsers - An OpenPGP implementation in javascript
// Copyright (C) 2011 Recurity Labs GmbH
//
// This library is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 3.0 of the License, or (at your option) any later version.
//
// This library is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public
// License along with this library; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA

/* eslint class-methods-use-this: ["error", { "exceptMethods": ["isDecrypted"] }] */

import { Sha1 } from '@openpgp/asmcrypto.js/dist_es8/hash/sha1/sha1';
import { Sha256 } from '@openpgp/asmcrypto.js/dist_es8/hash/sha256/sha256';
import KeyID from '../type/keyid';
import defaultConfig from '../config';
import crypto from '../crypto';
import enums from '../enums';
import util from '../util';

/**
 * Implementation of the Key Material Packet (Tag 5,6,7,14)
 *
 * {@link https://tools.ietf.org/html/rfc4880#section-5.5|RFC4480 5.5}:
 * A key material packet contains all the information about a public or
 * private key.  There are four variants of this packet type, and two
 * major versions.
 *
 * A Public-Key packet starts a series of packets that forms an OpenPGP
 * key (sometimes called an OpenPGP certificate).
 */
class PublicKeyPacket {
  static get tag() {
    return enums.packet.publicKey;
  }

  /**
   * @param {Date} [date] - Creation date
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  constructor(date = new Date(), config = defaultConfig) {
    /**
     * Packet version
     * @type {Integer}
     */
    this.version = config.v5Keys ? 5 : 4;
    /**
     * Key creation date.
     * @type {Date}
     */
    this.created = util.normalizeDate(date);
    /**
     * Public key algorithm.
     * @type {String}
     */
    this.algorithm = null;
    /**
     * Algorithm specific public params
     * @type {Object}
     */
    this.publicParams = null;
    /**
     * Time until expiration in days (V3 only)
     * @type {Integer}
     */
    this.expirationTimeV3 = 0;
    /**
     * Fingerprint in lowercase hex
     * @type {String}
     */
    this.fingerprint = null;
    /**
     * KeyID
     * @type {module:type/keyid~KeyID}
     */
    this.keyID = null;
  }

  /**
   * Internal Parser for public keys as specified in {@link https://tools.ietf.org/html/rfc4880#section-5.5.2|RFC 4880 section 5.5.2 Public-Key Packet Formats}
   * called by read_tag&lt;num&gt;
   * @param {Uint8Array} bytes - Input array to read the packet from
   * @returns {Object} This object with attributes set by the parser.
   */
  read(bytes) {
    let pos = 0;
    // A one-octet version number (3, 4 or 5).
    this.version = bytes[pos++];

    if (this.version === 4 || this.version === 5) {
      // - A four-octet number denoting the time that the key was created.
      this.created = util.readDate(bytes.subarray(pos, pos + 4));
      pos += 4;

      // - A one-octet number denoting the public-key algorithm of this key.
      this.algorithm = enums.read(enums.publicKey, bytes[pos++]);
      const algo = enums.write(enums.publicKey, this.algorithm);

      if (this.version === 5) {
        // - A four-octet scalar octet count for the following key material.
        pos += 4;
      }

      // - A series of values comprising the key material.
      try {
        const { read, publicParams } = crypto.parsePublicKeyParams(algo, bytes.subarray(pos));
        this.publicParams = publicParams;
        pos += read;
      } catch (err) {
        throw new Error('Error reading MPIs');
      }

      return pos;
    }
    throw new Error('Version ' + this.version + ' of the key packet is unsupported.');
  }

  /**
   * Creates an OpenPGP public key packet for the given key.
   * @returns {Uint8Array} Bytes encoding the public key OpenPGP packet.
   */
  write() {
    const arr = [];
    // Version
    arr.push(new Uint8Array([this.version]));
    arr.push(util.writeDate(this.created));
    // A one-octet number denoting the public-key algorithm of this key
    const algo = enums.write(enums.publicKey, this.algorithm);
    arr.push(new Uint8Array([algo]));

    const params = crypto.serializeParams(algo, this.publicParams);
    if (this.version === 5) {
      // A four-octet scalar octet count for the following key material
      arr.push(util.writeNumber(params.length, 4));
    }
    // Algorithm-specific params
    arr.push(params);
    return util.concatUint8Array(arr);
  }

  /**
   * Write packet in order to be hashed; either for a signature or a fingerprint.
   */
  writeForHash(version) {
    const bytes = this.writePublicKey();

    if (version === 5) {
      return util.concatUint8Array([new Uint8Array([0x9A]), util.writeNumber(bytes.length, 4), bytes]);
    }
    return util.concatUint8Array([new Uint8Array([0x99]), util.writeNumber(bytes.length, 2), bytes]);
  }

  /**
   * Check whether secret-key data is available in decrypted form. Returns null for public keys.
   * @returns {Boolean|null}
   */
  isDecrypted() {
    return null;
  }

  /**
   * Returns the creation time of the key
   * @returns {Date}
   */
  getCreationTime() {
    return this.created;
  }

  /**
   * Calculates the key id of the key
   * @returns {module:type/keyid~KeyID} A 8 byte key id.
   */
  getKeyID() {
    if (this.keyID) {
      return this.keyID;
    }
    this.keyID = new KeyID();
    if (this.version === 5) {
      this.keyID.read(util.hexToUint8Array(this.getFingerprint()).subarray(0, 8));
    } else if (this.version === 4) {
      this.keyID.read(util.hexToUint8Array(this.getFingerprint()).subarray(12, 20));
    }
    return this.keyID;
  }

  /**
   * Calculates the fingerprint of the key
   * @returns {Uint8Array} A Uint8Array containing the fingerprint.
   */
  getFingerprintBytes() {
    if (this.fingerprint) {
      return this.fingerprint;
    }
    const toHash = this.writeForHash(this.version);
    if (this.version === 5) {
      this.fingerprint = Sha256.bytes(toHash);
    } else if (this.version === 4) {
      this.fingerprint = Sha1.bytes(toHash);
    }
    return this.fingerprint;
  }

  /**
   * Calculates the fingerprint of the key
   * @returns {String} A string containing the fingerprint in lowercase hex.
   */
  getFingerprint() {
    return util.uint8ArrayToHex(this.getFingerprintBytes());
  }

  /**
   * Calculates whether two keys have the same fingerprint without actually calculating the fingerprint
   * @returns {Boolean} Whether the two keys have the same version and public key data.
   */
  hasSameFingerprintAs(other) {
    return this.version === other.version && util.equalsUint8Array(this.writePublicKey(), other.writePublicKey());
  }

  /**
   * Returns algorithm information
   * @returns {Object} An object of the form {algorithm: String, bits:int, curve:String}.
   */
  getAlgorithmInfo() {
    const result = {};
    result.algorithm = this.algorithm;
    // RSA, DSA or ElGamal public modulo
    const modulo = this.publicParams.n || this.publicParams.p;
    if (modulo) {
      result.bits = util.uint8ArrayBitLength(modulo);
    } else {
      result.curve = this.publicParams.oid.getName();
    }
    return result;
  }
}

/**
 * Alias of read()
 * @see PublicKeyPacket#read
 */
PublicKeyPacket.prototype.readPublicKey = PublicKeyPacket.prototype.read;

/**
 * Alias of write()
 * @see PublicKeyPacket#write
 */
PublicKeyPacket.prototype.writePublicKey = PublicKeyPacket.prototype.write;

export default PublicKeyPacket;
