import { get } from 'lodash';
import { set, unset } from 'lodash/fp';
import { createTransform } from 'redux-persist';
import { getPassword, setPassword } from 'keytar';

/**
 * Creates a new transform instance.
 *
 * @export
 * @param {Object} config
 * @param {String} config.serviceName     A unique identifier to reference passwords in the keychain
 * @param {String|Array<String>|Function} config.passwordPaths  Lodash getter path(s) to passwords
 * in your state, or a function that, given your state, returns path(s)
 * @param {Boolean} config.clearPasswords False to retain passwords in the persisted state
 * @param {Function} config.logger        A logging method
 * @returns {Transform}                   The redux-persist Transform
 */
export default function createPasswordTransform(config = {}) {
  const serviceName = config.serviceName;
  const passwordPaths = config.passwordPaths;
  const clearPasswords = config.clearPasswords !== false;
  const logger = config.logger || console.log.bind(console);

  if (!serviceName) throw new Error('serviceName is required');
  if (!passwordPaths) throw new Error('passwordPaths is required');

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
      if (!secret) continue;

      try {
        logger(`Writing secret under ${path}`, inboundState);
        await setPassword(serviceName, path, secret);

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
        logger(`Reading secret from ${path}`, outboundState);
        const secret = await getPassword(serviceName, path);

        // If we found a stored password, set it on the outbound state.
        // Use an immutable version of set to avoid modifying the original
        // state object.
        if (!!secret) {
          outboundState = set(path, secret, outboundState);
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
