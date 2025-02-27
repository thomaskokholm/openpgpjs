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
import enums from '../enums';

/**
 * A Public-Subkey packet (tag 14) has exactly the same format as a
 * Public-Key packet, but denotes a subkey.  One or more subkeys may be
 * associated with a top-level key.  By convention, the top-level key
 * provides signature services, and the subkeys provide encryption
 * services.
 * @extends PublicKeyPacket
 */
class PublicSubkeyPacket extends PublicKeyPacket {
  static get tag() {
    return enums.packet.publicSubkey;
  }

  /**
   * @param {Date} [date] - Creation date
   * @param {Object} [config] - Full configuration, defaults to openpgp.config
   */
  // eslint-disable-next-line no-useless-constructor
  constructor(date, config) {
    super(date, config);
  }
}

export default PublicSubkeyPacket;
