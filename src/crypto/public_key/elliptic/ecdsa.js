// OpenPGP.js - An OpenPGP implementation in javascript
// Copyright (C) 2015-2016 Decentral
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

/**
 * @fileoverview Implementation of ECDSA following RFC6637 for Openpgpjs
 * @module crypto/public_key/elliptic/ecdsa
 * @private
 */

import enums from '../../../enums';
import util from '../../../util';
import { getRandomBytes } from '../../random';
import hash from '../../hash';
import { Curve, webCurves, privateToJWK, rawPublicToJWK, validateStandardParams } from './curves';
import { getIndutnyCurve, keyFromPrivate, keyFromPublic } from './indutnyKey';

const webCrypto = util.getWebCrypto();
const nodeCrypto = util.getNodeCrypto();

/**
 * Sign a message using the provided key
 * @param {module:type/oid} oid - Elliptic curve object identifier
 * @param {module:enums.hash} hashAlgo - Hash algorithm used to sign
 * @param {Uint8Array} message - Message to sign
 * @param {Uint8Array} publicKey - Public key
 * @param {Uint8Array} privateKey - Private key used to sign the message
 * @param {Uint8Array} hashed - The hashed message
 * @returns {Promise<{
 *   r: Uint8Array,
 *   s: Uint8Array
 * }>} Signature of the message
 * @async
 */
export async function sign(oid, hashAlgo, message, publicKey, privateKey, hashed) {
  const curve = new Curve(oid);
  if (message && !util.isStream(message)) {
    const keyPair = { publicKey, privateKey };
    switch (curve.type) {
      case 'web': {
        // If browser doesn't support a curve, we'll catch it
        try {
          // Need to await to make sure browser succeeds
          return await webSign(curve, hashAlgo, message, keyPair);
        } catch (err) {
          // We do not fallback if the error is related to key integrity
          // Unfortunaley Safari does not support p521 and throws a DataError when using it
          // So we need to always fallback for that curve
          if (curve.name !== 'p521' && (err.name === 'DataError' || err.name === 'OperationError')) {
            throw err;
          }
          util.printDebugError("Browser did not support signing: " + err.message);
        }
        break;
      }
      case 'node': {
        const signature = await nodeSign(curve, hashAlgo, message, keyPair);
        return {
          r: signature.r.toArrayLike(Uint8Array),
          s: signature.s.toArrayLike(Uint8Array)
        };
      }
    }
  }
  return ellipticSign(curve, hashed, privateKey);
}

/**
 * Verifies if a signature is valid for a message
 * @param {module:type/oid} oid - Elliptic curve object identifier
 * @param {module:enums.hash} hashAlgo - Hash algorithm used in the signature
 * @param  {{r: Uint8Array,
             s: Uint8Array}}   signature Signature to verify
 * @param {Uint8Array} message - Message to verify
 * @param {Uint8Array} publicKey - Public key used to verify the message
 * @param {Uint8Array} hashed - The hashed message
 * @returns {Boolean}
 * @async
 */
export async function verify(oid, hashAlgo, signature, message, publicKey, hashed) {
  const curve = new Curve(oid);
  if (message && !util.isStream(message)) {
    switch (curve.type) {
      case 'web':
        try {
          // Need to await to make sure browser succeeds
          return await webVerify(curve, hashAlgo, signature, message, publicKey);
        } catch (err) {
          // We do not fallback if the error is related to key integrity
          // Unfortunately Safari does not support p521 and throws a DataError when using it
          // So we need to always fallback for that curve
          if (curve.name !== 'p521' && (err.name === 'DataError' || err.name === 'OperationError')) {
            throw err;
          }
          util.printDebugError("Browser did not support verifying: " + err.message);
        }
        break;
      case 'node':
        return nodeVerify(curve, hashAlgo, signature, message, publicKey);
    }
  }
  const digest = (typeof hashAlgo === 'undefined') ? message : hashed;
  return ellipticVerify(curve, signature, digest, publicKey);
}

/**
 * Validate EcDSA parameters
 * @param {module:type/oid} oid - Elliptic curve object identifier
 * @param {Uint8Array} Q - EcDSA public point
 * @param {Uint8Array} d - EcDSA secret scalar
 * @returns {Promise<Boolean>} Whether params are valid.
 * @async
 */
export async function validateParams(oid, Q, d) {
  const curve = new Curve(oid);
  // Reject curves x25519 and ed25519
  if (curve.keyType !== enums.publicKey.ecdsa) {
    return false;
  }

  // To speed up the validation, we try to use node- or webcrypto when available
  // and sign + verify a random message
  switch (curve.type) {
    case 'web':
    case 'node': {
      const message = await getRandomBytes(8);
      const hashAlgo = enums.hash.sha256;
      const hashed = await hash.digest(hashAlgo, message);
      try {
        const signature = await sign(oid, hashAlgo, message, Q, d, hashed);
        return await verify(oid, hashAlgo, signature, message, Q, hashed);
      } catch (err) {
        return false;
      }
    }
    default:
      return validateStandardParams(enums.publicKey.ecdsa, oid, Q, d);
  }
}


