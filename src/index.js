import get from 'lodash.get';
import set from 'lodash.set';
import unset from 'lodash.unset';
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
   * Transform that occurs when the store is being hydrated with state.
   * Retrieve the password path(s), get the actual passwords from the keychain
   * and apply them to the inbound state.
   *
   * @param {Object} state  The inbound state
   * @returns               The transformed state that will hydrate the store
   */
  async function inbound(state) {
    const inboundState = { ...state };
    const pathsToSet = getPasswordPaths(state);

    for (const path of pathsToSet) {
      try {
        const secret = await getPassword(serviceName, path);
        if (!!secret) {
          logger(`Applying secret to ${path}`);
          set(inboundState, path, secret);
        }
      } catch (err) {
        logger(`Unable to read ${path} from keytar`, err);
      }
    }

    return inboundState;
  }

  /**
   * Transform that occurs before state is persisted. Retrieve the password
   * path(s) from state, set them on the keychain and clear them from state.
   *
   * @param {Object} state  The outbound state
   * @returns               The transformed state that gets persisted
   */
  async function outbound(state) {
    const outboundState = { ...state };
    const pathsToGet = getPasswordPaths(state);

    for (const path of pathsToGet) {
      const secret = get(state, path);
      if (!secret) continue;

      try {
        logger(`Writing secret under ${path}`);
        await setPassword(serviceName, path, secret);
        if (clearPasswords) unset(outboundState, path);
      } catch (err) {
        logger(`Unable to write ${path} to keytar`, err);
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
