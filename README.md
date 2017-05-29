## redux-persist-transform-passwords
Store some parts of your state in the macOS Keychain, Credential Vault on Windows, or `libsecret` on Linux. Uses [`keytar`](https://github.com/atom/node-keytar). Adheres to the `redux-persist` [transform API](https://github.com/rt2zz/redux-persist#transforms), but [async transforms](https://github.com/rt2zz/redux-persist/pull/360) must be enabled.

## Install
```
npm i redux-persist-transform-passwords --save
```

## Usage

Given a state shape like:

``` js
{
  credentials: {
    username: 'charlie',
    password: 'hunter42'
  }
}
```

Supply either a getter string (see Lodash [get](https://lodash.com/docs/4.17.4#get)) or a function that, given your input state, returns a getter string:

```js
import { persistStore } from 'redux-persist';
import createPasswordTransform from 'redux-persist-transform-passwords';

const passwordTransform = createPasswordTransform({
  serviceName: 'com.mySecretCompany.mySecretApp',
  passwordPaths: 'credentials.password',
  whitelist: ['authReducer']
});

persistStore(store, {
  transforms: [passwordTransform],
  asyncTransforms: true
});
```

Before serialization, the values at `passwordPaths` will be removed from your state and written into `keytar`. When the store is rehydrated, the secrets are read in from `keytar` and reapplied to your state.

You can find more usage examples by reading the tests.

## API

* `createPasswordTransform(config)` - Creates a new transform instance

* `config (Object)` - Configuration parameters
    * `serviceName (String)` - A unique identifier to reference passwords in the keychain
    * `passwordPaths (String|Array<String>|((state) => String|Array<String>)` - Lodash getter path(s) to the state properties that should be written to `keytar`, or a function that, given your state, returns getter paths. `keytar` only supports writing strings, so if a property is not a string it will be coerced.
    * `clearPasswords (Boolean)` - Whether or not to clear the properties from `passwordPaths` before the state is persisted. Defaults to `true`.
    * `serialize (Boolean)` - Whether or not to serialize password properties as JSON strings. Defaults to `false`.
    * `logger ((message, ...args) => void)` - An optional logging method. Defaults to `noop`.
