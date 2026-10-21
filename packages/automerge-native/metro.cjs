const path = require('node:path');

const wasmStub = path.join(__dirname, 'src', 'react-native', 'wasm-stub.ts');
const automergeDir = `${path.sep}@automerge${path.sep}automerge${path.sep}`;

// Hermes has no WebAssembly, and evaluating Automerge's wasm glue already
// throws. The app gets the slim build, whose backend installNativeAutomerge
// provides, and the glue module becomes a stub.
function withNativeAutomerge(config) {
  const upstream = config.resolver && config.resolver.resolveRequest;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        const resolve = upstream || context.resolveRequest;
        if (moduleName === '@automerge/automerge') {
          return resolve(context, '@automerge/automerge/slim', platform);
        }
        if (
          moduleName.endsWith('wasm_bindgen_output/web/automerge_wasm.js') &&
          context.originModulePath.includes(automergeDir)
        ) {
          return { type: 'sourceFile', filePath: wasmStub };
        }
        return resolve(context, moduleName, platform);
      },
    },
  };
}

module.exports = { withNativeAutomerge };
