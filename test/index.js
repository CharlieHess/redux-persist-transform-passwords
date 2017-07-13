import { get } from 'lodash';
import { getPassword, setPassword, deletePassword } from 'keytar';
import deepFreeze from 'deep-freeze';

import createPasswordTransform, {
  accessKeychain
} from '../src';

jest.mock('keytar', () => ({
  getPassword: jest.fn(),
  setPassword: jest.fn(),
  deletePassword: jest.fn()
}));

describe('createPasswordTransform', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('with passwordPaths', () => {
    function defaultParams() {
      return {
        serviceName: 'FedGovt',
        passwordPaths: 'secret'
      };
    }

    it('should throw if any required arguments are missing', () => {
      expect(() => createPasswordTransform()).toThrow();

      expect(() => createPasswordTransform({
        serviceName: 'tryThis'
      })).toThrow();

      expect(() => createPasswordTransform({
        serviceName: 'tryThis',
        passwordPaths: (state) => state,
      })).not.toThrow();
    });

    it('should set secrets from state when serializing', async () => {
      const state = { secret: 4815162342 };
      const transform = createPasswordTransform(defaultParams());

      await transform.in(state);

      expect(setPassword).toHaveBeenCalledWith('FedGovt', 'secret', state.secret.toString());
    });

    it('should support setting multiple secrets', async () => {
      const state = {
        first: 4,
        second: 8,
        third: 15
      };

      const transform = createPasswordTransform({
        ...defaultParams(),
        passwordPaths: state => Object.keys(state)
      });

      await transform.in(state);

      expect(setPassword).toHaveBeenCalledTimes(3);

      expect(setPassword.mock.calls[0][1]).toEqual('first');
      expect(setPassword.mock.calls[0][2]).toEqual(state.first.toString());

      expect(setPassword.mock.calls[1][1]).toEqual('second');
      expect(setPassword.mock.calls[1][2]).toEqual(state.second.toString());

      expect(setPassword.mock.calls[2][1]).toEqual('third');
      expect(setPassword.mock.calls[2][2]).toEqual(state.third.toString());
    });

    it('should clear secrets from state unless directed not to', async () => {
      let state = { secret: 4815162342 };
      let transform = createPasswordTransform(defaultParams());

      let transformed = await transform.in(state);

      expect(transformed.secret).toEqual(undefined);

      state = { secret: "I'm back" };

      transform = createPasswordTransform({
        ...defaultParams(),
        clearPasswords: false
      });

      transformed = await transform.in(state);
      expect(transformed.secret).not.toEqual(undefined);
    });

    it('should populate state with secrets when deserializing', async () => {
      const state = { secret: undefined };
      const transform = createPasswordTransform(defaultParams());

      getPassword.mockReturnValue('hunter42');
      const transformed = await transform.out(state);

      expect(transformed.secret).toEqual('hunter42');
      expect(getPassword).toHaveBeenCalledWith('FedGovt', 'secret');
    });

    it('should handle errors reading from the keychain', async () => {
      const state = { secret: undefined };
      const transform = createPasswordTransform(defaultParams());

      getPassword.mockImplementationOnce(() => {
        throw new Error('Not permitted');
      });

      const transformed = await transform.out(state);

      expect(transformed.secret).toEqual(undefined);
    });

    it('should not mutate the state object', async () => {
      const state = { deeply: { nested: { secret: 4815162342 } } };
      deepFreeze(state);

      const transform = createPasswordTransform({
        ...defaultParams(),
        passwordPaths: 'deeply.nested.secret'
      });

      const transformed = await transform.in(state);
      expect(transformed).not.toEqual(state);
    });

    it('should support getting & setting deeply nested paths', async () => {
      const state = {
        regular: {
          ole: [{
            stuff: 'jk sekritz'
          }]
        },
        other: {
          things: 'moar sekrits'
        }
      };

      const passwordPaths = [
        'regular.ole[0].stuff',
        'other.things'
      ];

      const transform = createPasswordTransform({
        ...defaultParams(),
        passwordPaths,
      });

      let transformed = await transform.in(state);

      expect(get(transformed, passwordPaths[0])).toEqual(undefined);
      expect(get(transformed, passwordPaths[1])).toEqual(undefined);

      expect(setPassword).toHaveBeenCalledTimes(2);

      expect(setPassword.mock.calls[0][1]).toEqual(passwordPaths[0]);
      expect(setPassword.mock.calls[0][2]).toEqual('jk sekritz');

      expect(setPassword.mock.calls[1][1]).toEqual(passwordPaths[1]);
      expect(setPassword.mock.calls[1][2]).toEqual('moar sekrits');

      getPassword.mockReturnValue('from the keychain');

      transformed = await transform.out(state);

      expect(get(transformed, passwordPaths[0])).toEqual('from the keychain');
      expect(get(transformed, passwordPaths[1])).toEqual('from the keychain');

      expect(getPassword).toHaveBeenCalledTimes(2);
    });

    it('should serialize secrets if specified', async () => {
      const state = { secret: { password: 4815162342 } };
      const transform = createPasswordTransform({
        ...defaultParams(),
        serialize: true
      });

      await transform.in(state);

      expect(setPassword).toHaveBeenCalledWith(
        'FedGovt',
        'secret',
        JSON.stringify(state.secret)
      );

      const transformed = await transform.out(state);

      expect(transformed).toEqual(state);
    });
  });

  describe('without passwordPaths', () => {
    function defaultParams() {
      return {
        serviceName: 'FedGovt',
        accountName: 'NSA'
      };
    }

    it('should write the entire reducer into the keychain', async () => {
      const state = { secret: { password: 4815162342 } };
      deepFreeze(state);

      const transform = createPasswordTransform(defaultParams());
      const transformed = await transform.in(state);

      expect(setPassword).toHaveBeenCalledWith(
        'FedGovt',
        'NSA',
        JSON.stringify(state)
      );

      expect(transformed).not.toEqual(state);
      expect(transformed).toEqual({});
    });

    it('should read the entire reducer from the keychain', async () => {
      const transform = createPasswordTransform(defaultParams());

      const result = { secret: 'hunter42' };
      getPassword.mockReturnValue(JSON.stringify(result));
      const transformed = await transform.out({});

      expect(transformed).toEqual(result);
      expect(getPassword).toHaveBeenCalledWith('FedGovt', 'NSA');
    });

    it('should persist an empty object if writing the password fails', async () => {
      const state = { secret: { password: 4815162342 } };
      deepFreeze(state);

      const transform = createPasswordTransform(defaultParams());
      setPassword.mockImplementationOnce(() => {
        throw new Error();
      });
      const transformed = await transform.in(state);
      expect(transformed).toEqual({});
    });

    it('should return an empty object if reading the password fails', async () => {
      const transform = createPasswordTransform(defaultParams());

      const result = { secret: 'hunter42' };
      getPassword.mockImplementationOnce(() => {
        throw new Error();
      });
      const transformed = await transform.out({});

      expect(transformed).toEqual({});
    });
  });
});

