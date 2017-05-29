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

Supply either a getter string (see Lodash [get](https://lodash.com/docs/4.17.4#get))
or a function that, given your input state, returns a getter string.

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