//////////////////////////
//                      //
//   Helper functions   //
//                      //
//////////////////////////

async function ellipticSign(curve, hashed, privateKey) {
  const indutnyCurve = await getIndutnyCurve(curve.name);
  const key = keyFromPrivate(indutnyCurve, privateKey);
  const signature = key.sign(hashed);
  return {
    r: signature.r.toArrayLike(Uint8Array),
    s: signature.s.toArrayLike(Uint8Array)
  };
}

async function ellipticVerify(curve, signature, digest, publicKey) {
  const indutnyCurve = await getIndutnyCurve(curve.name);
  const key = keyFromPublic(indutnyCurve, publicKey);
  return key.verify(digest, signature);
}

async function webSign(curve, hashAlgo, message, keyPair) {
  const len = curve.payloadSize;
  const jwk = privateToJWK(curve.payloadSize, webCurves[curve.name], keyPair.publicKey, keyPair.privateKey);
  const key = await webCrypto.importKey(
    "jwk",
    jwk,
    {
      "name": "ECDSA",
      "namedCurve": webCurves[curve.name],
      "hash": { name: enums.read(enums.webHash, curve.hash) }
    },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(await webCrypto.sign(
    {
      "name": 'ECDSA',
      "namedCurve": webCurves[curve.name],
      "hash": { name: enums.read(enums.webHash, hashAlgo) }
    },
    key,
    message
  ));

  return {
    r: signature.slice(0, len),
    s: signature.slice(len, len << 1)
  };
}

async function webVerify(curve, hashAlgo, { r, s }, message, publicKey) {
  const jwk = rawPublicToJWK(curve.payloadSize, webCurves[curve.name], publicKey);
  const key = await webCrypto.importKey(
    "jwk",
    jwk,
    {
      "name": "ECDSA",
      "namedCurve": webCurves[curve.name],
      "hash": { name: enums.read(enums.webHash, curve.hash) }
    },
    false,
    ["verify"]
  );

  const signature = util.concatUint8Array([r, s]).buffer;

  return webCrypto.verify(
    {
      "name": 'ECDSA',
      "namedCurve": webCurves[curve.name],
      "hash": { name: enums.read(enums.webHash, hashAlgo) }
    },
    key,
    signature,
    message
  );
}

async function nodeSign(curve, hashAlgo, message, keyPair) {
  const sign = nodeCrypto.createSign(enums.read(enums.hash, hashAlgo));
  sign.write(message);
  sign.end();
  const key = ECPrivateKey.encode({
    version: 1,
    parameters: curve.oid,
    privateKey: Array.from(keyPair.privateKey),
    publicKey: { unused: 0, data: Array.from(keyPair.publicKey) }
  }, 'pem', {
    label: 'EC PRIVATE KEY'
  });

  return ECDSASignature.decode(sign.sign(key), 'der');
}

async function nodeVerify(curve, hashAlgo, { r, s }, message, publicKey) {
  const { default: BN } = await import('bn.js');

  const verify = nodeCrypto.createVerify(enums.read(enums.hash, hashAlgo));
  verify.write(message);
  verify.end();
  const key = SubjectPublicKeyInfo.encode({
    algorithm: {
      algorithm: [1, 2, 840, 10045, 2, 1],
      parameters: curve.oid
    },
    subjectPublicKey: { unused: 0, data: Array.from(publicKey) }
  }, 'pem', {
    label: 'PUBLIC KEY'
  });
  const signature = ECDSASignature.encode({
    r: new BN(r), s: new BN(s)
  }, 'der');

  try {
    return verify.verify(key, signature);
  } catch (err) {
    return false;
  }
}

// Originally written by Owen Smith https://github.com/omsmith
// Adapted on Feb 2018 from https://github.com/Brightspace/node-jwk-to-pem/

/* eslint-disable no-invalid-this */

const asn1 = nodeCrypto ? require('asn1.js') : undefined;

const ECDSASignature = nodeCrypto ?
  asn1.define('ECDSASignature', function() {
    this.seq().obj(
      this.key('r').int(),
      this.key('s').int()
    );
  }) : undefined;

const ECPrivateKey = nodeCrypto ?
  asn1.define('ECPrivateKey', function() {
    this.seq().obj(
      this.key('version').int(),
      this.key('privateKey').octstr(),
      this.key('parameters').explicit(0).optional().any(),
      this.key('publicKey').explicit(1).optional().bitstr()
    );
  }) : undefined;

const AlgorithmIdentifier = nodeCrypto ?
  asn1.define('AlgorithmIdentifier', function() {
    this.seq().obj(
      this.key('algorithm').objid(),
      this.key('parameters').optional().any()
    );
  }) : undefined;

const SubjectPublicKeyInfo = nodeCrypto ?
  asn1.define('SubjectPublicKeyInfo', function() {
    this.seq().obj(
      this.key('algorithm').use(AlgorithmIdentifier),
      this.key('subjectPublicKey').bitstr()
    );
  }) : undefined;
