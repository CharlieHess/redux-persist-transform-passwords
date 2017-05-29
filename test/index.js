import { get } from 'lodash';
import { getPassword, setPassword } from 'keytar';
import deepFreeze from 'deep-freeze';

import createPasswordTransform from '../src';

jest.mock('keytar', () => ({
  getPassword: jest.fn(),
  setPassword: jest.fn()
}));

describe('createPasswordTransform', () => {

  afterEach(() => {
    jest.clearAllMocks();
  })

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
