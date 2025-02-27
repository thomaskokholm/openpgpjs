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

import PublicKeyPacket from './public_key';
import S2K from '../type/s2k';
import crypto from '../crypto';
import enums from '../enums';
import util from '../util';
import defaultConfig from '../config';

/**
 * A Secret-Key packet contains all the information that is found in a
 * Public-Key packet, including the public-key material, but also
 * includes the secret-key material after all the public-key fields.
 * @extends PublicKeyPacket
 */
class SecretKeyPacket extends PublicKeyPacket {
  static get tag() {
    return enums.packet.secretKey;
  }

  /**
   * @param {Date} [date] - Creation date
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  constructor(date = new Date(), config = defaultConfig) {
    super(date, config);
    /**
     * Secret-key data
     */
    this.keyMaterial = null;
    /**
     * Indicates whether secret-key data is encrypted. `this.isEncrypted === false` means data is available in decrypted form.
     */
    this.isEncrypted = null;
    /**
     * S2K usage
     * @type {Integer}
     */
    this.s2kUsage = 0;
    /**
     * S2K object
     * @type {type/s2k}
     */
    this.s2k = null;
    /**
     * Symmetric algorithm
     * @type {String}
     */
    this.symmetric = null;
    /**
     * AEAD algorithm
     * @type {String}
     */
    this.aead = null;
    /**
     * Decrypted private parameters, referenced by name
     * @type {Object}
     */
    this.privateParams = null;
  }

  // 5.5.3.  Secret-Key Packet Formats

  /**
   * Internal parser for private keys as specified in
   * {@link https://tools.ietf.org/html/draft-ietf-openpgp-rfc4880bis-04#section-5.5.3|RFC4880bis-04 section 5.5.3}
   * @param {String} bytes - Input string to read the packet from
   */
  read(bytes) {
    // - A Public-Key or Public-Subkey packet, as described above.
    let i = this.readPublicKey(bytes);

    // - One octet indicating string-to-key usage conventions.  Zero
    //   indicates that the secret-key data is not encrypted.  255 or 254
    //   indicates that a string-to-key specifier is being given.  Any
    //   other value is a symmetric-key encryption algorithm identifier.
    this.s2kUsage = bytes[i++];

    // - Only for a version 5 packet, a one-octet scalar octet count of
    //   the next 4 optional fields.
    if (this.version === 5) {
      i++;
    }

    // - [Optional] If string-to-key usage octet was 255, 254, or 253, a
    //   one-octet symmetric encryption algorithm.
    if (this.s2kUsage === 255 || this.s2kUsage === 254 || this.s2kUsage === 253) {
      this.symmetric = bytes[i++];
      this.symmetric = enums.read(enums.symmetric, this.symmetric);

      // - [Optional] If string-to-key usage octet was 253, a one-octet
      //   AEAD algorithm.
      if (this.s2kUsage === 253) {
        this.aead = bytes[i++];
        this.aead = enums.read(enums.aead, this.aead);
      }

      // - [Optional] If string-to-key usage octet was 255, 254, or 253, a
      //   string-to-key specifier.  The length of the string-to-key
      //   specifier is implied by its type, as described above.
      this.s2k = new S2K();
      i += this.s2k.read(bytes.subarray(i, bytes.length));

      if (this.s2k.type === 'gnu-dummy') {
        return;
      }
    } else if (this.s2kUsage) {
      this.symmetric = this.s2kUsage;
      this.symmetric = enums.read(enums.symmetric, this.symmetric);
    }

    // - [Optional] If secret data is encrypted (string-to-key usage octet
    //   not zero), an Initial Vector (IV) of the same length as the
    //   cipher's block size.
    if (this.s2kUsage) {
      this.iv = bytes.subarray(
        i,
        i + crypto.cipher[this.symmetric].blockSize
      );

      i += this.iv.length;
    }

    // - Only for a version 5 packet, a four-octet scalar octet count for
    //   the following key material.
    if (this.version === 5) {
      i += 4;
    }

    // - Plain or encrypted multiprecision integers comprising the secret
    //   key data.  These algorithm-specific fields are as described
    //   below.
    this.keyMaterial = bytes.subarray(i);
    this.isEncrypted = !!this.s2kUsage;

    if (!this.isEncrypted) {
      const cleartext = this.keyMaterial.subarray(0, -2);
      if (!util.equalsUint8Array(util.writeChecksum(cleartext), this.keyMaterial.subarray(-2))) {
        throw new Error('Key checksum mismatch');
      }
      try {
        const algo = enums.write(enums.publicKey, this.algorithm);
        const { privateParams } = crypto.parsePrivateKeyParams(algo, cleartext, this.publicParams);
        this.privateParams = privateParams;
      } catch (err) {
        throw new Error('Error reading MPIs');
      }
    }
  }

  /**
   * Creates an OpenPGP key packet for the given key.
   * @returns {Uint8Array} A string of bytes containing the secret key OpenPGP packet.
   */
  write() {
    const arr = [this.writePublicKey()];

    arr.push(new Uint8Array([this.s2kUsage]));

    const optionalFieldsArr = [];
    // - [Optional] If string-to-key usage octet was 255, 254, or 253, a
    //   one- octet symmetric encryption algorithm.
    if (this.s2kUsage === 255 || this.s2kUsage === 254 || this.s2kUsage === 253) {
      optionalFieldsArr.push(enums.write(enums.symmetric, this.symmetric));

      // - [Optional] If string-to-key usage octet was 253, a one-octet
      //   AEAD algorithm.
      if (this.s2kUsage === 253) {
        optionalFieldsArr.push(enums.write(enums.aead, this.aead));
      }

      // - [Optional] If string-to-key usage octet was 255, 254, or 253, a
      //   string-to-key specifier.  The length of the string-to-key
      //   specifier is implied by its type, as described above.
      optionalFieldsArr.push(...this.s2k.write());
    }

    // - [Optional] If secret data is encrypted (string-to-key usage octet
    //   not zero), an Initial Vector (IV) of the same length as the
    //   cipher's block size.
    if (this.s2kUsage && this.s2k.type !== 'gnu-dummy') {
      optionalFieldsArr.push(...this.iv);
    }

    if (this.version === 5) {
      arr.push(new Uint8Array([optionalFieldsArr.length]));
    }
    arr.push(new Uint8Array(optionalFieldsArr));

    if (!this.isDummy()) {
      if (!this.s2kUsage) {
        const algo = enums.write(enums.publicKey, this.algorithm);
        this.keyMaterial = crypto.serializeParams(algo, this.privateParams);
      }

      if (this.version === 5) {
        arr.push(util.writeNumber(this.keyMaterial.length, 4));
      }
      arr.push(this.keyMaterial);

      if (!this.s2kUsage) {
        arr.push(util.writeChecksum(this.keyMaterial));
      }
    }

    return util.concatUint8Array(arr);
  }

  /**
   * Check whether secret-key data is available in decrypted form.
   * Returns false for gnu-dummy keys and null for public keys.
   * @returns {Boolean|null}
   */
  isDecrypted() {
    return this.isEncrypted === false;
  }

  /**
   * Check whether this is a gnu-dummy key
   * @returns {Boolean}
   */
  isDummy() {
    return !!(this.s2k && this.s2k.type === 'gnu-dummy');
  }

  /**
   * Remove private key material, converting the key to a dummy one.
   * The resulting key cannot be used for signing/decrypting but can still verify signatures.
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  makeDummy(config = defaultConfig) {
    if (this.isDummy()) {
      return;
    }
    if (this.isDecrypted()) {
      this.clearPrivateParams();
    }
    this.isEncrypted = null;
    this.keyMaterial = null;
    this.s2k = new S2K(config);
    this.s2k.algorithm = 0;
    this.s2k.c = 0;
    this.s2k.type = 'gnu-dummy';
    this.s2kUsage = 254;
    this.symmetric = 'aes256';
  }

  /**
   * Encrypt the payload. By default, we use aes256 and iterated, salted string
   * to key specifier. If the key is in a decrypted state (isEncrypted === false)
   * and the passphrase is empty or undefined, the key will be set as not encrypted.
   * This can be used to remove passphrase protection after calling decrypt().
   * @param {String} passphrase
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   * @throws {Error} if encryption was not successful
   * @async
   */
  async encrypt(passphrase, config = defaultConfig) {
    if (this.isDummy()) {
      return;
    }

    if (!this.isDecrypted()) {
      throw new Error('Key packet is already encrypted');
    }

    if (this.isDecrypted() && !passphrase) {
      this.s2kUsage = 0;
      return;
    } else if (!passphrase) {
      throw new Error('The key must be decrypted before removing passphrase protection.');
    }

    this.s2k = new S2K(config);
    this.s2k.salt = await crypto.random.getRandomBytes(8);
    const algo = enums.write(enums.publicKey, this.algorithm);
    const cleartext = crypto.serializeParams(algo, this.privateParams);
    this.symmetric = 'aes256';
    const key = await produceEncryptionKey(this.s2k, passphrase, this.symmetric);
    const blockLen = crypto.cipher[this.symmetric].blockSize;
    this.iv = await crypto.random.getRandomBytes(blockLen);

    if (config.aeadProtect) {
      this.s2kUsage = 253;
      this.aead = 'eax';
      const mode = crypto.mode[this.aead];
      const modeInstance = await mode(this.symmetric, key);
      this.keyMaterial = await modeInstance.encrypt(cleartext, this.iv.subarray(0, mode.ivLength), new Uint8Array());
    } else {
      this.s2kUsage = 254;
      this.keyMaterial = await crypto.mode.cfb.encrypt(this.symmetric, key, util.concatUint8Array([
        cleartext,
        await crypto.hash.sha1(cleartext, config)
      ]), this.iv, config);
    }
  }

  /**
   * Decrypts the private key params which are needed to use the key.
   * {@link SecretKeyPacket.isDecrypted} should be false, as
   * otherwise calls to this function will throw an error.
   * @param {String} passphrase - The passphrase for this private key as string
   * @throws {Error} if decryption was not successful
   * @async
   */
  async decrypt(passphrase) {
    if (this.isDummy()) {
      return false;
    }

    if (this.isDecrypted()) {
      throw new Error('Key packet is already decrypted.');
    }

    let key;
    if (this.s2kUsage === 254 || this.s2kUsage === 253) {
      key = await produceEncryptionKey(this.s2k, passphrase, this.symmetric);
    } else if (this.s2kUsage === 255) {
      throw new Error('Encrypted private key is authenticated using an insecure two-byte hash');
    } else {
      throw new Error('Private key is encrypted using an insecure S2K function: unsalted MD5');
    }

    let cleartext;
    if (this.s2kUsage === 253) {
      const mode = crypto.mode[this.aead];
      try {
        const modeInstance = await mode(this.symmetric, key);
        cleartext = await modeInstance.decrypt(this.keyMaterial, this.iv.subarray(0, mode.ivLength), new Uint8Array());
      } catch (err) {
        if (err.message === 'Authentication tag mismatch') {
          throw new Error('Incorrect key passphrase: ' + err.message);
        }
        throw err;
      }
    } else {
      const cleartextWithHash = await crypto.mode.cfb.decrypt(this.symmetric, key, this.keyMaterial, this.iv);

      cleartext = cleartextWithHash.subarray(0, -20);
      const hash = await crypto.hash.sha1(cleartext);

      if (!util.equalsUint8Array(hash, cleartextWithHash.subarray(-20))) {
        throw new Error('Incorrect key passphrase');
      }
    }

    try {
      const algo = enums.write(enums.publicKey, this.algorithm);
      const { privateParams } = crypto.parsePrivateKeyParams(algo, cleartext, this.publicParams);
      this.privateParams = privateParams;
    } catch (err) {
      throw new Error('Error reading MPIs');
    }
    this.isEncrypted = false;
    this.keyMaterial = null;
    this.s2kUsage = 0;
  }

  /**
   * Checks that the key parameters are consistent
   * @throws {Error} if validation was not successful
   * @async
   */
  async validate() {
    if (this.isDummy()) {
      return;
    }

    if (!this.isDecrypted()) {
      throw new Error('Key is not decrypted');
    }

    const algo = enums.write(enums.publicKey, this.algorithm);

    let validParams;
    try {
      // this can throw if some parameters are undefined
      validParams = await crypto.validateParams(algo, this.publicParams, this.privateParams);
    } catch (_) {
      validParams = false;
    }
    if (!validParams) {
      throw new Error('Key is invalid');
    }
  }

  async generate(bits, curve) {
    const algo = enums.write(enums.publicKey, this.algorithm);
    const { privateParams, publicParams } = await crypto.generateParams(algo, bits, curve);
    this.privateParams = privateParams;
    this.publicParams = publicParams;
    this.isEncrypted = false;
  }

  /**
   * Clear private key parameters
   */
  clearPrivateParams() {
    if (this.isDummy()) {
      return;
    }

    Object.keys(this.privateParams).forEach(name => {
      const param = this.privateParams[name];
      param.fill(0);
      delete this.privateParams[name];
    });
    this.privateParams = null;
    this.isEncrypted = true;
  }
}

async function produceEncryptionKey(s2k, passphrase, algorithm) {
  return s2k.produceKey(
    passphrase,
    crypto.cipher[algorithm].keySize
  );
}

export default SecretKeyPacket;
