import { get, noop } from 'lodash';
import { set, unset } from 'lodash/fp';
import { createTransform } from 'redux-persist';

/**
 * Creates a new transform instance.
 *
 * @export
 * @param {Object} config
 * @param {String} config.serviceName     A unique identifier to reference passwords in the keychain
 * @param {String|Array<String>|Function} config.passwordPaths  Lodash getter path(s) to passwords
 * in your state, or a function that, given your state, returns path(s)
 * @param {Boolean} config.clearPasswords False to retain passwords in the persisted state
 * @param {Boolean} config.serialize      True to serialize password objects to JSON
 * @param {Function} config.logger        A logging method
 * @returns {Transform}                   The redux-persist Transform
 */
export default function createPasswordTransform(config = {}) {
  const serviceName = config.serviceName;
  const passwordPaths = config.passwordPaths;
  const clearPasswords = config.clearPasswords !== false;
  const serialize = !!config.serialize;
  const logger = config.logger || noop;

  if (!serviceName) throw new Error('serviceName is required');
  if (!passwordPaths) throw new Error('passwordPaths is required');

  /**
   * Late-require keytar so that we can handle failures.
   */
  const { getPassword, setPassword } = require('keytar');

  /**
   * Coerces the `passwordPaths` parameter into an array of paths.
   *
   * @param {Object} state  The state being transformed
   * @returns               An array of paths in state that contain passwords
   */
  function getPasswordPaths(state) {
    let paths = typeof passwordPaths === 'function'
      ? passwordPaths(state)
      : passwordPaths;

    if (!paths) throw new Error('Empty password paths');

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

    for (const path of pathsToGet) {
      const secret = get(state, path);
      if (!secret) {
        logger('Nothing found at path', path);
        continue;
      }

      try {
        logger(`Writing secret under ${path}`, secret);
        await setPassword(serviceName, path, coerceString(secret, serialize));

        // Clear out the passwords unless directed not to. Use an immutable
        // version of unset to avoid modifying the original state object.
        if (clearPasswords) {
          inboundState = unset(path, inboundState);
        }
      } catch (err) {
        logger(`Unable to write ${path} to keytar`, err);
      }
    }

    return inboundState;
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

    for (const path of pathsToSet) {
      try {
        const secret = await getPassword(serviceName, path);
        logger(`Read secret from ${path}`, secret);

        // If we found a stored password, set it on the outbound state.
        // Use an immutable version of set to avoid modifying the original
        // state object.
        if (!!secret) {
          const toSet = serialize ? JSON.parse(secret) : secret;
          outboundState = set(path, toSet, outboundState);
        }
      } catch (err) {
        logger(`Unable to read ${path} from keytar`, err);
      }
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