describe('accessKeychain', () => {
  it('should not overwrite data in the given account name', async () => {
    await accessKeychain('CIA', 'Comey');
    expect(setPassword.mock.calls.length).toEqual(1);
    expect(setPassword.mock.calls[0][0]).toEqual('CIA');
    expect(setPassword.mock.calls[0][1]).toEqual('Comey-access');
  });

  it('should test writing to & deleting from the keychain', async () => {
    const serviceName = 'NSA';
    const accountName = 'malware'

    setPassword.mockImplementationOnce(() => { throw new Error(); });
    setPassword.mockImplementation(() => { });

    deletePassword.mockImplementationOnce(() => { throw new Error(); });
    deletePassword.mockImplementationOnce(() => false);
    deletePassword.mockImplementationOnce(() => true);

    // Attempt 1: setPassword throws -> fail
    expect(await accessKeychain(serviceName, accountName)).toEqual(false);

    // Attempt 2: setPassword success, deletePassword throws -> fail
    expect(await accessKeychain(serviceName, accountName)).toEqual(false);

    // Attempt 3: setPassword success, deletePassword fails -> fail
    expect(await accessKeychain(serviceName, accountName)).toEqual(false);

    // Attempt 4: setPassword success, deletePassword success -> success
    expect(await accessKeychain(serviceName, accountName)).toEqual(true);
  });
});