import get from 'lodash/get';
import setWith from 'lodash/setWith';
import clone from 'lodash/clone';
import isEmpty from 'lodash/isEmpty';
import unset from 'lodash/unset';
import { createTransform } from 'redux-persist';

const deleteIn = (state, path) => {
  if (isEmpty(path)) return {};
  const valueAtPath = get(state, path);
  const stateWithClonedPath = setWith({ ...state }, path, valueAtPath, clone);
  unset(stateWithClonedPath, path);
  return stateWithClonedPath;
};

/**
 * Utility function for consumers to check if they can access the keychain.
 * Just reading from the keychain isn't sufficient on all platforms; we need to
 * test writing to it as well.
 *
 * @export
 * @param {String} serviceName  The top-level identifier for your app to store items in the keychain.
 * @param {String} accountName  A sub-identifier for individual entries.
 * @returns {Promise<Boolean>}  True if the keychain can be accessed, false if it threw an error.
 */
export async function accessKeychain(serviceName, accountName, logger) {
  try {
    const { setPassword, deletePassword } = require('keytar');

    // We don't want to overwrite valid data so append a dummy string
    const accessCheckAccount = accountName.concat('-access');
    await setPassword(serviceName, accessCheckAccount, 'access');

    // Also don't want to pollute the keychain so delete it afterward
    const wasDeleted = await deletePassword(serviceName, accessCheckAccount);
    return wasDeleted;
  } catch (error) {
    if (logger) logger('TransformPasswords: Cannot access keychain', { error });
    return false;
  }
}

/**
 * Utility function for consumers to clear the keychain when they're done with
 * it (e.g., the user has uninstalled the app).
 *
 * @export
 * @param {String} serviceName  The top-level identifier for your app to store items in the keychain.
 * @param {String} accountName  A sub-identifier for individual entries.
 * @returns {Promise<Boolean>}  True if the entry was removed, false otherwise.
 */
export async function clearKeychain(serviceName, accountName, logger) {
  try {
    const { deletePassword } = require('keytar');
    await deletePassword(serviceName, accountName);
  } catch (error) {
    if (logger) logger('TransformPasswords: Cannot clear keychain', { error });
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
  const logger = config.logger || (() => { /* noop */ });

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
      try {
        await setPassword(
          serviceName,
          accountName,
          coerceString(inboundState, serialize)
        );

        return {};
      } catch (error) {
        logger('TransformPasswords: Unable to write reducer', { error });
        return {};
      }
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
        outboundState = await (getPasswordForPath(outboundState, path));
      }

      return outboundState;
    } else {
      try {
        const secret = await getPassword(serviceName, accountName);
        return JSON.parse(secret);
      } catch (error) {
        logger('TransformPasswords: Unable to read reducer', { error });
        return {};
      }
    }
  }

  async function setPasswordForPath(inboundState, path) {
    const secret = get(inboundState, path);
    if (!secret) {
      logger('TransformPasswords: Nothing found at path', { path });
      return;
    }

    try {
      await setPassword(
        serviceName,
        accountName || path,
        coerceString(secret, serialize)
      );

      // Clear out the passwords unless directed not to. Use an immutable
      // version of unset to avoid modifying the original state object.
      if (clearPasswords) {
        inboundState = deleteIn(inboundState, path);
      }
    } catch (error) {
      logger(`TransformPasswords: Unable to write ${path} to keytar`, { error });
    }

    return inboundState;
  }

  async function getPasswordForPath(outboundState, path) {
    try {
      const secret = await getPassword(serviceName, accountName || path);

      // If we found a stored password, set it on the outbound state.
      // Use an immutable version of set to avoid modifying the original
      // state object.
      if (secret) {
        const toSet = serialize ? JSON.parse(secret) : secret;
        outboundState = setWith(clone(outboundState), path, toSet, clone);
      }
    } catch (error) {
      logger(`TransformPasswords: Unable to read ${path} from keytar`, { error });
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
