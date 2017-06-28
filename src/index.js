import { get, noop } from 'lodash';
import { set, unset } from 'lodash/fp';
import { createTransform } from 'redux-persist';

/**
 * Utility function for consumers to check if they can access the keychain.
 *
 * @export
 * @param {String} serviceName  The top-level identifier for your app to store items in the keychain.
 * @param {String} accountName  A sub-identifier for individual entries.
 * @returns {Promise<Boolean>}  True if the keychain can be accessed, false if it threw an error.
 */
export async function accessKeychain(serviceName, accountName) {
  try {
    const getPassword = require('keytar').getPassword;
    await getPassword(serviceName, accountName);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Creates a new transform instance.
 *
 * @export
 * @param {Object} config
 * @param {String} config.serviceName       The top-level identifier for your app to store items in the keychain.
 * @param {String} [config.accountName]     A sub-identifier for individual entries. If not provided, strings taken
 *                                          from `passwordPaths` will be used.
 * @param {String|Array<String>|Function} [config.passwordPaths]  Lodash getter path(s) to passwords in your state, or
 *                                                                a function that, given your state, returns path(s).
 *                                                                Leave empty to write the entire reducer.
 * @param {Boolean} [config.clearPasswords] False to retain passwords in the persisted state.
 * @param {Boolean} [config.serialize]      True to serialize password objects to JSON.
 * @param {Function} [config.logger]        A logging method.
 * @returns {Transform}                     The redux-persist Transform.
 */
export default function createPasswordTransform(config = {}) {
  const serviceName = config.serviceName;
  const accountName = config.accountName;
  const passwordPaths = config.passwordPaths;
  const clearPasswords = config.clearPasswords !== false;
  const serialize = config.serialize || !config.passwordPaths;
  const logger = config.logger || noop;

  if (!serviceName) throw new Error('serviceName is required');
  if (!passwordPaths && !accountName) throw new Error('Either passwordPaths or accountName is required');

  /**
   * Late-require keytar so that we can handle failures.
   */
  const { getPassword, setPassword } = require('keytar');

  /**
   * Coerces the `passwordPaths` parameter into an array of paths.
   *
   * @param {Object} state  The state being transformed
   * @returns               An array of paths in state that contain passwords,
   *                        or null if using the entire subkey
   */
  function getPasswordPaths(state) {
    if (!passwordPaths) return null;

    let paths = typeof passwordPaths === 'function'
      ? passwordPaths(state)
      : passwordPaths;

    return typeof paths === 'string'
      ? [paths]
      : paths;
  }

  /**
   * Transform that occurs before state is persisted. Retrieve the password
   * path(s) from state, set them on the keychain and clear them from state.
   *
   * @param {Object} state  The inbound state
   * @returns               The transformed state that gets persisted
   */
  async function inbound(state) {
    let inboundState = { ...state };
    const pathsToGet = getPasswordPaths(state);

    if (pathsToGet) {
      for (const path of pathsToGet) {
        inboundState = await setPasswordForPath(inboundState, path);
      }
      return inboundState;
    } else {
      logger('TransformPasswords: Writing entire reducer');

      await setPassword(
        serviceName,
        accountName,
        coerceString(inboundState, serialize)
      );

      return {};
    }
  }

  /**
   * Transform that occurs when the store is being hydrated with state.
   * Retrieve the password path(s), get the actual passwords from the keychain
   * and apply them to the outbound state.
   *
   * @param {Object} state  The outbound state
   * @returns               The transformed state that will hydrate the store
   */
  async function outbound(state) {
    let outboundState = { ...state };
    const pathsToSet = getPasswordPaths(state);

    if (pathsToSet) {
      for (const path of pathsToSet) {
        outboundState = await(getPasswordForPath(outboundState, path));
      }

      return outboundState;
    } else {
      logger('TransformPasswords: Reading entire reducer');

      const secret = await getPassword(serviceName, accountName);
      return JSON.parse(secret);
    }
  }

  async function setPasswordForPath(inboundState, path) {
    const secret = get(inboundState, path);
    if (!secret) {
      logger('TransformPasswords: Nothing found at path', path);
      return;
    }

    try {
      logger(`TransformPasswords: Writing secret under ${path}`, secret);

      await setPassword(
        serviceName,
        accountName || path,
        coerceString(secret, serialize)
      );

      // Clear out the passwords unless directed not to. Use an immutable
      // version of unset to avoid modifying the original state object.
      if (clearPasswords) {
        inboundState = unset(path, inboundState);
      }
    } catch (err) {
      logger(`TransformPasswords: Unable to write ${path} to keytar`, err);
    }

    return inboundState;
  }

  async function getPasswordForPath(outboundState, path) {
    try {
      const secret = await getPassword(serviceName, accountName || path);
      logger(`TransformPasswords: Read secret from ${path}`, secret);

      // If we found a stored password, set it on the outbound state.
      // Use an immutable version of set to avoid modifying the original
      // state object.
      if (secret) {
        const toSet = serialize ? JSON.parse(secret) : secret;
        outboundState = set(path, toSet, outboundState);
      }
    } catch (err) {
      logger(`TransformPasswords: Unable to read ${path} from keytar`, err);
    }

    return outboundState;
  }

  return createTransform(
    inbound,
    outbound,
    config
  );
}

/**
 * Keytar only supports setting strings, so coerce our value to a string or
 * serialize it.
 *
 * @param {any} value         The value being stored
 * @param {Boolean} serialize Whether or not we should JSON.stringify
 * @returns                   The value as a string
 */
function coerceString(value, serialize) {
  return serialize
    ? JSON.stringify(value)
    : (typeof value !== 'string')
      ? value.toString()
      : value;
}
