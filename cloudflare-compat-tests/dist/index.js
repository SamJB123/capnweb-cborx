// ../src/symbols.ts
var WORKERS_MODULE_SYMBOL = Symbol("workers-module");

// ../src/core.ts
if (!Symbol.dispose) {
  Symbol.dispose = Symbol.for("dispose");
}
if (!Symbol.asyncDispose) {
  Symbol.asyncDispose = Symbol.for("asyncDispose");
}
if (!Promise.withResolvers) {
  Promise.withResolvers = function() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
var workersModule = globalThis[WORKERS_MODULE_SYMBOL];
var RpcTarget = workersModule ? workersModule.RpcTarget : class {
};
var AsyncFunction = (async function() {
}).constructor;
function typeForRpc(value) {
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      return "primitive";
    case "undefined":
      return "undefined";
    case "object":
    case "function":
      break;
    case "bigint":
      return "bigint";
    default:
      return "unsupported";
  }
  if (value === null) {
    return "primitive";
  }
  let prototype = Object.getPrototypeOf(value);
  switch (prototype) {
    case Object.prototype:
      return "object";
    case Function.prototype:
    case AsyncFunction.prototype:
      return "function";
    case Array.prototype:
      return "array";
    case Date.prototype:
      return "date";
    case Uint8Array.prototype:
      return "bytes";
    // TODO: All other structured clone types.
    case RpcStub.prototype:
      return "stub";
    case RpcPromise.prototype:
      return "rpc-promise";
    // TODO: Promise<T> or thenable
    default:
      if (workersModule) {
        if (prototype == workersModule.RpcStub.prototype || value instanceof workersModule.ServiceStub) {
          return "rpc-target";
        } else if (prototype == workersModule.RpcPromise.prototype || prototype == workersModule.RpcProperty.prototype) {
          return "rpc-thenable";
        }
      }
      if (value instanceof RpcTarget) {
        return "rpc-target";
      }
      if (value instanceof Error) {
        return "error";
      }
      return "unsupported";
  }
}
function mapNotLoaded() {
  throw new Error("RPC map() implementation was not loaded.");
}
var mapImpl = { applyMap: mapNotLoaded, sendMap: mapNotLoaded };
var StubHook = class {
};
var ErrorStubHook = class extends StubHook {
  constructor(error) {
    super();
    this.error = error;
  }
  call(path, args) {
    return this;
  }
  map(path, captures, instructions) {
    return this;
  }
  get(path) {
    return this;
  }
  dup() {
    return this;
  }
  pull() {
    return Promise.reject(this.error);
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
  }
  onBroken(callback) {
    try {
      callback(this.error);
    } catch (err) {
      Promise.resolve(err);
    }
  }
};
var DISPOSED_HOOK = new ErrorStubHook(
  new Error("Attempted to use RPC stub after it has been disposed.")
);
var doCall = (hook, path, params) => {
  return hook.call(path, params);
};
function withCallInterceptor(interceptor, callback) {
  let oldValue = doCall;
  doCall = interceptor;
  try {
    return callback();
  } finally {
    doCall = oldValue;
  }
}
var RAW_STUB = Symbol("realStub");
var PROXY_HANDLERS = {
  apply(target2, thisArg, argumentsList) {
    let stub = target2.raw;
    return new RpcPromise(doCall(
      stub.hook,
      stub.pathIfPromise || [],
      RpcPayload.fromAppParams(argumentsList)
    ), []);
  },
  get(target2, prop, receiver) {
    let stub = target2.raw;
    if (prop === RAW_STUB) {
      return stub;
    } else if (prop in RpcPromise.prototype) {
      return stub[prop];
    } else if (typeof prop === "string") {
      return new RpcPromise(
        stub.hook,
        stub.pathIfPromise ? [...stub.pathIfPromise, prop] : [prop]
      );
    } else if (prop === Symbol.dispose && (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      return () => {
        stub.hook.dispose();
        stub.hook = DISPOSED_HOOK;
      };
    } else {
      return void 0;
    }
  },
  has(target2, prop) {
    let stub = target2.raw;
    if (prop === RAW_STUB) {
      return true;
    } else if (prop in RpcPromise.prototype) {
      return prop in stub;
    } else if (typeof prop === "string") {
      return true;
    } else if (prop === Symbol.dispose && (!stub.pathIfPromise || stub.pathIfPromise.length == 0)) {
      return true;
    } else {
      return false;
    }
  },
  construct(target2, args) {
    throw new Error("An RPC stub cannot be used as a constructor.");
  },
  defineProperty(target2, property, attributes) {
    throw new Error("Can't define properties on RPC stubs.");
  },
  deleteProperty(target2, p) {
    throw new Error("Can't delete properties on RPC stubs.");
  },
  getOwnPropertyDescriptor(target2, p) {
    return void 0;
  },
  getPrototypeOf(target2) {
    return Object.getPrototypeOf(target2.raw);
  },
  isExtensible(target2) {
    return false;
  },
  ownKeys(target2) {
    return [];
  },
  preventExtensions(target2) {
    return true;
  },
  set(target2, p, newValue, receiver) {
    throw new Error("Can't assign properties on RPC stubs.");
  },
  setPrototypeOf(target2, v) {
    throw new Error("Can't override prototype of RPC stubs.");
  }
};
var RpcStub = class _RpcStub extends RpcTarget {
  // Although `hook` and `path` are declared `public` here, they are effectively hidden by the
  // proxy.
  constructor(hook, pathIfPromise) {
    super();
    if (!(hook instanceof StubHook)) {
      let value = hook;
      if (value instanceof RpcTarget || value instanceof Function) {
        hook = TargetStubHook.create(value, void 0);
      } else {
        hook = new PayloadStubHook(RpcPayload.fromAppReturn(value));
      }
      if (pathIfPromise) {
        throw new TypeError("RpcStub constructor expected one argument, received two.");
      }
    }
    this.hook = hook;
    this.pathIfPromise = pathIfPromise;
    let func = () => {
    };
    func.raw = this;
    return new Proxy(func, PROXY_HANDLERS);
  }
  hook;
  pathIfPromise;
  dup() {
    let target2 = this[RAW_STUB];
    if (target2.pathIfPromise) {
      return new _RpcStub(target2.hook.get(target2.pathIfPromise));
    } else {
      return new _RpcStub(target2.hook.dup());
    }
  }
  onRpcBroken(callback) {
    this[RAW_STUB].hook.onBroken(callback);
  }
  map(func) {
    let { hook, pathIfPromise } = this[RAW_STUB];
    return mapImpl.sendMap(hook, pathIfPromise || [], func);
  }
  toString() {
    return "[object RpcStub]";
  }
};
var RpcPromise = class extends RpcStub {
  // TODO: Support passing target value or promise to constructor.
  constructor(hook, pathIfPromise) {
    super(hook, pathIfPromise);
  }
  then(onfulfilled, onrejected) {
    return pullPromise(this).then(...arguments);
  }
  catch(onrejected) {
    return pullPromise(this).catch(...arguments);
  }
  finally(onfinally) {
    return pullPromise(this).finally(...arguments);
  }
  toString() {
    return "[object RpcPromise]";
  }
};
function unwrapStubTakingOwnership(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise && pathIfPromise.length > 0) {
    return hook.get(pathIfPromise);
  } else {
    return hook;
  }
}
function unwrapStubAndDup(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise) {
    return hook.get(pathIfPromise);
  } else {
    return hook.dup();
  }
}
function unwrapStubNoProperties(stub) {
  let { hook, pathIfPromise } = stub[RAW_STUB];
  if (pathIfPromise && pathIfPromise.length > 0) {
    return void 0;
  }
  return hook;
}
function unwrapStubOrParent(stub) {
  return stub[RAW_STUB].hook;
}
function unwrapStubAndPath(stub) {
  return stub[RAW_STUB];
}
async function pullPromise(promise) {
  let { hook, pathIfPromise } = promise[RAW_STUB];
  if (pathIfPromise.length > 0) {
    hook = hook.get(pathIfPromise);
  }
  let payload = await hook.pull();
  return payload.deliverResolve();
}
var RpcPayload = class _RpcPayload {
  // Private constructor; use factory functions above to construct.
  constructor(value, source, stubs, promises) {
    this.value = value;
    this.source = source;
    this.stubs = stubs;
    this.promises = promises;
  }
  // Create a payload from a value passed as params to an RPC from the app.
  //
  // The payload does NOT take ownership of any stubs in `value`, and but promises not to modify
  // `value`. If the payload is delivered locally, `value` will be deep-copied first, so as not
  // to have the sender and recipient end up sharing the same mutable object. `value` will not be
  // touched again after the call returns synchronously (returns a promise) -- by that point,
  // the value has either been copied or serialized to the wire.
  static fromAppParams(value) {
    return new _RpcPayload(value, "params");
  }
  // Create a payload from a value return from an RPC implementation by the app.
  //
  // Unlike fromAppParams(), in this case the payload takes ownership of all stubs in `value`, and
  // may hold onto `value` for an arbitrarily long time (e.g. to serve pipelined requests). It
  // will still avoid modifying `value` and will make a deep copy if it is delivered locally.
  static fromAppReturn(value) {
    return new _RpcPayload(value, "return");
  }
  // Combine an array of payloads into a single payload whose value is an array. Ownership of all
  // stubs is transferred from the inputs to the outputs, hence if the output is disposed, the
  // inputs should not be. (In case of exception, nothing is disposed, though.)
  static fromArray(array) {
    let stubs = [];
    let promises = [];
    let resultArray = [];
    for (let payload of array) {
      payload.ensureDeepCopied();
      for (let stub of payload.stubs) {
        stubs.push(stub);
      }
      for (let promise of payload.promises) {
        if (promise.parent === payload) {
          promise = {
            parent: resultArray,
            property: resultArray.length,
            promise: promise.promise
          };
        }
        promises.push(promise);
      }
      resultArray.push(payload.value);
    }
    return new _RpcPayload(resultArray, "owned", stubs, promises);
  }
  // Create a payload from a value parsed off the wire using Evaluator.evaluate().
  //
  // A payload is constructed with a null value and the given stubs and promises arrays. The value
  // is expected to be filled in by the evaluator, and the stubs and promises arrays are expected
  // to be extended with stubs found during parsing. (This weird usage model is necessary so that
  // if the root value turns out to be a promise, its `parent` in `promises` can be the payload
  // object itself.)
  //
  // When done, the payload takes ownership of the final value and all the stubs within. It may
  // modify the value in preparation for delivery, and may deliver the value directly to the app
  // without copying.
  static forEvaluate(stubs, promises) {
    return new _RpcPayload(null, "owned", stubs, promises);
  }
  // Deep-copy the given value, including dup()ing all stubs.
  //
  // If `value` is a function, it should be bound to `oldParent` as its `this`.
  //
  // If deep-copying from a branch of some other RpcPayload, it must be provided, to make sure
  // RpcTargets found within don't get duplicate stubs.
  static deepCopyFrom(value, oldParent, owner) {
    let result = new _RpcPayload(null, "owned", [], []);
    result.value = result.deepCopy(
      value,
      oldParent,
      "value",
      result,
      /*dupStubs=*/
      true,
      owner
    );
    return result;
  }
  // For `source === "return"` payloads only, this tracks any StubHooks created around RpcTargets
  // found in the payload at the time that it is serialized (or deep-copied) for return, so that we
  // can make sure they are not disposed before the pipeline ends.
  //
  // This is initialized on first use.
  rpcTargets;
  // Get the StubHook representing the given RpcTarget found inside this payload.
  getHookForRpcTarget(target2, parent, dupStubs = true) {
    if (this.source === "params") {
      if (dupStubs) {
        let dupable = target2;
        if (typeof dupable.dup === "function") {
          target2 = dupable.dup();
        }
      }
      return TargetStubHook.create(target2, parent);
    } else if (this.source === "return") {
      let hook = this.rpcTargets?.get(target2);
      if (hook) {
        if (dupStubs) {
          return hook.dup();
        } else {
          this.rpcTargets?.delete(target2);
          return hook;
        }
      } else {
        hook = TargetStubHook.create(target2, parent);
        if (dupStubs) {
          if (!this.rpcTargets) {
            this.rpcTargets = /* @__PURE__ */ new Map();
          }
          this.rpcTargets.set(target2, hook);
          return hook.dup();
        } else {
          return hook;
        }
      }
    } else {
      throw new Error("owned payload shouldn't contain raw RpcTargets");
    }
  }
  deepCopy(value, oldParent, property, parent, dupStubs, owner) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
        return value;
      case "primitive":
      case "bigint":
      case "date":
      case "bytes":
      case "error":
      case "undefined":
        return value;
      case "array": {
        let array = value;
        let len = array.length;
        let result = new Array(len);
        for (let i = 0; i < len; i++) {
          result[i] = this.deepCopy(array[i], array, i, result, dupStubs, owner);
        }
        return result;
      }
      case "object": {
        let result = {};
        let object = value;
        for (let i in object) {
          result[i] = this.deepCopy(object[i], object, i, result, dupStubs, owner);
        }
        return result;
      }
      case "stub":
      case "rpc-promise": {
        let stub = value;
        let hook;
        if (dupStubs) {
          hook = unwrapStubAndDup(stub);
        } else {
          hook = unwrapStubTakingOwnership(stub);
        }
        if (stub instanceof RpcPromise) {
          let promise = new RpcPromise(hook, []);
          this.promises.push({ parent, property, promise });
          return promise;
        } else {
          let newStub = new RpcStub(hook);
          this.stubs.push(newStub);
          return newStub;
        }
      }
      case "function":
      case "rpc-target": {
        let target2 = value;
        let stub;
        if (owner) {
          stub = new RpcStub(owner.getHookForRpcTarget(target2, oldParent, dupStubs));
        } else {
          stub = new RpcStub(TargetStubHook.create(target2, oldParent));
        }
        this.stubs.push(stub);
        return stub;
      }
      case "rpc-thenable": {
        let target2 = value;
        let promise;
        if (owner) {
          promise = new RpcPromise(owner.getHookForRpcTarget(target2, oldParent, dupStubs), []);
        } else {
          promise = new RpcPromise(TargetStubHook.create(target2, oldParent), []);
        }
        this.promises.push({ parent, property, promise });
        return promise;
      }
      default:
        kind;
        throw new Error("unreachable");
    }
  }
  // Ensures that if the value originally came from an unowned source, we have replaced it with a
  // deep copy.
  ensureDeepCopied() {
    if (this.source !== "owned") {
      let dupStubs = this.source === "params";
      this.stubs = [];
      this.promises = [];
      try {
        this.value = this.deepCopy(this.value, void 0, "value", this, dupStubs, this);
      } catch (err) {
        this.stubs = void 0;
        this.promises = void 0;
        throw err;
      }
      this.source = "owned";
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in deep-copy?");
      }
      this.rpcTargets = void 0;
    }
  }
  // Resolve all promises in this payload and then assign the final value into `parent[property]`.
  deliverTo(parent, property, promises) {
    this.ensureDeepCopied();
    if (this.value instanceof RpcPromise) {
      _RpcPayload.deliverRpcPromiseTo(this.value, parent, property, promises);
    } else {
      parent[property] = this.value;
      for (let record of this.promises) {
        _RpcPayload.deliverRpcPromiseTo(record.promise, record.parent, record.property, promises);
      }
    }
  }
  static deliverRpcPromiseTo(promise, parent, property, promises) {
    let hook = unwrapStubNoProperties(promise);
    if (!hook) {
      throw new Error("property promises should have been resolved earlier");
    }
    let inner = hook.pull();
    if (inner instanceof _RpcPayload) {
      inner.deliverTo(parent, property, promises);
    } else {
      promises.push(inner.then((payload) => {
        let subPromises = [];
        payload.deliverTo(parent, property, subPromises);
        if (subPromises.length > 0) {
          return Promise.all(subPromises);
        }
      }));
    }
  }
  // Call the given function with the payload as an argument. The call is made synchronously if
  // possible, in order to maintain e-order. However, if any RpcPromises exist in the payload,
  // they are awaited and substituted before calling the function. The result of the call is
  // wrapped into another payload.
  //
  // The payload is automatically disposed after the call completes. The caller should not call
  // dispose().
  async deliverCall(func, thisArg) {
    try {
      let promises = [];
      this.deliverTo(this, "value", promises);
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      let result = Function.prototype.apply.call(func, thisArg, this.value);
      if (result instanceof RpcPromise) {
        return _RpcPayload.fromAppReturn(result);
      } else {
        return _RpcPayload.fromAppReturn(await result);
      }
    } finally {
      this.dispose();
    }
  }
  // Produce a promise for this payload for return to the application. Any RpcPromises in the
  // payload are awaited and substituted with their results first.
  //
  // The returned object will have a disposer which disposes the payload. The caller should not
  // separately dispose it.
  async deliverResolve() {
    try {
      let promises = [];
      this.deliverTo(this, "value", promises);
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      let result = this.value;
      if (result instanceof Object) {
        if (!(Symbol.dispose in result)) {
          Object.defineProperty(result, Symbol.dispose, {
            // NOTE: Using `this.dispose.bind(this)` here causes Playwright's build of
            //   Chromium 140.0.7339.16 to fail when the object is assigned to a `using` variable,
            //   with the error:
            //       TypeError: Symbol(Symbol.dispose) is not a function
            //   I cannot reproduce this problem in Chrome 140.0.7339.127 nor in Node or workerd,
            //   so maybe it was a short-lived V8 bug or something. To be safe, though, we use
            //   `() => this.dispose()`, which seems to always work.
            value: () => this.dispose(),
            writable: true,
            enumerable: false,
            configurable: true
          });
        }
      }
      return result;
    } catch (err) {
      this.dispose();
      throw err;
    }
  }
  dispose() {
    if (this.source === "owned") {
      this.stubs.forEach((stub) => stub[Symbol.dispose]());
      this.promises.forEach((promise) => promise.promise[Symbol.dispose]());
    } else if (this.source === "return") {
      this.disposeImpl(this.value, void 0);
      if (this.rpcTargets && this.rpcTargets.size > 0) {
        throw new Error("Not all rpcTargets were accounted for in disposeImpl()?");
      }
    } else {
    }
    this.source = "owned";
    this.stubs = [];
    this.promises = [];
  }
  // Recursive dispose, called only when `source` is "return".
  disposeImpl(value, parent) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
      case "undefined":
        return;
      case "array": {
        let array = value;
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.disposeImpl(array[i], array);
        }
        return;
      }
      case "object": {
        let object = value;
        for (let i in object) {
          this.disposeImpl(object[i], object);
        }
        return;
      }
      case "stub":
      case "rpc-promise": {
        let stub = value;
        let hook = unwrapStubNoProperties(stub);
        if (hook) {
          hook.dispose();
        }
        return;
      }
      case "function":
      case "rpc-target": {
        let target2 = value;
        let hook = this.rpcTargets?.get(target2);
        if (hook) {
          hook.dispose();
          this.rpcTargets.delete(target2);
        } else {
          disposeRpcTarget(target2);
        }
        return;
      }
      case "rpc-thenable":
        return;
      default:
        kind;
        return;
    }
  }
  // Ignore unhandled rejections in all promises in this payload -- that is, all promises that
  // *would* be awaited if this payload were to be delivered. See the similarly-named method of
  // StubHook for explanation.
  ignoreUnhandledRejections() {
    if (this.stubs) {
      this.stubs.forEach((stub) => {
        unwrapStubOrParent(stub).ignoreUnhandledRejections();
      });
      this.promises.forEach(
        (promise) => unwrapStubOrParent(promise.promise).ignoreUnhandledRejections()
      );
    } else {
      this.ignoreUnhandledRejectionsImpl(this.value);
    }
  }
  ignoreUnhandledRejectionsImpl(value) {
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported":
      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
      case "undefined":
      case "function":
      case "rpc-target":
        return;
      case "array": {
        let array = value;
        let len = array.length;
        for (let i = 0; i < len; i++) {
          this.ignoreUnhandledRejectionsImpl(array[i]);
        }
        return;
      }
      case "object": {
        let object = value;
        for (let i in object) {
          this.ignoreUnhandledRejectionsImpl(object[i]);
        }
        return;
      }
      case "stub":
      case "rpc-promise":
        unwrapStubOrParent(value).ignoreUnhandledRejections();
        return;
      case "rpc-thenable":
        value.then((_) => {
        }, (_) => {
        });
        return;
      default:
        kind;
        return;
    }
  }
};
function followPath(value, parent, path, owner) {
  for (let i = 0; i < path.length; i++) {
    parent = value;
    let part = path[i];
    if (part in Object.prototype) {
      value = void 0;
      continue;
    }
    let kind = typeForRpc(value);
    switch (kind) {
      case "object":
      case "function":
        if (Object.hasOwn(value, part)) {
          value = value[part];
        } else {
          value = void 0;
        }
        break;
      case "array":
        if (Number.isInteger(part) && part >= 0) {
          value = value[part];
        } else {
          value = void 0;
        }
        break;
      case "rpc-target":
      case "rpc-thenable": {
        if (Object.hasOwn(value, part)) {
          throw new TypeError(
            `Attempted to access property '${part}', which is an instance property of the RpcTarget. To avoid leaking private internals, instance properties cannot be accessed over RPC. If you want to make this property available over RPC, define it as a method or getter on the class, instead of an instance property.`
          );
        } else {
          value = value[part];
        }
        owner = null;
        break;
      }
      case "stub":
      case "rpc-promise": {
        let { hook, pathIfPromise } = unwrapStubAndPath(value);
        return { hook, remainingPath: pathIfPromise ? pathIfPromise.concat(path.slice(i)) : path.slice(i) };
      }
      case "primitive":
      case "bigint":
      case "bytes":
      case "date":
      case "error":
        value = void 0;
        break;
      case "undefined":
        value = value[part];
        break;
      case "unsupported": {
        if (i === 0) {
          throw new TypeError(`RPC stub points at a non-serializable type.`);
        } else {
          let prefix = path.slice(0, i).join(".");
          let remainder = path.slice(0, i).join(".");
          throw new TypeError(
            `'${prefix}' is not a serializable type, so property ${remainder} cannot be accessed.`
          );
        }
      }
      default:
        kind;
        throw new TypeError("unreachable");
    }
  }
  if (value instanceof RpcPromise) {
    let { hook, pathIfPromise } = unwrapStubAndPath(value);
    return { hook, remainingPath: pathIfPromise || [] };
  }
  return {
    value,
    parent,
    owner
  };
}
var ValueStubHook = class extends StubHook {
  call(path, args) {
    try {
      let { value, owner } = this.getValue();
      let followResult = followPath(value, void 0, path, owner);
      if (followResult.hook) {
        return followResult.hook.call(followResult.remainingPath, args);
      }
      if (typeof followResult.value != "function") {
        throw new TypeError(`'${path.join(".")}' is not a function.`);
      }
      let promise = args.deliverCall(followResult.value, followResult.parent);
      return new PromiseStubHook(promise.then((payload) => {
        return new PayloadStubHook(payload);
      }));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
  map(path, captures, instructions) {
    try {
      let followResult;
      try {
        let { value, owner } = this.getValue();
        followResult = followPath(value, void 0, path, owner);
        ;
      } catch (err) {
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }
      if (followResult.hook) {
        return followResult.hook.map(followResult.remainingPath, captures, instructions);
      }
      return mapImpl.applyMap(
        followResult.value,
        followResult.parent,
        followResult.owner,
        captures,
        instructions
      );
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
  get(path) {
    try {
      let { value, owner } = this.getValue();
      if (path.length === 0 && owner === null) {
        throw new Error("Can't dup an RpcTarget stub as a promise.");
      }
      let followResult = followPath(value, void 0, path, owner);
      if (followResult.hook) {
        return followResult.hook.get(followResult.remainingPath);
      }
      return new PayloadStubHook(RpcPayload.deepCopyFrom(
        followResult.value,
        followResult.parent,
        followResult.owner
      ));
    } catch (err) {
      return new ErrorStubHook(err);
    }
  }
};
var PayloadStubHook = class _PayloadStubHook extends ValueStubHook {
  constructor(payload) {
    super();
    this.payload = payload;
  }
  payload;
  // cleared when disposed
  getPayload() {
    if (this.payload) {
      return this.payload;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }
  getValue() {
    let payload = this.getPayload();
    return { value: payload.value, owner: payload };
  }
  dup() {
    let thisPayload = this.getPayload();
    return new _PayloadStubHook(RpcPayload.deepCopyFrom(
      thisPayload.value,
      void 0,
      thisPayload
    ));
  }
  pull() {
    return this.getPayload();
  }
  ignoreUnhandledRejections() {
    if (this.payload) {
      this.payload.ignoreUnhandledRejections();
    }
  }
  dispose() {
    if (this.payload) {
      this.payload.dispose();
      this.payload = void 0;
    }
  }
  onBroken(callback) {
    if (this.payload) {
      if (this.payload.value instanceof RpcStub) {
        this.payload.value.onRpcBroken(callback);
      }
    }
  }
};
function disposeRpcTarget(target2) {
  if (Symbol.dispose in target2) {
    try {
      target2[Symbol.dispose]();
    } catch (err) {
      Promise.reject(err);
    }
  }
}
var TargetStubHook = class _TargetStubHook extends ValueStubHook {
  // Constructs a TargetStubHook that is not duplicated from an existing hook.
  //
  // If `value` is a function, `parent` is bound as its "this".
  static create(value, parent) {
    if (typeof value !== "function") {
      parent = void 0;
    }
    return new _TargetStubHook(value, parent);
  }
  constructor(target2, parent, dupFrom) {
    super();
    this.target = target2;
    this.parent = parent;
    if (dupFrom) {
      if (dupFrom.refcount) {
        this.refcount = dupFrom.refcount;
        ++this.refcount.count;
      }
    } else if (Symbol.dispose in target2) {
      this.refcount = { count: 1 };
    }
  }
  target;
  // cleared when disposed
  parent;
  // `this` parameter when calling `target`
  refcount;
  // undefined if not needed (because target has no disposer)
  getTarget() {
    if (this.target) {
      return this.target;
    } else {
      throw new Error("Attempted to use an RPC StubHook after it was disposed.");
    }
  }
  getValue() {
    return { value: this.getTarget(), owner: null };
  }
  dup() {
    return new _TargetStubHook(this.getTarget(), this.parent, this);
  }
  pull() {
    let target2 = this.getTarget();
    if ("then" in target2) {
      return Promise.resolve(target2).then((resolution) => {
        return RpcPayload.fromAppReturn(resolution);
      });
    } else {
      return Promise.reject(new Error("Tried to resolve a non-promise stub."));
    }
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
    if (this.target) {
      if (this.refcount) {
        if (--this.refcount.count == 0) {
          disposeRpcTarget(this.target);
        }
      }
      this.target = void 0;
    }
  }
  onBroken(callback) {
  }
  describeForHibernation(registry) {
    if (this.target) {
      return registry.describe(this.target);
    }
    return void 0;
  }
};
function __experimental_describeStubHookForHibernation(hook, registry) {
  if (hook instanceof TargetStubHook) {
    return hook.describeForHibernation(registry);
  }
  return void 0;
}
function __experimental_restoreStubHookFromHibernation(descriptor, registry) {
  return TargetStubHook.create(registry.restore(descriptor), void 0);
}
var PromiseStubHook = class _PromiseStubHook extends StubHook {
  promise;
  resolution;
  constructor(promise) {
    super();
    this.promise = promise.then((res) => {
      this.resolution = res;
      return res;
    });
  }
  call(path, args) {
    args.ensureDeepCopied();
    return new _PromiseStubHook(this.promise.then((hook) => hook.call(path, args)));
  }
  map(path, captures, instructions) {
    return new _PromiseStubHook(this.promise.then(
      (hook) => hook.map(path, captures, instructions),
      (err) => {
        for (let cap of captures) {
          cap.dispose();
        }
        throw err;
      }
    ));
  }
  get(path) {
    return new _PromiseStubHook(this.promise.then((hook) => hook.get(path)));
  }
  dup() {
    if (this.resolution) {
      return this.resolution.dup();
    } else {
      return new _PromiseStubHook(this.promise.then((hook) => hook.dup()));
    }
  }
  pull() {
    if (this.resolution) {
      return this.resolution.pull();
    } else {
      return this.promise.then((hook) => hook.pull());
    }
  }
  ignoreUnhandledRejections() {
    if (this.resolution) {
      this.resolution.ignoreUnhandledRejections();
    } else {
      this.promise.then((res) => {
        res.ignoreUnhandledRejections();
      }, (err) => {
      });
    }
  }
  dispose() {
    this.promise.then((hook) => {
      hook.dispose();
    }, () => {
      if (this.resolution) {
        this.resolution.dispose();
      }
    });
  }
  onBroken(callback) {
    if (this.resolution) {
      this.resolution.onBroken(callback);
    } else {
      this.promise.then((hook) => {
        hook.onBroken(callback);
      }, callback);
    }
  }
};

// ../src/serialize.ts
var NullExporter = class {
  exportStub(stub) {
    throw new Error("Cannot serialize RPC stubs without an RPC session.");
  }
  exportPromise(stub) {
    throw new Error("Cannot serialize RPC stubs without an RPC session.");
  }
  getImport(hook) {
    return void 0;
  }
  unexport(ids) {
  }
  onSendError(error) {
  }
};
var NULL_EXPORTER = new NullExporter();
var ERROR_TYPES = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
  AggregateError
  // TODO: DOMError? Others?
};
var Devaluator = class _Devaluator {
  constructor(exporter, source) {
    this.exporter = exporter;
    this.source = source;
  }
  // Devaluate the given value.
  // * value: The value to devaluate.
  // * parent: The value's parent object, which would be used as `this` if the value were called
  //     as a function.
  // * exporter: Callbacks to the RPC session for exporting capabilities found in this message.
  // * source: The RpcPayload which contains the value, and therefore owns stubs within.
  //
  // Returns: The devaluated value, ready to be JSON-serialized.
  static devaluate(value, parent, exporter = NULL_EXPORTER, source) {
    let devaluator = new _Devaluator(exporter, source);
    try {
      return devaluator.devaluateImpl(value, parent, 0);
    } catch (err) {
      if (devaluator.exports) {
        try {
          exporter.unexport(devaluator.exports);
        } catch (err2) {
        }
      }
      throw err;
    }
  }
  exports;
  devaluateImpl(value, parent, depth) {
    if (depth >= 64) {
      throw new Error(
        "Serialization exceeded maximum allowed depth. (Does the message contain cycles?)"
      );
    }
    let kind = typeForRpc(value);
    switch (kind) {
      case "unsupported": {
        let msg;
        try {
          msg = `Cannot serialize value: ${value}`;
        } catch (err) {
          msg = "Cannot serialize value: (couldn't stringify value)";
        }
        throw new TypeError(msg);
      }
      case "primitive":
        if (typeof value === "number" && !isFinite(value)) {
          if (value === Infinity) {
            return ["inf"];
          } else if (value === -Infinity) {
            return ["-inf"];
          } else {
            return ["nan"];
          }
        } else {
          return value;
        }
      case "object": {
        let object = value;
        let result = {};
        for (let key in object) {
          result[key] = this.devaluateImpl(object[key], object, depth + 1);
        }
        return result;
      }
      case "array": {
        let array = value;
        let len = array.length;
        let result = new Array(len);
        for (let i = 0; i < len; i++) {
          result[i] = this.devaluateImpl(array[i], array, depth + 1);
        }
        return [result];
      }
      case "bigint":
        return ["bigint", value.toString()];
      case "date":
        return ["date", value.getTime()];
      case "bytes": {
        return ["bytes", value];
      }
      case "error": {
        let e = value;
        let rewritten = this.exporter.onSendError(e);
        if (rewritten) {
          e = rewritten;
        }
        const errorName = e?.name ?? "Error";
        const errorMessage = e?.message ?? String(e);
        let result = ["error", errorName, errorMessage];
        if (rewritten && rewritten.stack) {
          result.push(rewritten.stack);
        }
        return result;
      }
      case "undefined":
        return ["undefined"];
      case "stub":
      case "rpc-promise": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let { hook, pathIfPromise } = unwrapStubAndPath(value);
        let importId = this.exporter.getImport(hook);
        if (importId !== void 0) {
          if (pathIfPromise) {
            if (pathIfPromise.length > 0) {
              return ["pipeline", importId, pathIfPromise];
            } else {
              return ["pipeline", importId];
            }
          } else {
            return ["import", importId];
          }
        }
        if (pathIfPromise) {
          hook = hook.get(pathIfPromise);
        } else {
          hook = hook.dup();
        }
        return this.devaluateHook(pathIfPromise ? "promise" : "export", hook);
      }
      case "function":
      case "rpc-target": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let hook = this.source.getHookForRpcTarget(value, parent);
        return this.devaluateHook("export", hook);
      }
      case "rpc-thenable": {
        if (!this.source) {
          throw new Error("Can't serialize RPC stubs in this context.");
        }
        let hook = this.source.getHookForRpcTarget(value, parent);
        return this.devaluateHook("promise", hook);
      }
      default:
        kind;
        throw new Error("unreachable");
    }
  }
  devaluateHook(type, hook) {
    if (!this.exports) this.exports = [];
    let exportId = type === "promise" ? this.exporter.exportPromise(hook) : this.exporter.exportStub(hook);
    this.exports.push(exportId);
    return [type, exportId];
  }
};
var NullImporter = class {
  importStub(idx) {
    throw new Error("Cannot deserialize RPC stubs without an RPC session.");
  }
  importPromise(idx) {
    throw new Error("Cannot deserialize RPC stubs without an RPC session.");
  }
  getExport(idx) {
    return void 0;
  }
};
var NULL_IMPORTER = new NullImporter();
var Evaluator = class _Evaluator {
  constructor(importer) {
    this.importer = importer;
  }
  stubs = [];
  promises = [];
  evaluate(value) {
    let payload = RpcPayload.forEvaluate(this.stubs, this.promises);
    try {
      payload.value = this.evaluateImpl(value, payload, "value");
      return payload;
    } catch (err) {
      payload.dispose();
      throw err;
    }
  }
  // Evaluate the value without destroying it.
  evaluateCopy(value) {
    return this.evaluate(structuredClone(value));
  }
  evaluateImpl(value, parent, property) {
    if (value instanceof Array) {
      if (value.length == 1 && value[0] instanceof Array) {
        let result = value[0];
        for (let i = 0; i < result.length; i++) {
          result[i] = this.evaluateImpl(result[i], result, i);
        }
        return result;
      } else switch (value[0]) {
        case "bigint":
          if (typeof value[1] == "string") {
            return BigInt(value[1]);
          }
          break;
        case "date":
          if (typeof value[1] == "number") {
            return new Date(value[1]);
          }
          break;
        case "bytes": {
          if (value[1] instanceof Uint8Array) {
            return value[1];
          }
          break;
        }
        case "error":
          if (value.length >= 3 && typeof value[1] === "string" && typeof value[2] === "string") {
            let cls = ERROR_TYPES[value[1]] || Error;
            let result = new cls(value[2]);
            if (typeof value[3] === "string") {
              result.stack = value[3];
            }
            return result;
          }
          break;
        case "undefined":
          if (value.length === 1) {
            return void 0;
          }
          break;
        case "inf":
          return Infinity;
        case "-inf":
          return -Infinity;
        case "nan":
          return NaN;
        case "import":
        case "pipeline": {
          if (value.length < 2 || value.length > 4) {
            break;
          }
          if (typeof value[1] != "number") {
            break;
          }
          let hook = this.importer.getExport(value[1]);
          if (!hook) {
            throw new Error(`no such entry on exports table: ${value[1]}`);
          }
          let isPromise = value[0] == "pipeline";
          let addStub = (hook2) => {
            if (isPromise) {
              let promise = new RpcPromise(hook2, []);
              this.promises.push({ promise, parent, property });
              return promise;
            } else {
              let stub = new RpcPromise(hook2, []);
              this.stubs.push(stub);
              return stub;
            }
          };
          if (value.length == 2) {
            if (isPromise) {
              return addStub(hook.get([]));
            } else {
              return addStub(hook.dup());
            }
          }
          let path = value[2];
          if (!(path instanceof Array)) {
            break;
          }
          if (!path.every(
            (part) => {
              return typeof part == "string" || typeof part == "number";
            }
          )) {
            break;
          }
          if (value.length == 3) {
            return addStub(hook.get(path));
          }
          let args = value[3];
          if (!(args instanceof Array)) {
            break;
          }
          let subEval = new _Evaluator(this.importer);
          args = subEval.evaluate([args]);
          return addStub(hook.call(path, args));
        }
        case "remap": {
          if (value.length !== 5 || typeof value[1] !== "number" || !(value[2] instanceof Array) || !(value[3] instanceof Array) || !(value[4] instanceof Array)) {
            break;
          }
          let hook = this.importer.getExport(value[1]);
          if (!hook) {
            throw new Error(`no such entry on exports table: ${value[1]}`);
          }
          console.log(`[REMAP] subject idx=${value[1]}, hook=${hook.constructor.name}, hookId=${"hookId" in hook ? hook.hookId : "N/A"}`);
          let path = value[2];
          if (!path.every(
            (part) => {
              return typeof part == "string" || typeof part == "number";
            }
          )) {
            break;
          }
          let captures = value[3].map((cap, i) => {
            if (!(cap instanceof Array) || cap.length !== 2 || cap[0] !== "import" && cap[0] !== "export" || typeof cap[1] !== "number") {
              throw new TypeError(`unknown map capture: ${JSON.stringify(cap)}`);
            }
            if (cap[0] === "export") {
              const result = this.importer.importStub(cap[1]);
              console.log(`[REMAP] capture[${i}] export idx=${cap[1]} -> ${result.constructor.name}, hookId=${"hookId" in result ? result.hookId : "N/A"}`);
              return result;
            } else {
              let exp = this.importer.getExport(cap[1]);
              if (!exp) {
                throw new Error(`no such entry on exports table: ${cap[1]}`);
              }
              console.log(`[REMAP] capture[${i}] import idx=${cap[1]} -> ${exp.constructor.name}, hookId=${"hookId" in exp ? exp.hookId : "N/A"}, calling dup()`);
              return exp.dup();
            }
          });
          let instructions = value[4];
          console.log(`[REMAP] calling hook.map() with ${captures.length} captures`);
          let resultHook = hook.map(path, captures, instructions);
          console.log(`[REMAP] hook.map() returned ${resultHook.constructor.name}`);
          let promise = new RpcPromise(resultHook, []);
          this.promises.push({ promise, parent, property });
          return promise;
        }
        case "export":
        case "promise":
          if (typeof value[1] == "number") {
            if (value[0] == "promise") {
              let hook = this.importer.importPromise(value[1]);
              let promise = new RpcPromise(hook, []);
              this.promises.push({ parent, property, promise });
              return promise;
            } else {
              let hook = this.importer.importStub(value[1]);
              let stub = new RpcStub(hook);
              this.stubs.push(stub);
              return stub;
            }
          }
          break;
      }
      throw new TypeError(`unknown special value: ${JSON.stringify(value)}`);
    } else if (value instanceof Object) {
      let result = value;
      for (let key in result) {
        if (key in Object.prototype || key === "toJSON") {
          this.evaluateImpl(result[key], result, key);
          delete result[key];
        } else {
          result[key] = this.evaluateImpl(result[key], result, key);
        }
      }
      return result;
    } else {
      return value;
    }
  }
};

// ../node_modules/cbor-x/decode.js
var decoder;
try {
  decoder = new TextDecoder();
} catch (error) {
}
var src;
var srcEnd;
var position = 0;
var EMPTY_ARRAY = [];
var LEGACY_RECORD_INLINE_ID = 105;
var RECORD_DEFINITIONS_ID = 57342;
var RECORD_INLINE_ID = 57343;
var BUNDLED_STRINGS_ID = 57337;
var PACKED_REFERENCE_TAG_ID = 6;
var STOP_CODE = {};
var maxArraySize = 11281e4;
var maxMapSize = 1681e4;
var strings = EMPTY_ARRAY;
var stringPosition = 0;
var currentDecoder = {};
var currentStructures;
var srcString;
var srcStringStart = 0;
var srcStringEnd = 0;
var bundledStrings;
var referenceMap;
var currentExtensions = [];
var currentExtensionRanges = [];
var packedValues;
var dataView;
var restoreMapsAsObject;
var defaultOptions = {
  useRecords: false,
  mapsAsObjects: true
};
var sequentialMode = false;
var inlineObjectReadThreshold = 2;
try {
  new Function("");
} catch (error) {
  inlineObjectReadThreshold = Infinity;
}
var Decoder = class _Decoder {
  constructor(options) {
    if (options) {
      if ((options.keyMap || options._keyMap) && !options.useRecords) {
        options.useRecords = false;
        options.mapsAsObjects = true;
      }
      if (options.useRecords === false && options.mapsAsObjects === void 0)
        options.mapsAsObjects = true;
      if (options.getStructures)
        options.getShared = options.getStructures;
      if (options.getShared && !options.structures)
        (options.structures = []).uninitialized = true;
      if (options.keyMap) {
        this.mapKey = /* @__PURE__ */ new Map();
        for (let [k, v] of Object.entries(options.keyMap)) this.mapKey.set(v, k);
      }
    }
    Object.assign(this, options);
  }
  /*
  decodeKey(key) {
  	return this.keyMap
  		? Object.keys(this.keyMap)[Object.values(this.keyMap).indexOf(key)] || key
  		: key
  }
  */
  decodeKey(key) {
    return this.keyMap ? this.mapKey.get(key) || key : key;
  }
  encodeKey(key) {
    return this.keyMap && this.keyMap.hasOwnProperty(key) ? this.keyMap[key] : key;
  }
  encodeKeys(rec) {
    if (!this._keyMap) return rec;
    let map = /* @__PURE__ */ new Map();
    for (let [k, v] of Object.entries(rec)) map.set(this._keyMap.hasOwnProperty(k) ? this._keyMap[k] : k, v);
    return map;
  }
  decodeKeys(map) {
    if (!this._keyMap || map.constructor.name != "Map") return map;
    if (!this._mapKey) {
      this._mapKey = /* @__PURE__ */ new Map();
      for (let [k, v] of Object.entries(this._keyMap)) this._mapKey.set(v, k);
    }
    let res = {};
    map.forEach((v, k) => res[safeKey(this._mapKey.has(k) ? this._mapKey.get(k) : k)] = v);
    return res;
  }
  mapDecode(source, end) {
    let res = this.decode(source);
    if (this._keyMap) {
      switch (res.constructor.name) {
        case "Array":
          return res.map((r) => this.decodeKeys(r));
      }
    }
    return res;
  }
  decode(source, end) {
    if (src) {
      return saveState(() => {
        clearSource();
        return this ? this.decode(source, end) : _Decoder.prototype.decode.call(defaultOptions, source, end);
      });
    }
    srcEnd = end > -1 ? end : source.length;
    position = 0;
    stringPosition = 0;
    srcStringEnd = 0;
    srcString = null;
    strings = EMPTY_ARRAY;
    bundledStrings = null;
    src = source;
    try {
      dataView = source.dataView || (source.dataView = new DataView(source.buffer, source.byteOffset, source.byteLength));
    } catch (error) {
      src = null;
      if (source instanceof Uint8Array)
        throw error;
      throw new Error("Source must be a Uint8Array or Buffer but was a " + (source && typeof source == "object" ? source.constructor.name : typeof source));
    }
    if (this instanceof _Decoder) {
      currentDecoder = this;
      packedValues = this.sharedValues && (this.pack ? new Array(this.maxPrivatePackedValues || 16).concat(this.sharedValues) : this.sharedValues);
      if (this.structures) {
        currentStructures = this.structures;
        return checkedRead();
      } else if (!currentStructures || currentStructures.length > 0) {
        currentStructures = [];
      }
    } else {
      currentDecoder = defaultOptions;
      if (!currentStructures || currentStructures.length > 0)
        currentStructures = [];
      packedValues = null;
    }
    return checkedRead();
  }
  decodeMultiple(source, forEach) {
    let values, lastPosition = 0;
    try {
      let size = source.length;
      sequentialMode = true;
      let value = this ? this.decode(source, size) : defaultDecoder.decode(source, size);
      if (forEach) {
        if (forEach(value) === false) {
          return;
        }
        while (position < size) {
          lastPosition = position;
          if (forEach(checkedRead()) === false) {
            return;
          }
        }
      } else {
        values = [value];
        while (position < size) {
          lastPosition = position;
          values.push(checkedRead());
        }
        return values;
      }
    } catch (error) {
      error.lastPosition = lastPosition;
      error.values = values;
      throw error;
    } finally {
      sequentialMode = false;
      clearSource();
    }
  }
};
function checkedRead() {
  try {
    let result = read();
    if (bundledStrings) {
      if (position >= bundledStrings.postBundlePosition) {
        let error = new Error("Unexpected bundle position");
        error.incomplete = true;
        throw error;
      }
      position = bundledStrings.postBundlePosition;
      bundledStrings = null;
    }
    if (position == srcEnd) {
      currentStructures = null;
      src = null;
      if (referenceMap)
        referenceMap = null;
    } else if (position > srcEnd) {
      let error = new Error("Unexpected end of CBOR data");
      error.incomplete = true;
      throw error;
    } else if (!sequentialMode) {
      throw new Error("Data read, but end of buffer not reached");
    }
    return result;
  } catch (error) {
    clearSource();
    if (error instanceof RangeError || error.message.startsWith("Unexpected end of buffer")) {
      error.incomplete = true;
    }
    throw error;
  }
}
function read() {
  let token = src[position++];
  let majorType = token >> 5;
  token = token & 31;
  if (token > 23) {
    switch (token) {
      case 24:
        token = src[position++];
        break;
      case 25:
        if (majorType == 7) {
          return getFloat16();
        }
        token = dataView.getUint16(position);
        position += 2;
        break;
      case 26:
        if (majorType == 7) {
          let value = dataView.getFloat32(position);
          if (currentDecoder.useFloat32 > 2) {
            let multiplier = mult10[(src[position] & 127) << 1 | src[position + 1] >> 7];
            position += 4;
            return (multiplier * value + (value > 0 ? 0.5 : -0.5) >> 0) / multiplier;
          }
          position += 4;
          return value;
        }
        token = dataView.getUint32(position);
        position += 4;
        break;
      case 27:
        if (majorType == 7) {
          let value = dataView.getFloat64(position);
          position += 8;
          return value;
        }
        if (majorType > 1) {
          if (dataView.getUint32(position) > 0)
            throw new Error("JavaScript does not support arrays, maps, or strings with length over 4294967295");
          token = dataView.getUint32(position + 4);
        } else if (currentDecoder.int64AsNumber) {
          token = dataView.getUint32(position) * 4294967296;
          token += dataView.getUint32(position + 4);
        } else
          token = dataView.getBigUint64(position);
        position += 8;
        break;
      case 31:
        switch (majorType) {
          case 2:
          // byte string
          case 3:
            throw new Error("Indefinite length not supported for byte or text strings");
          case 4:
            let array = [];
            let value, i = 0;
            while ((value = read()) != STOP_CODE) {
              if (i >= maxArraySize) throw new Error(`Array length exceeds ${maxArraySize}`);
              array[i++] = value;
            }
            return majorType == 4 ? array : majorType == 3 ? array.join("") : Buffer.concat(array);
          case 5:
            let key;
            if (currentDecoder.mapsAsObjects) {
              let object = {};
              let i2 = 0;
              if (currentDecoder.keyMap) {
                while ((key = read()) != STOP_CODE) {
                  if (i2++ >= maxMapSize) throw new Error(`Property count exceeds ${maxMapSize}`);
                  object[safeKey(currentDecoder.decodeKey(key))] = read();
                }
              } else {
                while ((key = read()) != STOP_CODE) {
                  if (i2++ >= maxMapSize) throw new Error(`Property count exceeds ${maxMapSize}`);
                  object[safeKey(key)] = read();
                }
              }
              return object;
            } else {
              if (restoreMapsAsObject) {
                currentDecoder.mapsAsObjects = true;
                restoreMapsAsObject = false;
              }
              let map = /* @__PURE__ */ new Map();
              if (currentDecoder.keyMap) {
                let i2 = 0;
                while ((key = read()) != STOP_CODE) {
                  if (i2++ >= maxMapSize) {
                    throw new Error(`Map size exceeds ${maxMapSize}`);
                  }
                  map.set(currentDecoder.decodeKey(key), read());
                }
              } else {
                let i2 = 0;
                while ((key = read()) != STOP_CODE) {
                  if (i2++ >= maxMapSize) {
                    throw new Error(`Map size exceeds ${maxMapSize}`);
                  }
                  map.set(key, read());
                }
              }
              return map;
            }
          case 7:
            return STOP_CODE;
          default:
            throw new Error("Invalid major type for indefinite length " + majorType);
        }
      default:
        throw new Error("Unknown token " + token);
    }
  }
  switch (majorType) {
    case 0:
      return token;
    case 1:
      return ~token;
    case 2:
      return readBin(token);
    case 3:
      if (srcStringEnd >= position) {
        return srcString.slice(position - srcStringStart, (position += token) - srcStringStart);
      }
      if (srcStringEnd == 0 && srcEnd < 140 && token < 32) {
        let string = token < 16 ? shortStringInJS(token) : longStringInJS(token);
        if (string != null)
          return string;
      }
      return readFixedString(token);
    case 4:
      if (token >= maxArraySize) throw new Error(`Array length exceeds ${maxArraySize}`);
      let array = new Array(token);
      for (let i = 0; i < token; i++) array[i] = read();
      return array;
    case 5:
      if (token >= maxMapSize) throw new Error(`Map size exceeds ${maxArraySize}`);
      if (currentDecoder.mapsAsObjects) {
        let object = {};
        if (currentDecoder.keyMap) for (let i = 0; i < token; i++) object[safeKey(currentDecoder.decodeKey(read()))] = read();
        else for (let i = 0; i < token; i++) object[safeKey(read())] = read();
        return object;
      } else {
        if (restoreMapsAsObject) {
          currentDecoder.mapsAsObjects = true;
          restoreMapsAsObject = false;
        }
        let map = /* @__PURE__ */ new Map();
        if (currentDecoder.keyMap) for (let i = 0; i < token; i++) map.set(currentDecoder.decodeKey(read()), read());
        else for (let i = 0; i < token; i++) map.set(read(), read());
        return map;
      }
    case 6:
      if (token >= BUNDLED_STRINGS_ID) {
        let structure = currentStructures[token & 8191];
        if (structure) {
          if (!structure.read) structure.read = createStructureReader(structure);
          return structure.read();
        }
        if (token < 65536) {
          if (token == RECORD_INLINE_ID) {
            let length = readJustLength();
            let id = read();
            let structure2 = read();
            recordDefinition(id, structure2);
            let object = {};
            if (currentDecoder.keyMap) for (let i = 2; i < length; i++) {
              let key = currentDecoder.decodeKey(structure2[i - 2]);
              object[safeKey(key)] = read();
            }
            else for (let i = 2; i < length; i++) {
              let key = structure2[i - 2];
              object[safeKey(key)] = read();
            }
            return object;
          } else if (token == RECORD_DEFINITIONS_ID) {
            let length = readJustLength();
            let id = read();
            for (let i = 2; i < length; i++) {
              recordDefinition(id++, read());
            }
            return read();
          } else if (token == BUNDLED_STRINGS_ID) {
            return readBundleExt();
          }
          if (currentDecoder.getShared) {
            loadShared();
            structure = currentStructures[token & 8191];
            if (structure) {
              if (!structure.read)
                structure.read = createStructureReader(structure);
              return structure.read();
            }
          }
        }
      }
      let extension = currentExtensions[token];
      if (extension) {
        if (extension.handlesRead)
          return extension(read);
        else
          return extension(read());
      } else {
        let input = read();
        for (let i = 0; i < currentExtensionRanges.length; i++) {
          let value = currentExtensionRanges[i](token, input);
          if (value !== void 0)
            return value;
        }
        return new Tag(input, token);
      }
    case 7:
      switch (token) {
        case 20:
          return false;
        case 21:
          return true;
        case 22:
          return null;
        case 23:
          return;
        // undefined
        case 31:
        default:
          let packedValue = (packedValues || getPackedValues())[token];
          if (packedValue !== void 0)
            return packedValue;
          throw new Error("Unknown token " + token);
      }
    default:
      if (isNaN(token)) {
        let error = new Error("Unexpected end of CBOR data");
        error.incomplete = true;
        throw error;
      }
      throw new Error("Unknown CBOR token " + token);
  }
}
var validName = /^[a-zA-Z_$][a-zA-Z\d_$]*$/;
function createStructureReader(structure) {
  if (!structure) throw new Error("Structure is required in record definition");
  function readObject() {
    let length = src[position++];
    length = length & 31;
    if (length > 23) {
      switch (length) {
        case 24:
          length = src[position++];
          break;
        case 25:
          length = dataView.getUint16(position);
          position += 2;
          break;
        case 26:
          length = dataView.getUint32(position);
          position += 4;
          break;
        default:
          throw new Error("Expected array header, but got " + src[position - 1]);
      }
    }
    let compiledReader = this.compiledReader;
    while (compiledReader) {
      if (compiledReader.propertyCount === length)
        return compiledReader(read);
      compiledReader = compiledReader.next;
    }
    if (this.slowReads++ >= inlineObjectReadThreshold) {
      let array = this.length == length ? this : this.slice(0, length);
      compiledReader = currentDecoder.keyMap ? new Function("r", "return {" + array.map((k) => currentDecoder.decodeKey(k)).map((k) => validName.test(k) ? safeKey(k) + ":r()" : "[" + JSON.stringify(k) + "]:r()").join(",") + "}") : new Function("r", "return {" + array.map((key) => validName.test(key) ? safeKey(key) + ":r()" : "[" + JSON.stringify(key) + "]:r()").join(",") + "}");
      if (this.compiledReader)
        compiledReader.next = this.compiledReader;
      compiledReader.propertyCount = length;
      this.compiledReader = compiledReader;
      return compiledReader(read);
    }
    let object = {};
    if (currentDecoder.keyMap) for (let i = 0; i < length; i++) object[safeKey(currentDecoder.decodeKey(this[i]))] = read();
    else for (let i = 0; i < length; i++) {
      object[safeKey(this[i])] = read();
    }
    return object;
  }
  structure.slowReads = 0;
  return readObject;
}
function safeKey(key) {
  if (typeof key === "string") return key === "__proto__" ? "__proto_" : key;
  if (typeof key === "number" || typeof key === "boolean" || typeof key === "bigint") return key.toString();
  if (key == null) return key + "";
  throw new Error("Invalid property name type " + typeof key);
}
var readFixedString = readStringJS;
function readStringJS(length) {
  let result;
  if (length < 16) {
    if (result = shortStringInJS(length))
      return result;
  }
  if (length > 64 && decoder)
    return decoder.decode(src.subarray(position, position += length));
  const end = position + length;
  const units = [];
  result = "";
  while (position < end) {
    const byte1 = src[position++];
    if ((byte1 & 128) === 0) {
      units.push(byte1);
    } else if ((byte1 & 224) === 192) {
      const byte2 = src[position++] & 63;
      units.push((byte1 & 31) << 6 | byte2);
    } else if ((byte1 & 240) === 224) {
      const byte2 = src[position++] & 63;
      const byte3 = src[position++] & 63;
      units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
    } else if ((byte1 & 248) === 240) {
      const byte2 = src[position++] & 63;
      const byte3 = src[position++] & 63;
      const byte4 = src[position++] & 63;
      let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
      if (unit > 65535) {
        unit -= 65536;
        units.push(unit >>> 10 & 1023 | 55296);
        unit = 56320 | unit & 1023;
      }
      units.push(unit);
    } else {
      units.push(byte1);
    }
    if (units.length >= 4096) {
      result += fromCharCode.apply(String, units);
      units.length = 0;
    }
  }
  if (units.length > 0) {
    result += fromCharCode.apply(String, units);
  }
  return result;
}
var fromCharCode = String.fromCharCode;
function longStringInJS(length) {
  let start = position;
  let bytes = new Array(length);
  for (let i = 0; i < length; i++) {
    const byte = src[position++];
    if ((byte & 128) > 0) {
      position = start;
      return;
    }
    bytes[i] = byte;
  }
  return fromCharCode.apply(String, bytes);
}
function shortStringInJS(length) {
  if (length < 4) {
    if (length < 2) {
      if (length === 0)
        return "";
      else {
        let a = src[position++];
        if ((a & 128) > 1) {
          position -= 1;
          return;
        }
        return fromCharCode(a);
      }
    } else {
      let a = src[position++];
      let b = src[position++];
      if ((a & 128) > 0 || (b & 128) > 0) {
        position -= 2;
        return;
      }
      if (length < 3)
        return fromCharCode(a, b);
      let c = src[position++];
      if ((c & 128) > 0) {
        position -= 3;
        return;
      }
      return fromCharCode(a, b, c);
    }
  } else {
    let a = src[position++];
    let b = src[position++];
    let c = src[position++];
    let d = src[position++];
    if ((a & 128) > 0 || (b & 128) > 0 || (c & 128) > 0 || (d & 128) > 0) {
      position -= 4;
      return;
    }
    if (length < 6) {
      if (length === 4)
        return fromCharCode(a, b, c, d);
      else {
        let e = src[position++];
        if ((e & 128) > 0) {
          position -= 5;
          return;
        }
        return fromCharCode(a, b, c, d, e);
      }
    } else if (length < 8) {
      let e = src[position++];
      let f = src[position++];
      if ((e & 128) > 0 || (f & 128) > 0) {
        position -= 6;
        return;
      }
      if (length < 7)
        return fromCharCode(a, b, c, d, e, f);
      let g = src[position++];
      if ((g & 128) > 0) {
        position -= 7;
        return;
      }
      return fromCharCode(a, b, c, d, e, f, g);
    } else {
      let e = src[position++];
      let f = src[position++];
      let g = src[position++];
      let h = src[position++];
      if ((e & 128) > 0 || (f & 128) > 0 || (g & 128) > 0 || (h & 128) > 0) {
        position -= 8;
        return;
      }
      if (length < 10) {
        if (length === 8)
          return fromCharCode(a, b, c, d, e, f, g, h);
        else {
          let i = src[position++];
          if ((i & 128) > 0) {
            position -= 9;
            return;
          }
          return fromCharCode(a, b, c, d, e, f, g, h, i);
        }
      } else if (length < 12) {
        let i = src[position++];
        let j = src[position++];
        if ((i & 128) > 0 || (j & 128) > 0) {
          position -= 10;
          return;
        }
        if (length < 11)
          return fromCharCode(a, b, c, d, e, f, g, h, i, j);
        let k = src[position++];
        if ((k & 128) > 0) {
          position -= 11;
          return;
        }
        return fromCharCode(a, b, c, d, e, f, g, h, i, j, k);
      } else {
        let i = src[position++];
        let j = src[position++];
        let k = src[position++];
        let l = src[position++];
        if ((i & 128) > 0 || (j & 128) > 0 || (k & 128) > 0 || (l & 128) > 0) {
          position -= 12;
          return;
        }
        if (length < 14) {
          if (length === 12)
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l);
          else {
            let m = src[position++];
            if ((m & 128) > 0) {
              position -= 13;
              return;
            }
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m);
          }
        } else {
          let m = src[position++];
          let n = src[position++];
          if ((m & 128) > 0 || (n & 128) > 0) {
            position -= 14;
            return;
          }
          if (length < 15)
            return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n);
          let o = src[position++];
          if ((o & 128) > 0) {
            position -= 15;
            return;
          }
          return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o);
        }
      }
    }
  }
}
function readBin(length) {
  return currentDecoder.copyBuffers ? (
    // specifically use the copying slice (not the node one)
    Uint8Array.prototype.slice.call(src, position, position += length)
  ) : src.subarray(position, position += length);
}
var f32Array = new Float32Array(1);
var u8Array = new Uint8Array(f32Array.buffer, 0, 4);
function getFloat16() {
  let byte0 = src[position++];
  let byte1 = src[position++];
  let exponent = (byte0 & 127) >> 2;
  if (exponent === 31) {
    if (byte1 || byte0 & 3)
      return NaN;
    return byte0 & 128 ? -Infinity : Infinity;
  }
  if (exponent === 0) {
    let abs = ((byte0 & 3) << 8 | byte1) / (1 << 24);
    return byte0 & 128 ? -abs : abs;
  }
  u8Array[3] = byte0 & 128 | // sign bit
  (exponent >> 1) + 56;
  u8Array[2] = (byte0 & 7) << 5 | // last exponent bit and first two mantissa bits
  byte1 >> 3;
  u8Array[1] = byte1 << 5;
  u8Array[0] = 0;
  return f32Array[0];
}
var keyCache = new Array(4096);
var Tag = class {
  constructor(value, tag) {
    this.value = value;
    this.tag = tag;
  }
};
currentExtensions[0] = (dateString) => {
  return new Date(dateString);
};
currentExtensions[1] = (epochSec) => {
  return new Date(Math.round(epochSec * 1e3));
};
currentExtensions[2] = (buffer) => {
  let value = BigInt(0);
  for (let i = 0, l = buffer.byteLength; i < l; i++) {
    value = BigInt(buffer[i]) + (value << BigInt(8));
  }
  return value;
};
currentExtensions[3] = (buffer) => {
  return BigInt(-1) - currentExtensions[2](buffer);
};
currentExtensions[4] = (fraction) => {
  return +(fraction[1] + "e" + fraction[0]);
};
currentExtensions[5] = (fraction) => {
  return fraction[1] * Math.exp(fraction[0] * Math.log(2));
};
var recordDefinition = (id, structure) => {
  id = id - 57344;
  let existingStructure = currentStructures[id];
  if (existingStructure && existingStructure.isShared) {
    (currentStructures.restoreStructures || (currentStructures.restoreStructures = []))[id] = existingStructure;
  }
  currentStructures[id] = structure;
  structure.read = createStructureReader(structure);
};
currentExtensions[LEGACY_RECORD_INLINE_ID] = (data) => {
  let length = data.length;
  let structure = data[1];
  recordDefinition(data[0], structure);
  let object = {};
  for (let i = 2; i < length; i++) {
    let key = structure[i - 2];
    object[safeKey(key)] = data[i];
  }
  return object;
};
currentExtensions[14] = (value) => {
  if (bundledStrings)
    return bundledStrings[0].slice(bundledStrings.position0, bundledStrings.position0 += value);
  return new Tag(value, 14);
};
currentExtensions[15] = (value) => {
  if (bundledStrings)
    return bundledStrings[1].slice(bundledStrings.position1, bundledStrings.position1 += value);
  return new Tag(value, 15);
};
var glbl = { Error, RegExp };
currentExtensions[27] = (data) => {
  return (glbl[data[0]] || Error)(data[1], data[2]);
};
var packedTable = (read2) => {
  if (src[position++] != 132) {
    let error = new Error("Packed values structure must be followed by a 4 element array");
    if (src.length < position)
      error.incomplete = true;
    throw error;
  }
  let newPackedValues = read2();
  if (!newPackedValues || !newPackedValues.length) {
    let error = new Error("Packed values structure must be followed by a 4 element array");
    error.incomplete = true;
    throw error;
  }
  packedValues = packedValues ? newPackedValues.concat(packedValues.slice(newPackedValues.length)) : newPackedValues;
  packedValues.prefixes = read2();
  packedValues.suffixes = read2();
  return read2();
};
packedTable.handlesRead = true;
currentExtensions[51] = packedTable;
currentExtensions[PACKED_REFERENCE_TAG_ID] = (data) => {
  if (!packedValues) {
    if (currentDecoder.getShared)
      loadShared();
    else
      return new Tag(data, PACKED_REFERENCE_TAG_ID);
  }
  if (typeof data == "number")
    return packedValues[16 + (data >= 0 ? 2 * data : -2 * data - 1)];
  let error = new Error("No support for non-integer packed references yet");
  if (data === void 0)
    error.incomplete = true;
  throw error;
};
currentExtensions[28] = (read2) => {
  if (!referenceMap) {
    referenceMap = /* @__PURE__ */ new Map();
    referenceMap.id = 0;
  }
  let id = referenceMap.id++;
  let startingPosition = position;
  let token = src[position];
  let target2;
  if (token >> 5 == 4)
    target2 = [];
  else
    target2 = {};
  let refEntry = { target: target2 };
  referenceMap.set(id, refEntry);
  let targetProperties = read2();
  if (refEntry.used) {
    if (Object.getPrototypeOf(target2) !== Object.getPrototypeOf(targetProperties)) {
      position = startingPosition;
      target2 = targetProperties;
      referenceMap.set(id, { target: target2 });
      targetProperties = read2();
    }
    return Object.assign(target2, targetProperties);
  }
  refEntry.target = targetProperties;
  return targetProperties;
};
currentExtensions[28].handlesRead = true;
currentExtensions[29] = (id) => {
  let refEntry = referenceMap.get(id);
  refEntry.used = true;
  return refEntry.target;
};
currentExtensions[258] = (array) => new Set(array);
(currentExtensions[259] = (read2) => {
  if (currentDecoder.mapsAsObjects) {
    currentDecoder.mapsAsObjects = false;
    restoreMapsAsObject = true;
  }
  return read2();
}).handlesRead = true;
function combine(a, b) {
  if (typeof a === "string")
    return a + b;
  if (a instanceof Array)
    return a.concat(b);
  return Object.assign({}, a, b);
}
function getPackedValues() {
  if (!packedValues) {
    if (currentDecoder.getShared)
      loadShared();
    else
      throw new Error("No packed values available");
  }
  return packedValues;
}
var SHARED_DATA_TAG_ID = 1399353956;
currentExtensionRanges.push((tag, input) => {
  if (tag >= 225 && tag <= 255)
    return combine(getPackedValues().prefixes[tag - 224], input);
  if (tag >= 28704 && tag <= 32767)
    return combine(getPackedValues().prefixes[tag - 28672], input);
  if (tag >= 1879052288 && tag <= 2147483647)
    return combine(getPackedValues().prefixes[tag - 1879048192], input);
  if (tag >= 216 && tag <= 223)
    return combine(input, getPackedValues().suffixes[tag - 216]);
  if (tag >= 27647 && tag <= 28671)
    return combine(input, getPackedValues().suffixes[tag - 27639]);
  if (tag >= 1811940352 && tag <= 1879048191)
    return combine(input, getPackedValues().suffixes[tag - 1811939328]);
  if (tag == SHARED_DATA_TAG_ID) {
    return {
      packedValues,
      structures: currentStructures.slice(0),
      version: input
    };
  }
  if (tag == 55799)
    return input;
});
var isLittleEndianMachine = new Uint8Array(new Uint16Array([1]).buffer)[0] == 1;
var typedArrays = [
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  typeof BigUint64Array == "undefined" ? { name: "BigUint64Array" } : BigUint64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  typeof BigInt64Array == "undefined" ? { name: "BigInt64Array" } : BigInt64Array,
  Float32Array,
  Float64Array
];
var typedArrayTags = [64, 68, 69, 70, 71, 72, 77, 78, 79, 85, 86];
for (let i = 0; i < typedArrays.length; i++) {
  registerTypedArray(typedArrays[i], typedArrayTags[i]);
}
function registerTypedArray(TypedArray, tag) {
  let dvMethod = "get" + TypedArray.name.slice(0, -5);
  let bytesPerElement;
  if (typeof TypedArray === "function")
    bytesPerElement = TypedArray.BYTES_PER_ELEMENT;
  else
    TypedArray = null;
  for (let littleEndian = 0; littleEndian < 2; littleEndian++) {
    if (!littleEndian && bytesPerElement == 1)
      continue;
    let sizeShift = bytesPerElement == 2 ? 1 : bytesPerElement == 4 ? 2 : bytesPerElement == 8 ? 3 : 0;
    currentExtensions[littleEndian ? tag : tag - 4] = bytesPerElement == 1 || littleEndian == isLittleEndianMachine ? (buffer) => {
      if (!TypedArray)
        throw new Error("Could not find typed array for code " + tag);
      if (!currentDecoder.copyBuffers) {
        if (bytesPerElement === 1 || bytesPerElement === 2 && !(buffer.byteOffset & 1) || bytesPerElement === 4 && !(buffer.byteOffset & 3) || bytesPerElement === 8 && !(buffer.byteOffset & 7))
          return new TypedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength >> sizeShift);
      }
      return new TypedArray(Uint8Array.prototype.slice.call(buffer, 0).buffer);
    } : (buffer) => {
      if (!TypedArray)
        throw new Error("Could not find typed array for code " + tag);
      let dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      let elements = buffer.length >> sizeShift;
      let ta = new TypedArray(elements);
      let method = dv[dvMethod];
      for (let i = 0; i < elements; i++) {
        ta[i] = method.call(dv, i << sizeShift, littleEndian);
      }
      return ta;
    };
  }
}
function readBundleExt() {
  let length = readJustLength();
  let bundlePosition = position + read();
  for (let i = 2; i < length; i++) {
    let bundleLength = readJustLength();
    position += bundleLength;
  }
  let dataPosition = position;
  position = bundlePosition;
  bundledStrings = [readStringJS(readJustLength()), readStringJS(readJustLength())];
  bundledStrings.position0 = 0;
  bundledStrings.position1 = 0;
  bundledStrings.postBundlePosition = position;
  position = dataPosition;
  return read();
}
function readJustLength() {
  let token = src[position++] & 31;
  if (token > 23) {
    switch (token) {
      case 24:
        token = src[position++];
        break;
      case 25:
        token = dataView.getUint16(position);
        position += 2;
        break;
      case 26:
        token = dataView.getUint32(position);
        position += 4;
        break;
    }
  }
  return token;
}
function loadShared() {
  if (currentDecoder.getShared) {
    let sharedData = saveState(() => {
      src = null;
      return currentDecoder.getShared();
    }) || {};
    let updatedStructures = sharedData.structures || [];
    currentDecoder.sharedVersion = sharedData.version;
    packedValues = currentDecoder.sharedValues = sharedData.packedValues;
    if (currentStructures === true)
      currentDecoder.structures = currentStructures = updatedStructures;
    else
      currentStructures.splice.apply(currentStructures, [0, updatedStructures.length].concat(updatedStructures));
  }
}
function saveState(callback) {
  let savedSrcEnd = srcEnd;
  let savedPosition = position;
  let savedStringPosition = stringPosition;
  let savedSrcStringStart = srcStringStart;
  let savedSrcStringEnd = srcStringEnd;
  let savedSrcString = srcString;
  let savedStrings = strings;
  let savedReferenceMap = referenceMap;
  let savedBundledStrings = bundledStrings;
  let savedSrc = new Uint8Array(src.slice(0, srcEnd));
  let savedStructures = currentStructures;
  let savedDecoder = currentDecoder;
  let savedSequentialMode = sequentialMode;
  let value = callback();
  srcEnd = savedSrcEnd;
  position = savedPosition;
  stringPosition = savedStringPosition;
  srcStringStart = savedSrcStringStart;
  srcStringEnd = savedSrcStringEnd;
  srcString = savedSrcString;
  strings = savedStrings;
  referenceMap = savedReferenceMap;
  bundledStrings = savedBundledStrings;
  src = savedSrc;
  sequentialMode = savedSequentialMode;
  currentStructures = savedStructures;
  currentDecoder = savedDecoder;
  dataView = new DataView(src.buffer, src.byteOffset, src.byteLength);
  return value;
}
function clearSource() {
  src = null;
  referenceMap = null;
  currentStructures = null;
}
var mult10 = new Array(147);
for (let i = 0; i < 256; i++) {
  mult10[i] = +("1e" + Math.floor(45.15 - i * 0.30103));
}
var defaultDecoder = new Decoder({ useRecords: false });
var decode = defaultDecoder.decode;
var decodeMultiple = defaultDecoder.decodeMultiple;
var FLOAT32_OPTIONS = {
  NEVER: 0,
  ALWAYS: 1,
  DECIMAL_ROUND: 3,
  DECIMAL_FIT: 4
};

// ../node_modules/cbor-x/encode.js
var textEncoder;
try {
  textEncoder = new TextEncoder();
} catch (error) {
}
var extensions;
var extensionClasses;
var Buffer2 = typeof globalThis === "object" && globalThis.Buffer;
var hasNodeBuffer = typeof Buffer2 !== "undefined";
var ByteArrayAllocate = hasNodeBuffer ? Buffer2.allocUnsafeSlow : Uint8Array;
var ByteArray = hasNodeBuffer ? Buffer2 : Uint8Array;
var MAX_STRUCTURES = 256;
var MAX_BUFFER_SIZE = hasNodeBuffer ? 4294967296 : 2144337920;
var throwOnIterable;
var target;
var targetView;
var position2 = 0;
var safeEnd;
var bundledStrings2 = null;
var MAX_BUNDLE_SIZE = 61440;
var hasNonLatin = /[\u0080-\uFFFF]/;
var RECORD_SYMBOL = Symbol("record-id");
var Encoder = class extends Decoder {
  constructor(options) {
    super(options);
    this.offset = 0;
    let typeBuffer;
    let start;
    let sharedStructures;
    let hasSharedUpdate;
    let structures;
    let referenceMap2;
    options = options || {};
    let encodeUtf8 = ByteArray.prototype.utf8Write ? function(string, position3, maxBytes) {
      return target.utf8Write(string, position3, maxBytes);
    } : textEncoder && textEncoder.encodeInto ? function(string, position3) {
      return textEncoder.encodeInto(string, target.subarray(position3)).written;
    } : false;
    let encoder = this;
    let hasSharedStructures = options.structures || options.saveStructures;
    let maxSharedStructures = options.maxSharedStructures;
    if (maxSharedStructures == null)
      maxSharedStructures = hasSharedStructures ? 128 : 0;
    if (maxSharedStructures > 8190)
      throw new Error("Maximum maxSharedStructure is 8190");
    let isSequential = options.sequential;
    if (isSequential) {
      maxSharedStructures = 0;
    }
    if (!this.structures)
      this.structures = [];
    if (this.saveStructures)
      this.saveShared = this.saveStructures;
    let samplingPackedValues, packedObjectMap2, sharedValues = options.sharedValues;
    let sharedPackedObjectMap2;
    if (sharedValues) {
      sharedPackedObjectMap2 = /* @__PURE__ */ Object.create(null);
      for (let i = 0, l = sharedValues.length; i < l; i++) {
        sharedPackedObjectMap2[sharedValues[i]] = i;
      }
    }
    let recordIdsToRemove = [];
    let transitionsCount = 0;
    let serializationsSinceTransitionRebuild = 0;
    this.mapEncode = function(value, encodeOptions) {
      if (this._keyMap && !this._mapped) {
        switch (value.constructor.name) {
          case "Array":
            value = value.map((r) => this.encodeKeys(r));
            break;
        }
      }
      return this.encode(value, encodeOptions);
    };
    this.encode = function(value, encodeOptions) {
      if (!target) {
        target = new ByteArrayAllocate(8192);
        targetView = new DataView(target.buffer, 0, 8192);
        position2 = 0;
      }
      safeEnd = target.length - 10;
      if (safeEnd - position2 < 2048) {
        target = new ByteArrayAllocate(target.length);
        targetView = new DataView(target.buffer, 0, target.length);
        safeEnd = target.length - 10;
        position2 = 0;
      } else if (encodeOptions === REUSE_BUFFER_MODE)
        position2 = position2 + 7 & 2147483640;
      start = position2;
      if (encoder.useSelfDescribedHeader) {
        targetView.setUint32(position2, 3654940416);
        position2 += 3;
      }
      referenceMap2 = encoder.structuredClone ? /* @__PURE__ */ new Map() : null;
      if (encoder.bundleStrings && typeof value !== "string") {
        bundledStrings2 = [];
        bundledStrings2.size = Infinity;
      } else
        bundledStrings2 = null;
      sharedStructures = encoder.structures;
      if (sharedStructures) {
        if (sharedStructures.uninitialized) {
          let sharedData = encoder.getShared() || {};
          encoder.structures = sharedStructures = sharedData.structures || [];
          encoder.sharedVersion = sharedData.version;
          let sharedValues2 = encoder.sharedValues = sharedData.packedValues;
          if (sharedValues2) {
            sharedPackedObjectMap2 = {};
            for (let i = 0, l = sharedValues2.length; i < l; i++)
              sharedPackedObjectMap2[sharedValues2[i]] = i;
          }
        }
        let sharedStructuresLength = sharedStructures.length;
        if (sharedStructuresLength > maxSharedStructures && !isSequential)
          sharedStructuresLength = maxSharedStructures;
        if (!sharedStructures.transitions) {
          sharedStructures.transitions = /* @__PURE__ */ Object.create(null);
          for (let i = 0; i < sharedStructuresLength; i++) {
            let keys = sharedStructures[i];
            if (!keys)
              continue;
            let nextTransition, transition = sharedStructures.transitions;
            for (let j = 0, l = keys.length; j < l; j++) {
              if (transition[RECORD_SYMBOL] === void 0)
                transition[RECORD_SYMBOL] = i;
              let key = keys[j];
              nextTransition = transition[key];
              if (!nextTransition) {
                nextTransition = transition[key] = /* @__PURE__ */ Object.create(null);
              }
              transition = nextTransition;
            }
            transition[RECORD_SYMBOL] = i | 1048576;
          }
        }
        if (!isSequential)
          sharedStructures.nextId = sharedStructuresLength;
      }
      if (hasSharedUpdate)
        hasSharedUpdate = false;
      structures = sharedStructures || [];
      packedObjectMap2 = sharedPackedObjectMap2;
      if (options.pack) {
        let packedValues2 = /* @__PURE__ */ new Map();
        packedValues2.values = [];
        packedValues2.encoder = encoder;
        packedValues2.maxValues = options.maxPrivatePackedValues || (sharedPackedObjectMap2 ? 16 : Infinity);
        packedValues2.objectMap = sharedPackedObjectMap2 || false;
        packedValues2.samplingPackedValues = samplingPackedValues;
        findRepetitiveStrings(value, packedValues2);
        if (packedValues2.values.length > 0) {
          target[position2++] = 216;
          target[position2++] = 51;
          writeArrayHeader(4);
          let valuesArray = packedValues2.values;
          encode2(valuesArray);
          writeArrayHeader(0);
          writeArrayHeader(0);
          packedObjectMap2 = Object.create(sharedPackedObjectMap2 || null);
          for (let i = 0, l = valuesArray.length; i < l; i++) {
            packedObjectMap2[valuesArray[i]] = i;
          }
        }
      }
      throwOnIterable = encodeOptions & THROW_ON_ITERABLE;
      try {
        if (throwOnIterable)
          return;
        encode2(value);
        if (bundledStrings2) {
          writeBundles(start, encode2);
        }
        encoder.offset = position2;
        if (referenceMap2 && referenceMap2.idsToInsert) {
          position2 += referenceMap2.idsToInsert.length * 2;
          if (position2 > safeEnd)
            makeRoom(position2);
          encoder.offset = position2;
          let serialized = insertIds(target.subarray(start, position2), referenceMap2.idsToInsert);
          referenceMap2 = null;
          return serialized;
        }
        if (encodeOptions & REUSE_BUFFER_MODE) {
          target.start = start;
          target.end = position2;
          return target;
        }
        return target.subarray(start, position2);
      } finally {
        if (sharedStructures) {
          if (serializationsSinceTransitionRebuild < 10)
            serializationsSinceTransitionRebuild++;
          if (sharedStructures.length > maxSharedStructures)
            sharedStructures.length = maxSharedStructures;
          if (transitionsCount > 1e4) {
            sharedStructures.transitions = null;
            serializationsSinceTransitionRebuild = 0;
            transitionsCount = 0;
            if (recordIdsToRemove.length > 0)
              recordIdsToRemove = [];
          } else if (recordIdsToRemove.length > 0 && !isSequential) {
            for (let i = 0, l = recordIdsToRemove.length; i < l; i++) {
              recordIdsToRemove[i][RECORD_SYMBOL] = void 0;
            }
            recordIdsToRemove = [];
          }
        }
        if (hasSharedUpdate && encoder.saveShared) {
          if (encoder.structures.length > maxSharedStructures) {
            encoder.structures = encoder.structures.slice(0, maxSharedStructures);
          }
          let returnBuffer = target.subarray(start, position2);
          if (encoder.updateSharedData() === false)
            return encoder.encode(value);
          return returnBuffer;
        }
        if (encodeOptions & RESET_BUFFER_MODE)
          position2 = start;
      }
    };
    this.findCommonStringsToPack = () => {
      samplingPackedValues = /* @__PURE__ */ new Map();
      if (!sharedPackedObjectMap2)
        sharedPackedObjectMap2 = /* @__PURE__ */ Object.create(null);
      return (options2) => {
        let threshold = options2 && options2.threshold || 4;
        let position3 = this.pack ? options2.maxPrivatePackedValues || 16 : 0;
        if (!sharedValues)
          sharedValues = this.sharedValues = [];
        for (let [key, status] of samplingPackedValues) {
          if (status.count > threshold) {
            sharedPackedObjectMap2[key] = position3++;
            sharedValues.push(key);
            hasSharedUpdate = true;
          }
        }
        while (this.saveShared && this.updateSharedData() === false) {
        }
        samplingPackedValues = null;
      };
    };
    const encode2 = (value) => {
      if (position2 > safeEnd)
        target = makeRoom(position2);
      var type = typeof value;
      var length;
      if (type === "string") {
        if (packedObjectMap2) {
          let packedPosition = packedObjectMap2[value];
          if (packedPosition >= 0) {
            if (packedPosition < 16)
              target[position2++] = packedPosition + 224;
            else {
              target[position2++] = 198;
              if (packedPosition & 1)
                encode2(15 - packedPosition >> 1);
              else
                encode2(packedPosition - 16 >> 1);
            }
            return;
          } else if (samplingPackedValues && !options.pack) {
            let status = samplingPackedValues.get(value);
            if (status)
              status.count++;
            else
              samplingPackedValues.set(value, {
                count: 1
              });
          }
        }
        let strLength = value.length;
        if (bundledStrings2 && strLength >= 4 && strLength < 1024) {
          if ((bundledStrings2.size += strLength) > MAX_BUNDLE_SIZE) {
            let extStart;
            let maxBytes2 = (bundledStrings2[0] ? bundledStrings2[0].length * 3 + bundledStrings2[1].length : 0) + 10;
            if (position2 + maxBytes2 > safeEnd)
              target = makeRoom(position2 + maxBytes2);
            target[position2++] = 217;
            target[position2++] = 223;
            target[position2++] = 249;
            target[position2++] = bundledStrings2.position ? 132 : 130;
            target[position2++] = 26;
            extStart = position2 - start;
            position2 += 4;
            if (bundledStrings2.position) {
              writeBundles(start, encode2);
            }
            bundledStrings2 = ["", ""];
            bundledStrings2.size = 0;
            bundledStrings2.position = extStart;
          }
          let twoByte = hasNonLatin.test(value);
          bundledStrings2[twoByte ? 0 : 1] += value;
          target[position2++] = twoByte ? 206 : 207;
          encode2(strLength);
          return;
        }
        let headerSize;
        if (strLength < 32) {
          headerSize = 1;
        } else if (strLength < 256) {
          headerSize = 2;
        } else if (strLength < 65536) {
          headerSize = 3;
        } else {
          headerSize = 5;
        }
        let maxBytes = strLength * 3;
        if (position2 + maxBytes > safeEnd)
          target = makeRoom(position2 + maxBytes);
        if (strLength < 64 || !encodeUtf8) {
          let i, c1, c2, strPosition = position2 + headerSize;
          for (i = 0; i < strLength; i++) {
            c1 = value.charCodeAt(i);
            if (c1 < 128) {
              target[strPosition++] = c1;
            } else if (c1 < 2048) {
              target[strPosition++] = c1 >> 6 | 192;
              target[strPosition++] = c1 & 63 | 128;
            } else if ((c1 & 64512) === 55296 && ((c2 = value.charCodeAt(i + 1)) & 64512) === 56320) {
              c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
              i++;
              target[strPosition++] = c1 >> 18 | 240;
              target[strPosition++] = c1 >> 12 & 63 | 128;
              target[strPosition++] = c1 >> 6 & 63 | 128;
              target[strPosition++] = c1 & 63 | 128;
            } else {
              target[strPosition++] = c1 >> 12 | 224;
              target[strPosition++] = c1 >> 6 & 63 | 128;
              target[strPosition++] = c1 & 63 | 128;
            }
          }
          length = strPosition - position2 - headerSize;
        } else {
          length = encodeUtf8(value, position2 + headerSize, maxBytes);
        }
        if (length < 24) {
          target[position2++] = 96 | length;
        } else if (length < 256) {
          if (headerSize < 2) {
            target.copyWithin(position2 + 2, position2 + 1, position2 + 1 + length);
          }
          target[position2++] = 120;
          target[position2++] = length;
        } else if (length < 65536) {
          if (headerSize < 3) {
            target.copyWithin(position2 + 3, position2 + 2, position2 + 2 + length);
          }
          target[position2++] = 121;
          target[position2++] = length >> 8;
          target[position2++] = length & 255;
        } else {
          if (headerSize < 5) {
            target.copyWithin(position2 + 5, position2 + 3, position2 + 3 + length);
          }
          target[position2++] = 122;
          targetView.setUint32(position2, length);
          position2 += 4;
        }
        position2 += length;
      } else if (type === "number") {
        if (!this.alwaysUseFloat && value >>> 0 === value) {
          if (value < 24) {
            target[position2++] = value;
          } else if (value < 256) {
            target[position2++] = 24;
            target[position2++] = value;
          } else if (value < 65536) {
            target[position2++] = 25;
            target[position2++] = value >> 8;
            target[position2++] = value & 255;
          } else {
            target[position2++] = 26;
            targetView.setUint32(position2, value);
            position2 += 4;
          }
        } else if (!this.alwaysUseFloat && value >> 0 === value) {
          if (value >= -24) {
            target[position2++] = 31 - value;
          } else if (value >= -256) {
            target[position2++] = 56;
            target[position2++] = ~value;
          } else if (value >= -65536) {
            target[position2++] = 57;
            targetView.setUint16(position2, ~value);
            position2 += 2;
          } else {
            target[position2++] = 58;
            targetView.setUint32(position2, ~value);
            position2 += 4;
          }
        } else {
          let useFloat32;
          if ((useFloat32 = this.useFloat32) > 0 && value < 4294967296 && value >= -2147483648) {
            target[position2++] = 250;
            targetView.setFloat32(position2, value);
            let xShifted;
            if (useFloat32 < 4 || // this checks for rounding of numbers that were encoded in 32-bit float to nearest significant decimal digit that could be preserved
            (xShifted = value * mult10[(target[position2] & 127) << 1 | target[position2 + 1] >> 7]) >> 0 === xShifted) {
              position2 += 4;
              return;
            } else
              position2--;
          }
          target[position2++] = 251;
          targetView.setFloat64(position2, value);
          position2 += 8;
        }
      } else if (type === "object") {
        if (!value)
          target[position2++] = 246;
        else {
          if (referenceMap2) {
            let referee = referenceMap2.get(value);
            if (referee) {
              target[position2++] = 216;
              target[position2++] = 29;
              target[position2++] = 25;
              if (!referee.references) {
                let idsToInsert = referenceMap2.idsToInsert || (referenceMap2.idsToInsert = []);
                referee.references = [];
                idsToInsert.push(referee);
              }
              referee.references.push(position2 - start);
              position2 += 2;
              return;
            } else
              referenceMap2.set(value, { offset: position2 - start });
          }
          let constructor = value.constructor;
          if (constructor === Object) {
            writeObject(value);
          } else if (constructor === Array) {
            length = value.length;
            if (length < 24) {
              target[position2++] = 128 | length;
            } else {
              writeArrayHeader(length);
            }
            for (let i = 0; i < length; i++) {
              encode2(value[i]);
            }
          } else if (constructor === Map) {
            if (this.mapsAsObjects ? this.useTag259ForMaps !== false : this.useTag259ForMaps) {
              target[position2++] = 217;
              target[position2++] = 1;
              target[position2++] = 3;
            }
            length = value.size;
            if (length < 24) {
              target[position2++] = 160 | length;
            } else if (length < 256) {
              target[position2++] = 184;
              target[position2++] = length;
            } else if (length < 65536) {
              target[position2++] = 185;
              target[position2++] = length >> 8;
              target[position2++] = length & 255;
            } else {
              target[position2++] = 186;
              targetView.setUint32(position2, length);
              position2 += 4;
            }
            if (encoder.keyMap) {
              for (let [key, entryValue] of value) {
                encode2(encoder.encodeKey(key));
                encode2(entryValue);
              }
            } else {
              for (let [key, entryValue] of value) {
                encode2(key);
                encode2(entryValue);
              }
            }
          } else {
            for (let i = 0, l = extensions.length; i < l; i++) {
              let extensionClass = extensionClasses[i];
              if (value instanceof extensionClass) {
                let extension = extensions[i];
                let tag = extension.tag;
                if (tag == void 0)
                  tag = extension.getTag && extension.getTag.call(this, value);
                if (tag < 24) {
                  target[position2++] = 192 | tag;
                } else if (tag < 256) {
                  target[position2++] = 216;
                  target[position2++] = tag;
                } else if (tag < 65536) {
                  target[position2++] = 217;
                  target[position2++] = tag >> 8;
                  target[position2++] = tag & 255;
                } else if (tag > -1) {
                  target[position2++] = 218;
                  targetView.setUint32(position2, tag);
                  position2 += 4;
                }
                extension.encode.call(this, value, encode2, makeRoom);
                return;
              }
            }
            if (value[Symbol.iterator]) {
              if (throwOnIterable) {
                let error = new Error("Iterable should be serialized as iterator");
                error.iteratorNotHandled = true;
                throw error;
              }
              target[position2++] = 159;
              for (let entry of value) {
                encode2(entry);
              }
              target[position2++] = 255;
              return;
            }
            if (value[Symbol.asyncIterator] || isBlob(value)) {
              let error = new Error("Iterable/blob should be serialized as iterator");
              error.iteratorNotHandled = true;
              throw error;
            }
            if (this.useToJSON && value.toJSON) {
              const json = value.toJSON();
              if (json !== value)
                return encode2(json);
            }
            writeObject(value);
          }
        }
      } else if (type === "boolean") {
        target[position2++] = value ? 245 : 244;
      } else if (type === "bigint") {
        if (value < BigInt(1) << BigInt(64) && value >= 0) {
          target[position2++] = 27;
          targetView.setBigUint64(position2, value);
        } else if (value > -(BigInt(1) << BigInt(64)) && value < 0) {
          target[position2++] = 59;
          targetView.setBigUint64(position2, -value - BigInt(1));
        } else {
          if (this.largeBigIntToFloat) {
            target[position2++] = 251;
            targetView.setFloat64(position2, Number(value));
          } else {
            if (value >= BigInt(0))
              target[position2++] = 194;
            else {
              target[position2++] = 195;
              value = BigInt(-1) - value;
            }
            let bytes = [];
            while (value) {
              bytes.push(Number(value & BigInt(255)));
              value >>= BigInt(8);
            }
            writeBuffer(new Uint8Array(bytes.reverse()), makeRoom);
            return;
          }
        }
        position2 += 8;
      } else if (type === "undefined") {
        target[position2++] = 247;
      } else {
        throw new Error("Unknown type: " + type);
      }
    };
    const writeObject = this.useRecords === false ? this.variableMapSize ? (object) => {
      let keys = Object.keys(object);
      let vals = Object.values(object);
      let length = keys.length;
      if (length < 24) {
        target[position2++] = 160 | length;
      } else if (length < 256) {
        target[position2++] = 184;
        target[position2++] = length;
      } else if (length < 65536) {
        target[position2++] = 185;
        target[position2++] = length >> 8;
        target[position2++] = length & 255;
      } else {
        target[position2++] = 186;
        targetView.setUint32(position2, length);
        position2 += 4;
      }
      let key;
      if (encoder.keyMap) {
        for (let i = 0; i < length; i++) {
          encode2(encoder.encodeKey(keys[i]));
          encode2(vals[i]);
        }
      } else {
        for (let i = 0; i < length; i++) {
          encode2(keys[i]);
          encode2(vals[i]);
        }
      }
    } : (object) => {
      target[position2++] = 185;
      let objectOffset = position2 - start;
      position2 += 2;
      let size = 0;
      if (encoder.keyMap) {
        for (let key in object) if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          encode2(encoder.encodeKey(key));
          encode2(object[key]);
          size++;
        }
      } else {
        for (let key in object) if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          encode2(key);
          encode2(object[key]);
          size++;
        }
      }
      target[objectOffset++ + start] = size >> 8;
      target[objectOffset + start] = size & 255;
    } : (object, skipValues) => {
      let nextTransition, transition = structures.transitions || (structures.transitions = /* @__PURE__ */ Object.create(null));
      let newTransitions = 0;
      let length = 0;
      let parentRecordId;
      let keys;
      if (this.keyMap) {
        keys = Object.keys(object).map((k) => this.encodeKey(k));
        length = keys.length;
        for (let i = 0; i < length; i++) {
          let key = keys[i];
          nextTransition = transition[key];
          if (!nextTransition) {
            nextTransition = transition[key] = /* @__PURE__ */ Object.create(null);
            newTransitions++;
          }
          transition = nextTransition;
        }
      } else {
        for (let key in object) if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key)) {
          nextTransition = transition[key];
          if (!nextTransition) {
            if (transition[RECORD_SYMBOL] & 1048576) {
              parentRecordId = transition[RECORD_SYMBOL] & 65535;
            }
            nextTransition = transition[key] = /* @__PURE__ */ Object.create(null);
            newTransitions++;
          }
          transition = nextTransition;
          length++;
        }
      }
      let recordId = transition[RECORD_SYMBOL];
      if (recordId !== void 0) {
        recordId &= 65535;
        target[position2++] = 217;
        target[position2++] = recordId >> 8 | 224;
        target[position2++] = recordId & 255;
      } else {
        if (!keys)
          keys = transition.__keys__ || (transition.__keys__ = Object.keys(object));
        if (parentRecordId === void 0) {
          recordId = structures.nextId++;
          if (!recordId) {
            recordId = 0;
            structures.nextId = 1;
          }
          if (recordId >= MAX_STRUCTURES) {
            structures.nextId = (recordId = maxSharedStructures) + 1;
          }
        } else {
          recordId = parentRecordId;
        }
        structures[recordId] = keys;
        if (recordId < maxSharedStructures) {
          target[position2++] = 217;
          target[position2++] = recordId >> 8 | 224;
          target[position2++] = recordId & 255;
          transition = structures.transitions;
          for (let i = 0; i < length; i++) {
            if (transition[RECORD_SYMBOL] === void 0 || transition[RECORD_SYMBOL] & 1048576)
              transition[RECORD_SYMBOL] = recordId;
            transition = transition[keys[i]];
          }
          transition[RECORD_SYMBOL] = recordId | 1048576;
          hasSharedUpdate = true;
        } else {
          transition[RECORD_SYMBOL] = recordId;
          targetView.setUint32(position2, 3655335680);
          position2 += 3;
          if (newTransitions)
            transitionsCount += serializationsSinceTransitionRebuild * newTransitions;
          if (recordIdsToRemove.length >= MAX_STRUCTURES - maxSharedStructures)
            recordIdsToRemove.shift()[RECORD_SYMBOL] = void 0;
          recordIdsToRemove.push(transition);
          writeArrayHeader(length + 2);
          encode2(57344 + recordId);
          encode2(keys);
          if (skipValues) return;
          for (let key in object)
            if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key))
              encode2(object[key]);
          return;
        }
      }
      if (length < 24) {
        target[position2++] = 128 | length;
      } else {
        writeArrayHeader(length);
      }
      if (skipValues) return;
      for (let key in object)
        if (typeof object.hasOwnProperty !== "function" || object.hasOwnProperty(key))
          encode2(object[key]);
    };
    const makeRoom = (end) => {
      let newSize;
      if (end > 16777216) {
        if (end - start > MAX_BUFFER_SIZE)
          throw new Error("Encoded buffer would be larger than maximum buffer size");
        newSize = Math.min(
          MAX_BUFFER_SIZE,
          Math.round(Math.max((end - start) * (end > 67108864 ? 1.25 : 2), 4194304) / 4096) * 4096
        );
      } else
        newSize = (Math.max(end - start << 2, target.length - 1) >> 12) + 1 << 12;
      let newBuffer = new ByteArrayAllocate(newSize);
      targetView = new DataView(newBuffer.buffer, 0, newSize);
      if (target.copy)
        target.copy(newBuffer, 0, start, end);
      else
        newBuffer.set(target.slice(start, end));
      position2 -= start;
      start = 0;
      safeEnd = newBuffer.length - 10;
      return target = newBuffer;
    };
    let chunkThreshold = 100;
    let continuedChunkThreshold = 1e3;
    this.encodeAsIterable = function(value, options2) {
      return startEncoding(value, options2, encodeObjectAsIterable);
    };
    this.encodeAsAsyncIterable = function(value, options2) {
      return startEncoding(value, options2, encodeObjectAsAsyncIterable);
    };
    function* encodeObjectAsIterable(object, iterateProperties, finalIterable) {
      let constructor = object.constructor;
      if (constructor === Object) {
        let useRecords = encoder.useRecords !== false;
        if (useRecords)
          writeObject(object, true);
        else
          writeEntityLength(Object.keys(object).length, 160);
        for (let key in object) {
          let value = object[key];
          if (!useRecords) encode2(key);
          if (value && typeof value === "object") {
            if (iterateProperties[key])
              yield* encodeObjectAsIterable(value, iterateProperties[key]);
            else
              yield* tryEncode(value, iterateProperties, key);
          } else encode2(value);
        }
      } else if (constructor === Array) {
        let length = object.length;
        writeArrayHeader(length);
        for (let i = 0; i < length; i++) {
          let value = object[i];
          if (value && (typeof value === "object" || position2 - start > chunkThreshold)) {
            if (iterateProperties.element)
              yield* encodeObjectAsIterable(value, iterateProperties.element);
            else
              yield* tryEncode(value, iterateProperties, "element");
          } else encode2(value);
        }
      } else if (object[Symbol.iterator] && !object.buffer) {
        target[position2++] = 159;
        for (let value of object) {
          if (value && (typeof value === "object" || position2 - start > chunkThreshold)) {
            if (iterateProperties.element)
              yield* encodeObjectAsIterable(value, iterateProperties.element);
            else
              yield* tryEncode(value, iterateProperties, "element");
          } else encode2(value);
        }
        target[position2++] = 255;
      } else if (isBlob(object)) {
        writeEntityLength(object.size, 64);
        yield target.subarray(start, position2);
        yield object;
        restartEncoding();
      } else if (object[Symbol.asyncIterator]) {
        target[position2++] = 159;
        yield target.subarray(start, position2);
        yield object;
        restartEncoding();
        target[position2++] = 255;
      } else {
        encode2(object);
      }
      if (finalIterable && position2 > start) yield target.subarray(start, position2);
      else if (position2 - start > chunkThreshold) {
        yield target.subarray(start, position2);
        restartEncoding();
      }
    }
    function* tryEncode(value, iterateProperties, key) {
      let restart = position2 - start;
      try {
        encode2(value);
        if (position2 - start > chunkThreshold) {
          yield target.subarray(start, position2);
          restartEncoding();
        }
      } catch (error) {
        if (error.iteratorNotHandled) {
          iterateProperties[key] = {};
          position2 = start + restart;
          yield* encodeObjectAsIterable.call(this, value, iterateProperties[key]);
        } else throw error;
      }
    }
    function restartEncoding() {
      chunkThreshold = continuedChunkThreshold;
      encoder.encode(null, THROW_ON_ITERABLE);
    }
    function startEncoding(value, options2, encodeIterable) {
      if (options2 && options2.chunkThreshold)
        chunkThreshold = continuedChunkThreshold = options2.chunkThreshold;
      else
        chunkThreshold = 100;
      if (value && typeof value === "object") {
        encoder.encode(null, THROW_ON_ITERABLE);
        return encodeIterable(value, encoder.iterateProperties || (encoder.iterateProperties = {}), true);
      }
      return [encoder.encode(value)];
    }
    async function* encodeObjectAsAsyncIterable(value, iterateProperties) {
      for (let encodedValue of encodeObjectAsIterable(value, iterateProperties, true)) {
        let constructor = encodedValue.constructor;
        if (constructor === ByteArray || constructor === Uint8Array)
          yield encodedValue;
        else if (isBlob(encodedValue)) {
          let reader = encodedValue.stream().getReader();
          let next;
          while (!(next = await reader.read()).done) {
            yield next.value;
          }
        } else if (encodedValue[Symbol.asyncIterator]) {
          for await (let asyncValue of encodedValue) {
            restartEncoding();
            if (asyncValue)
              yield* encodeObjectAsAsyncIterable(asyncValue, iterateProperties.async || (iterateProperties.async = {}));
            else yield encoder.encode(asyncValue);
          }
        } else {
          yield encodedValue;
        }
      }
    }
  }
  useBuffer(buffer) {
    target = buffer;
    targetView = new DataView(target.buffer, target.byteOffset, target.byteLength);
    position2 = 0;
  }
  clearSharedData() {
    if (this.structures)
      this.structures = [];
    if (this.sharedValues)
      this.sharedValues = void 0;
  }
  updateSharedData() {
    let lastVersion = this.sharedVersion || 0;
    this.sharedVersion = lastVersion + 1;
    let structuresCopy = this.structures.slice(0);
    let sharedData = new SharedData(structuresCopy, this.sharedValues, this.sharedVersion);
    let saveResults = this.saveShared(
      sharedData,
      (existingShared) => (existingShared && existingShared.version || 0) == lastVersion
    );
    if (saveResults === false) {
      sharedData = this.getShared() || {};
      this.structures = sharedData.structures || [];
      this.sharedValues = sharedData.packedValues;
      this.sharedVersion = sharedData.version;
      this.structures.nextId = this.structures.length;
    } else {
      structuresCopy.forEach((structure, i) => this.structures[i] = structure);
    }
    return saveResults;
  }
};
function writeEntityLength(length, majorValue) {
  if (length < 24)
    target[position2++] = majorValue | length;
  else if (length < 256) {
    target[position2++] = majorValue | 24;
    target[position2++] = length;
  } else if (length < 65536) {
    target[position2++] = majorValue | 25;
    target[position2++] = length >> 8;
    target[position2++] = length & 255;
  } else {
    target[position2++] = majorValue | 26;
    targetView.setUint32(position2, length);
    position2 += 4;
  }
}
var SharedData = class {
  constructor(structures, values, version) {
    this.structures = structures;
    this.packedValues = values;
    this.version = version;
  }
};
function writeArrayHeader(length) {
  if (length < 24)
    target[position2++] = 128 | length;
  else if (length < 256) {
    target[position2++] = 152;
    target[position2++] = length;
  } else if (length < 65536) {
    target[position2++] = 153;
    target[position2++] = length >> 8;
    target[position2++] = length & 255;
  } else {
    target[position2++] = 154;
    targetView.setUint32(position2, length);
    position2 += 4;
  }
}
var BlobConstructor = typeof Blob === "undefined" ? function() {
} : Blob;
function isBlob(object) {
  if (object instanceof BlobConstructor)
    return true;
  let tag = object[Symbol.toStringTag];
  return tag === "Blob" || tag === "File";
}
function findRepetitiveStrings(value, packedValues2) {
  switch (typeof value) {
    case "string":
      if (value.length > 3) {
        if (packedValues2.objectMap[value] > -1 || packedValues2.values.length >= packedValues2.maxValues)
          return;
        let packedStatus = packedValues2.get(value);
        if (packedStatus) {
          if (++packedStatus.count == 2) {
            packedValues2.values.push(value);
          }
        } else {
          packedValues2.set(value, {
            count: 1
          });
          if (packedValues2.samplingPackedValues) {
            let status = packedValues2.samplingPackedValues.get(value);
            if (status)
              status.count++;
            else
              packedValues2.samplingPackedValues.set(value, {
                count: 1
              });
          }
        }
      }
      break;
    case "object":
      if (value) {
        if (value instanceof Array) {
          for (let i = 0, l = value.length; i < l; i++) {
            findRepetitiveStrings(value[i], packedValues2);
          }
        } else {
          let includeKeys = !packedValues2.encoder.useRecords;
          for (var key in value) {
            if (value.hasOwnProperty(key)) {
              if (includeKeys)
                findRepetitiveStrings(key, packedValues2);
              findRepetitiveStrings(value[key], packedValues2);
            }
          }
        }
      }
      break;
    case "function":
      console.log(value);
  }
}
var isLittleEndianMachine2 = new Uint8Array(new Uint16Array([1]).buffer)[0] == 1;
extensionClasses = [
  Date,
  Set,
  Error,
  RegExp,
  Tag,
  ArrayBuffer,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  typeof BigUint64Array == "undefined" ? function() {
  } : BigUint64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  typeof BigInt64Array == "undefined" ? function() {
  } : BigInt64Array,
  Float32Array,
  Float64Array,
  SharedData
];
extensions = [
  {
    // Date
    tag: 1,
    encode(date, encode2) {
      let seconds = date.getTime() / 1e3;
      if ((this.useTimestamp32 || date.getMilliseconds() === 0) && seconds >= 0 && seconds < 4294967296) {
        target[position2++] = 26;
        targetView.setUint32(position2, seconds);
        position2 += 4;
      } else {
        target[position2++] = 251;
        targetView.setFloat64(position2, seconds);
        position2 += 8;
      }
    }
  },
  {
    // Set
    tag: 258,
    // https://github.com/input-output-hk/cbor-sets-spec/blob/master/CBOR_SETS.md
    encode(set, encode2) {
      let array = Array.from(set);
      encode2(array);
    }
  },
  {
    // Error
    tag: 27,
    // http://cbor.schmorp.de/generic-object
    encode(error, encode2) {
      encode2([error.name, error.message]);
    }
  },
  {
    // RegExp
    tag: 27,
    // http://cbor.schmorp.de/generic-object
    encode(regex, encode2) {
      encode2(["RegExp", regex.source, regex.flags]);
    }
  },
  {
    // Tag
    getTag(tag) {
      return tag.tag;
    },
    encode(tag, encode2) {
      encode2(tag.value);
    }
  },
  {
    // ArrayBuffer
    encode(arrayBuffer, encode2, makeRoom) {
      writeBuffer(arrayBuffer, makeRoom);
    }
  },
  {
    // Uint8Array
    getTag(typedArray) {
      if (typedArray.constructor === Uint8Array) {
        if (this.tagUint8Array || hasNodeBuffer && this.tagUint8Array !== false)
          return 64;
      }
    },
    encode(typedArray, encode2, makeRoom) {
      writeBuffer(typedArray, makeRoom);
    }
  },
  typedArrayEncoder(68, 1),
  typedArrayEncoder(69, 2),
  typedArrayEncoder(70, 4),
  typedArrayEncoder(71, 8),
  typedArrayEncoder(72, 1),
  typedArrayEncoder(77, 2),
  typedArrayEncoder(78, 4),
  typedArrayEncoder(79, 8),
  typedArrayEncoder(85, 4),
  typedArrayEncoder(86, 8),
  {
    encode(sharedData, encode2) {
      let packedValues2 = sharedData.packedValues || [];
      let sharedStructures = sharedData.structures || [];
      if (packedValues2.values.length > 0) {
        target[position2++] = 216;
        target[position2++] = 51;
        writeArrayHeader(4);
        let valuesArray = packedValues2.values;
        encode2(valuesArray);
        writeArrayHeader(0);
        writeArrayHeader(0);
        packedObjectMap = Object.create(sharedPackedObjectMap || null);
        for (let i = 0, l = valuesArray.length; i < l; i++) {
          packedObjectMap[valuesArray[i]] = i;
        }
      }
      if (sharedStructures) {
        targetView.setUint32(position2, 3655335424);
        position2 += 3;
        let definitions = sharedStructures.slice(0);
        definitions.unshift(57344);
        definitions.push(new Tag(sharedData.version, 1399353956));
        encode2(definitions);
      } else
        encode2(new Tag(sharedData.version, 1399353956));
    }
  }
];
function typedArrayEncoder(tag, size) {
  if (!isLittleEndianMachine2 && size > 1)
    tag -= 4;
  return {
    tag,
    encode: function writeExtBuffer(typedArray, encode2) {
      let length = typedArray.byteLength;
      let offset = typedArray.byteOffset || 0;
      let buffer = typedArray.buffer || typedArray;
      encode2(hasNodeBuffer ? Buffer2.from(buffer, offset, length) : new Uint8Array(buffer, offset, length));
    }
  };
}
function writeBuffer(buffer, makeRoom) {
  let length = buffer.byteLength;
  if (length < 24) {
    target[position2++] = 64 + length;
  } else if (length < 256) {
    target[position2++] = 88;
    target[position2++] = length;
  } else if (length < 65536) {
    target[position2++] = 89;
    target[position2++] = length >> 8;
    target[position2++] = length & 255;
  } else {
    target[position2++] = 90;
    targetView.setUint32(position2, length);
    position2 += 4;
  }
  if (position2 + length >= target.length) {
    makeRoom(position2 + length);
  }
  target.set(buffer.buffer ? buffer : new Uint8Array(buffer), position2);
  position2 += length;
}
function insertIds(serialized, idsToInsert) {
  let nextId;
  let distanceToMove = idsToInsert.length * 2;
  let lastEnd = serialized.length - distanceToMove;
  idsToInsert.sort((a, b) => a.offset > b.offset ? 1 : -1);
  for (let id = 0; id < idsToInsert.length; id++) {
    let referee = idsToInsert[id];
    referee.id = id;
    for (let position3 of referee.references) {
      serialized[position3++] = id >> 8;
      serialized[position3] = id & 255;
    }
  }
  while (nextId = idsToInsert.pop()) {
    let offset = nextId.offset;
    serialized.copyWithin(offset + distanceToMove, offset, lastEnd);
    distanceToMove -= 2;
    let position3 = offset + distanceToMove;
    serialized[position3++] = 216;
    serialized[position3++] = 28;
    lastEnd = offset;
  }
  return serialized;
}
function writeBundles(start, encode2) {
  targetView.setUint32(bundledStrings2.position + start, position2 - bundledStrings2.position - start + 1);
  let writeStrings = bundledStrings2;
  bundledStrings2 = null;
  encode2(writeStrings[0]);
  encode2(writeStrings[1]);
}
var defaultEncoder = new Encoder({ useRecords: false });
var encode = defaultEncoder.encode;
var encodeAsIterable = defaultEncoder.encodeAsIterable;
var encodeAsAsyncIterable = defaultEncoder.encodeAsAsyncIterable;
var { NEVER, ALWAYS, DECIMAL_ROUND, DECIMAL_FIT } = FLOAT32_OPTIONS;
var REUSE_BUFFER_MODE = 512;
var RESET_BUFFER_MODE = 1024;
var THROW_ON_ITERABLE = 2048;

// ../src/message-types.ts
var MessageTypeId = {
  push: 0,
  pull: 1,
  resolve: 2,
  reject: 3,
  release: 4,
  abort: 5
};
var MessageTypeById = {
  0: "push",
  1: "pull",
  2: "resolve",
  3: "reject",
  4: "release",
  5: "abort"
};
var ExpressionTypeId = {
  pipeline: 6,
  import: 7,
  export: 8,
  promise: 9,
  remap: 10
};
var ExpressionTypeById = {
  6: "pipeline",
  7: "import",
  8: "export",
  9: "promise",
  10: "remap"
};

// ../src/codec.ts
var RPC_MESSAGE_TAG = 39999;
function isPathDefinition(value) {
  return typeof value === "object" && value !== null && "_pd" in value && "p" in value && typeof value._pd === "number" && Array.isArray(value.p);
}
function isPathReference(value) {
  return typeof value === "object" && value !== null && "_pr" in value && typeof value._pr === "number";
}
var MIN_INTERN_LENGTH = 4;
function isStringDefinition(value) {
  return typeof value === "object" && value !== null && "_sd" in value && "s" in value && typeof value._sd === "number" && typeof value.s === "string";
}
function isStringReference(value) {
  return typeof value === "object" && value !== null && "_sr" in value && typeof value._sr === "number";
}
var CborCodec = class {
  encoder;
  decoder;
  // Structures array for record encoding/decoding.
  // When sequential: true, encoder and decoder can use separate arrays because
  // structure definitions are embedded inline in the stream.
  // When sequential: false, encoder and decoder MUST share the same array
  // so the decoder can look up structures that the encoder defined.
  encoderStructures = [];
  decoderStructures = [];
  // PropertyPath reference caching
  // Encoder side: maps stringified path to assigned ID
  encodePathRegistry = /* @__PURE__ */ new Map();
  // Decoder side: maps ID to path (array index = ID)
  decodePathRegistry = [];
  nextPathId = 0;
  // String interning (session-scoped)
  // Encoder side: maps string to assigned ID
  encodeStringRegistry = /* @__PURE__ */ new Map();
  // Decoder side: maps ID to string (array index = ID)
  decodeStringRegistry = [];
  nextStringId = 0;
  /**
   * The message encoding mode for RPC type identifiers.
   * - 'array': String type names as array first element ["push", ...]
   * - 'object': Type name as object key {push: ...} (enables CBOR structure optimization)
   * - 'numeric': Numeric type IDs [0, ...] (minimal overhead, MoQ-style)
   */
  messageEncodingMode;
  // Store options for reset
  options;
  constructor(options = {}) {
    this.messageEncodingMode = options.messageEncodingMode ?? "array";
    const sequential = options.sequential ?? true;
    const pack = options.pack ?? false;
    this.options = { sequential, pack };
    const sharedStructures = sequential ? void 0 : this.encoderStructures;
    this.encoder = new Encoder({
      sequential,
      useRecords: true,
      encodeUndefinedAsNil: false,
      tagUint8Array: true,
      pack,
      structures: sharedStructures ?? this.encoderStructures
    });
    this.decoder = new Decoder({
      sequential,
      useRecords: true,
      structures: sharedStructures ?? this.decoderStructures
    });
  }
  /**
   * EXPERIMENTAL (NOT YET FUNCTIONAL): Reset the codec state.
   *
   * Intended to clear all accumulated state (structure definitions, path cache,
   * string interning) so the codec can communicate with a fresh peer after
   * server hibernation.
   *
   * @experimental This is part of an incomplete attempt at Hibernatable WebSocket support.
   * The hibernation feature does not yet work. May change significantly or be removed.
   */
  __experimental_reset() {
    this.encoderStructures.length = 0;
    this.decoderStructures.length = 0;
    this.encodePathRegistry.clear();
    this.decodePathRegistry.length = 0;
    this.nextPathId = 0;
    this.encodeStringRegistry.clear();
    this.decodeStringRegistry.length = 0;
    this.nextStringId = 0;
    const sharedStructures = this.options.sequential ? void 0 : this.encoderStructures;
    this.encoder = new Encoder({
      sequential: this.options.sequential,
      useRecords: true,
      encodeUndefinedAsNil: false,
      tagUint8Array: true,
      pack: this.options.pack,
      structures: sharedStructures ?? this.encoderStructures
    });
    this.decoder = new Decoder({
      sequential: this.options.sequential,
      useRecords: true,
      structures: sharedStructures ?? this.decoderStructures
    });
  }
  __experimental_snapshotState() {
    return {
      encodePaths: pathsFromRegistry(this.encodePathRegistry),
      decodePaths: this.decodePathRegistry.slice(),
      encodeStrings: stringsFromRegistry(this.encodeStringRegistry),
      decodeStrings: this.decodeStringRegistry.slice(),
      // With sequential: true, the encoder structures are always empty (definitions
      // are embedded inline in each message). Only the decoder accumulates structures
      // from the stream — these must be persisted so a restored server can still
      // decode messages from a client whose encoder references them.
      decoderStructures: this.decoderStructures.map(
        (s) => Array.isArray(s) ? [...s] : []
      )
    };
  }
  __experimental_restoreState(snapshot) {
    this.__experimental_reset();
    for (const path of snapshot.encodePaths) {
      this.encodePathRegistry.set(JSON.stringify(path), this.nextPathId++);
    }
    for (const path of snapshot.decodePaths) {
      this.decodePathRegistry.push(path);
    }
    this.nextPathId = Math.max(this.nextPathId, this.decodePathRegistry.length);
    for (const value of snapshot.encodeStrings) {
      this.encodeStringRegistry.set(value, this.nextStringId++);
    }
    for (const value of snapshot.decodeStrings) {
      this.decodeStringRegistry.push(value);
    }
    this.nextStringId = Math.max(this.nextStringId, this.decodeStringRegistry.length);
    if (snapshot.decoderStructures) {
      this.decoderStructures.length = 0;
      for (const struct of snapshot.decoderStructures) {
        this.decoderStructures.push([...struct]);
      }
    }
  }
  /**
   * Encodes a PropertyPath, using reference caching for repeated paths.
   * First occurrence: returns { _pd: id, p: path } (definition)
   * Subsequent: returns { _pr: id } (reference)
   */
  encodePath(path) {
    if (path.length === 0) {
      return { _pd: -1, p: path };
    }
    const key = JSON.stringify(path);
    const existingId = this.encodePathRegistry.get(key);
    if (existingId !== void 0) {
      return { _pr: existingId };
    }
    const id = this.nextPathId++;
    this.encodePathRegistry.set(key, id);
    return { _pd: id, p: path };
  }
  /**
   * Decodes a PropertyPath from either a definition or reference.
   * Definitions are registered for future reference lookups.
   */
  decodePath(value) {
    if (isPathDefinition(value)) {
      if (value._pd >= 0) {
        this.decodePathRegistry[value._pd] = value.p;
      }
      return value.p;
    }
    if (isPathReference(value)) {
      const path = this.decodePathRegistry[value._pr];
      if (path === void 0) {
        throw new Error(`Unknown path reference: ${value._pr}`);
      }
      return path;
    }
    if (Array.isArray(value)) {
      return value;
    }
    throw new Error(`Invalid path encoding: ${JSON.stringify(value)}`);
  }
  /**
   * Encodes a string, using interning for repeated strings.
   * First occurrence: returns { _sd: id, s: "string" } (definition)
   * Subsequent: returns { _sr: id } (reference)
   * Short strings (< MIN_INTERN_LENGTH) are returned as-is.
   */
  internStringEncode(str) {
    if (str.length < MIN_INTERN_LENGTH) {
      return str;
    }
    const existingId = this.encodeStringRegistry.get(str);
    if (existingId !== void 0) {
      return { _sr: existingId };
    }
    const id = this.nextStringId++;
    this.encodeStringRegistry.set(str, id);
    return { _sd: id, s: str };
  }
  /**
   * Decodes a string from either a definition, reference, or plain string.
   * Definitions are registered for future reference lookups.
   */
  internStringDecode(value) {
    if (typeof value === "string") {
      return value;
    }
    if (isStringDefinition(value)) {
      this.decodeStringRegistry[value._sd] = value.s;
      return value.s;
    }
    if (isStringReference(value)) {
      const str = this.decodeStringRegistry[value._sr];
      if (str === void 0) {
        throw new Error(`Unknown string reference: ${value._sr}`);
      }
      return str;
    }
    throw new Error(`Invalid string encoding: ${JSON.stringify(value)}`);
  }
  /**
   * Encodes a value to CBOR bytes.
   * If the value is an RPC message (array starting with message type string),
   * it will be transformed to the configured wire format before encoding.
   */
  encode(value) {
    const wireFormat = this.toWireFormat(value);
    return this.encoder.encode(wireFormat);
  }
  /**
   * Decodes CBOR bytes to a value.
   * If the value is an RPC message in wire format, it will be transformed
   * back to the internal array format after decoding.
   */
  decode(data) {
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    const wireFormat = this.decoder.decode(data);
    return this.fromWireFormat(wireFormat);
  }
  /**
   * Recursively transform expression types to numeric IDs and intern strings.
   * Walks the structure and converts ["pipeline", ...] to [6, ...] etc.
   * Also interns strings for session-scoped deduplication.
   */
  transformExpressionsToNumeric(value) {
    if (typeof value === "string") {
      return this.internStringEncode(value);
    }
    if (!Array.isArray(value)) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return value;
      }
      if (value && typeof value === "object" && !(value instanceof Tag)) {
        const obj = value;
        const result = {};
        for (const key in obj) {
          result[key] = this.transformExpressionsToNumeric(obj[key]);
        }
        return result;
      }
      return value;
    }
    const first = value[0];
    if (typeof first === "string" && first in ExpressionTypeId) {
      return [
        ExpressionTypeId[first],
        ...value.slice(1).map((v) => this.transformExpressionsToNumeric(v))
      ];
    }
    return value.map((v) => this.transformExpressionsToNumeric(v));
  }
  /**
   * Recursively transform numeric expression IDs back to strings and decode interned strings.
   * Walks the structure and converts [6, ...] to ["pipeline", ...] etc.
   * Also decodes interned string references.
   */
  transformExpressionsFromNumeric(value) {
    if (isStringDefinition(value) || isStringReference(value)) {
      return this.internStringDecode(value);
    }
    if (!Array.isArray(value)) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return value;
      }
      if (value && typeof value === "object" && !(value instanceof Tag)) {
        const obj = value;
        const result = {};
        for (const key in obj) {
          result[key] = this.transformExpressionsFromNumeric(obj[key]);
        }
        return result;
      }
      return value;
    }
    const first = value[0];
    if (typeof first === "number" && first in ExpressionTypeById) {
      return [
        ExpressionTypeById[first],
        ...value.slice(1).map((v) => this.transformExpressionsFromNumeric(v))
      ];
    }
    return value.map((v) => this.transformExpressionsFromNumeric(v));
  }
  /**
   * Transform internal format to wire format based on encoding mode.
   * Internal: ["push", expr] or ["resolve", id, value] etc.
   * Wire format varies by mode, wrapped in CBOR tag to distinguish from arbitrary data.
   */
  toWireFormat(value) {
    if (!Array.isArray(value) || value.length === 0) return value;
    const type = value[0];
    if (typeof type !== "string" || !(type in MessageTypeId)) return value;
    const payload = value.slice(1);
    let transformed;
    switch (this.messageEncodingMode) {
      case "array":
        transformed = value;
        break;
      case "object":
        transformed = { [type]: payload };
        break;
      case "numeric":
        const numericPayload = payload.map((v) => this.transformExpressionsToNumeric(v));
        const typeId = MessageTypeId[type];
        if (typeId === void 0) {
          return value;
        }
        transformed = [typeId, ...numericPayload];
        break;
      default:
        return value;
    }
    return new Tag(transformed, RPC_MESSAGE_TAG);
  }
  /**
   * Transform wire format back to internal format.
   * Only transforms values wrapped in RPC_MESSAGE_TAG.
   * Returns internal array format: ["push", expr] etc.
   */
  fromWireFormat(value) {
    if (!(value instanceof Tag) || value.tag !== RPC_MESSAGE_TAG) {
      return value;
    }
    const taggedValue = value.value;
    switch (this.messageEncodingMode) {
      case "array":
        return taggedValue;
      case "object":
        if (taggedValue && typeof taggedValue === "object" && !Array.isArray(taggedValue)) {
          const keys = Object.keys(taggedValue);
          if (keys.length === 1 && keys[0] in MessageTypeId) {
            const type = keys[0];
            const payload = taggedValue[type];
            if (Array.isArray(payload)) {
              return [type, ...payload];
            }
          }
        }
        return taggedValue;
      case "numeric":
        if (Array.isArray(taggedValue) && taggedValue.length > 0 && typeof taggedValue[0] === "number") {
          const typeId = taggedValue[0];
          if (typeId in MessageTypeById) {
            const typeName = MessageTypeById[typeId];
            const payload = taggedValue.slice(1).map((v) => this.transformExpressionsFromNumeric(v));
            return [typeName, ...payload];
          }
        }
        return taggedValue;
      default:
        return taggedValue;
    }
  }
};
var cborCodec = new CborCodec();
function pathsFromRegistry(registry) {
  const paths = [];
  for (const [key, id] of registry.entries()) {
    paths[id] = JSON.parse(key);
  }
  return paths;
}
function stringsFromRegistry(registry) {
  const strings2 = [];
  for (const [value, id] of registry.entries()) {
    strings2[id] = value;
  }
  return strings2;
}

// ../src/rpc.ts
var ImportTableEntry = class {
  constructor(session, importId, pulling) {
    this.session = session;
    this.importId = importId;
    if (pulling) {
      this.activePull = Promise.withResolvers();
    }
  }
  localRefcount = 0;
  remoteRefcount = 1;
  activePull;
  resolution;
  // List of integer indexes into session.onBrokenCallbacks which are callbacks registered on
  // this import. Initialized on first use (so `undefined` is the same as an empty list).
  onBrokenRegistrations;
  resolve(resolution) {
    if (this.localRefcount == 0) {
      resolution.dispose();
      return;
    }
    this.resolution = resolution;
    this.sendRelease();
    if (this.onBrokenRegistrations) {
      for (let i of this.onBrokenRegistrations) {
        let callback = this.session.onBrokenCallbacks[i];
        let endIndex = this.session.onBrokenCallbacks.length;
        resolution.onBroken(callback);
        if (this.session.onBrokenCallbacks[endIndex] === callback) {
          delete this.session.onBrokenCallbacks[endIndex];
        } else {
          delete this.session.onBrokenCallbacks[i];
        }
      }
      this.onBrokenRegistrations = void 0;
    }
    if (this.activePull) {
      this.activePull.resolve();
      this.activePull = void 0;
    }
  }
  async awaitResolution() {
    if (!this.activePull) {
      this.session.sendPull(this.importId);
      this.activePull = Promise.withResolvers();
    }
    await this.activePull.promise;
    return this.resolution.pull();
  }
  dispose() {
    if (this.resolution) {
      this.resolution.dispose();
    } else {
      this.abort(new Error("RPC was canceled because the RpcPromise was disposed."));
      this.sendRelease();
    }
  }
  abort(error) {
    if (!this.resolution) {
      this.resolution = new ErrorStubHook(error);
      if (this.activePull) {
        this.activePull.reject(error);
        this.activePull = void 0;
      }
      this.onBrokenRegistrations = void 0;
    }
  }
  onBroken(callback) {
    if (this.resolution) {
      this.resolution.onBroken(callback);
    } else {
      let index = this.session.onBrokenCallbacks.length;
      this.session.onBrokenCallbacks.push(callback);
      if (!this.onBrokenRegistrations) this.onBrokenRegistrations = [];
      this.onBrokenRegistrations.push(index);
    }
  }
  sendRelease() {
    if (this.remoteRefcount > 0) {
      this.session.sendRelease(this.importId, this.remoteRefcount);
      this.remoteRefcount = 0;
    }
  }
};
var RpcImportHook = class _RpcImportHook extends StubHook {
  // undefined when we're disposed
  // `pulling` is true if we already expect that this import is going to be resolved later, and
  // null if this import is not allowed to be pulled (i.e. it's a stub not a promise).
  constructor(isPromise, entry) {
    super();
    this.isPromise = isPromise;
    ++entry.localRefcount;
    this.entry = entry;
  }
  entry;
  collectPath(path) {
    return this;
  }
  getEntry() {
    if (this.entry) {
      return this.entry;
    } else {
      throw new Error("This RpcImportHook was already disposed.");
    }
  }
  // -------------------------------------------------------------------------------------
  // implements StubHook
  call(path, args) {
    let entry = this.getEntry();
    if (entry.resolution) {
      return entry.resolution.call(path, args);
    } else {
      return entry.session.sendCall(entry.importId, path, args);
    }
  }
  map(path, captures, instructions) {
    let entry;
    try {
      entry = this.getEntry();
    } catch (err) {
      for (let cap of captures) {
        cap.dispose();
      }
      throw err;
    }
    if (entry.resolution) {
      return entry.resolution.map(path, captures, instructions);
    } else {
      return entry.session.sendMap(entry.importId, path, captures, instructions);
    }
  }
  get(path) {
    let entry = this.getEntry();
    if (entry.resolution) {
      return entry.resolution.get(path);
    } else {
      return entry.session.sendCall(entry.importId, path);
    }
  }
  dup() {
    return new _RpcImportHook(false, this.getEntry());
  }
  pull() {
    let entry = this.getEntry();
    if (!this.isPromise) {
      throw new Error("Can't pull this hook because it's not a promise hook.");
    }
    if (entry.resolution) {
      return entry.resolution.pull();
    }
    return entry.awaitResolution();
  }
  ignoreUnhandledRejections() {
  }
  dispose() {
    let entry = this.entry;
    this.entry = void 0;
    if (entry) {
      if (--entry.localRefcount === 0) {
        entry.dispose();
      }
    }
  }
  onBroken(callback) {
    if (this.entry) {
      this.entry.onBroken(callback);
    }
  }
};
var RpcMainHook = class extends RpcImportHook {
  session;
  constructor(entry) {
    super(false, entry);
    this.session = entry.session;
  }
  dispose() {
    if (this.session) {
      let session = this.session;
      this.session = void 0;
      session.shutdown();
    }
  }
};
var RpcSessionImpl = class {
  constructor(transport, mainHook, options) {
    this.transport = transport;
    this.options = options;
    this.codec = new CborCodec({
      messageEncodingMode: options.messageEncodingMode,
      pack: options.pack
    });
    this.exports.push({ hook: mainHook, refcount: 1 });
    this.imports.push(new ImportTableEntry(this, 0, false));
    const snapshot = options.__experimental_restoreSnapshot;
    if (snapshot) {
      this.restoreFromSnapshot(snapshot);
    }
    let rejectFunc;
    ;
    let abortPromise = new Promise((resolve, reject) => {
      rejectFunc = reject;
    });
    this.cancelReadLoop = rejectFunc;
    this.readLoop(abortPromise).catch((err) => this.abort(err));
  }
  exports = [];
  reverseExports = /* @__PURE__ */ new Map();
  imports = [];
  abortReason;
  cancelReadLoop;
  // Per-session CBOR codec. Each session needs its own encoder/decoder pair
  // to maintain structure state for sequential mode.
  codec;
  // We assign positive numbers to imports we initiate, and negative numbers to exports we
  // initiate. So the next import ID is just `imports.length`, but the next export ID needs
  // to be tracked explicitly.
  nextExportId = -1;
  // If set, call this when all incoming calls are complete.
  onBatchDone;
  // How many promises is our peer expecting us to resolve?
  pullCount = 0;
  // Sparse array of onBrokenCallback registrations. Items are strictly appended to the end but
  // may be deleted from the middle (hence leaving the array sparse).
  onBrokenCallbacks = [];
  // Should only be called once immediately after construction.
  getMainImport() {
    return new RpcMainHook(this.imports[0]);
  }
  shutdown() {
    this.abort(new Error("RPC session was shut down by disposing the main stub"), false);
  }
  exportStub(hook) {
    if (this.abortReason) throw this.abortReason;
    let existingExportId = this.reverseExports.get(hook);
    if (existingExportId !== void 0) {
      ++this.exports[existingExportId].refcount;
      return existingExportId;
    } else {
      let exportId = this.nextExportId--;
      this.exports[exportId] = { hook, refcount: 1 };
      this.reverseExports.set(hook, exportId);
      return exportId;
    }
  }
  exportPromise(hook) {
    if (this.abortReason) throw this.abortReason;
    let exportId = this.nextExportId--;
    this.exports[exportId] = { hook, refcount: 1 };
    this.reverseExports.set(hook, exportId);
    this.ensureResolvingExport(exportId);
    return exportId;
  }
  unexport(ids) {
    for (let id of ids) {
      this.releaseExport(id, 1);
    }
  }
  releaseExport(exportId, refcount) {
    let entry = this.exports[exportId];
    if (!entry) {
      return;
    }
    if (entry.refcount < refcount) {
      throw new Error(`refcount would go negative: ${entry.refcount} < ${refcount}`);
    }
    entry.refcount -= refcount;
    if (entry.refcount === 0) {
      delete this.exports[exportId];
      if (entry.hook) {
        this.reverseExports.delete(entry.hook);
        entry.hook.dispose();
      }
    }
  }
  onSendError(error) {
    if (this.options.onSendError) {
      return this.options.onSendError(error);
    }
  }
  ensureResolvingExport(exportId) {
    let exp = this.exports[exportId];
    if (!exp) {
      return;
    }
    if (!exp.pull) {
      let resolve = async () => {
        let hook = this.getOrRestoreExportHook(exportId);
        for (; ; ) {
          let payload = await hook.pull();
          if (payload.value instanceof RpcStub) {
            let { hook: inner, pathIfPromise } = unwrapStubAndPath(payload.value);
            if (pathIfPromise && pathIfPromise.length == 0) {
              if (this.getImport(hook) === void 0) {
                hook = inner;
                continue;
              }
            }
          }
          return payload;
        }
      };
      ++this.pullCount;
      exp.pull = resolve().then(
        (payload) => {
          let value = Devaluator.devaluate(payload.value, void 0, this, payload);
          this.send(["resolve", exportId, value]);
        },
        (error) => {
          this.send(["reject", exportId, Devaluator.devaluate(error, void 0, this)]);
        }
      ).catch(
        (error) => {
          try {
            this.send(["reject", exportId, Devaluator.devaluate(error, void 0, this)]);
          } catch (error2) {
            this.abort(error2);
          }
        }
      ).finally(() => {
        if (--this.pullCount === 0) {
          if (this.onBatchDone) {
            this.onBatchDone.resolve();
          }
        }
      });
    }
  }
  getImport(hook) {
    if (hook instanceof RpcImportHook && hook.entry && hook.entry.session === this) {
      return hook.entry.importId;
    } else {
      return void 0;
    }
  }
  importStub(idx) {
    if (this.abortReason) throw this.abortReason;
    let entry = this.imports[idx];
    if (!entry) {
      entry = new ImportTableEntry(this, idx, false);
      this.imports[idx] = entry;
    }
    return new RpcImportHook(
      /*isPromise=*/
      false,
      entry
    );
  }
  importPromise(idx) {
    if (this.abortReason) throw this.abortReason;
    if (this.imports[idx]) {
      return new ErrorStubHook(new Error(
        "Bug in RPC system: The peer sent a promise reusing an existing export ID."
      ));
    }
    let entry = new ImportTableEntry(this, idx, true);
    this.imports[idx] = entry;
    return new RpcImportHook(
      /*isPromise=*/
      true,
      entry
    );
  }
  getExport(idx) {
    let entry = this.exports[idx];
    if (!entry) return void 0;
    return this.getOrRestoreExportHook(idx);
  }
  __experimental_snapshot() {
    let registry = this.options.__experimental_hibernationRegistry;
    if (!registry) {
      throw new Error("Can't snapshot RPC session without a hibernation registry.");
    }
    const imports = [];
    for (let i in this.imports) {
      let id = Number(i);
      if (id === 0) continue;
      let entry = this.imports[i];
      if (!entry) continue;
      if (entry.resolution) {
        continue;
      }
      imports.push({
        id,
        remoteRefcount: entry.remoteRefcount
      });
    }
    const exports = [];
    for (let i in this.exports) {
      let id = Number(i);
      if (id >= 0) continue;
      let entry = this.exports[i];
      if (!entry) continue;
      let descriptor = entry.descriptor;
      if (!descriptor && entry.hook) {
        descriptor = __experimental_describeStubHookForHibernation(entry.hook, registry);
        if (descriptor) {
          entry.descriptor = descriptor;
        }
      }
      if (!descriptor) {
        console.error(
          `[capnweb] Export ${id} is not hibernatable (hook type: ${entry.hook?.constructor?.name ?? "none"}). It will be lost on hibernation. Register it in the hibernation registry to fix this.`
        );
        continue;
      }
      exports.push({
        id,
        refcount: entry.refcount,
        descriptor,
        ...entry.pull ? { pulling: true } : {}
      });
    }
    return {
      version: 1,
      nextExportId: this.nextExportId,
      exports,
      ...imports.length > 0 ? { imports } : {},
      codec: this.codec.__experimental_snapshotState()
    };
  }
  send(msg) {
    if (this.abortReason !== void 0) {
      return;
    }
    msg = this.encodePathsInMessage(msg);
    let msgData;
    try {
      msgData = this.codec.encode(msg);
    } catch (err) {
      try {
        this.abort(err);
      } catch (err2) {
      }
      throw err;
    }
    this.transport.send(msgData).catch((err) => this.abort(err, false));
  }
  // Recursively encodes PropertyPaths in a message at known locations.
  // Paths appear in: ["pipeline", id, path, args?] and ["remap", id, path, captures, instructions]
  encodePathsInMessage(msg) {
    if (!(msg instanceof Array)) return msg;
    switch (msg[0]) {
      case "push":
        if (msg.length > 1) {
          return ["push", this.encodePathsInExpression(msg[1])];
        }
        break;
      case "resolve":
        if (msg.length > 2) {
          return ["resolve", msg[1], this.encodePathsInValue(msg[2])];
        }
        break;
      case "reject":
        if (msg.length > 2) {
          return ["reject", msg[1], this.encodePathsInValue(msg[2])];
        }
        break;
      case "abort":
        if (msg.length > 1) {
          return ["abort", this.encodePathsInValue(msg[1])];
        }
        break;
    }
    return msg;
  }
  // Encodes paths in RPC expressions (pipeline, import, export, remap, etc.)
  encodePathsInExpression(expr) {
    if (!(expr instanceof Array) || expr.length === 0) return expr;
    switch (expr[0]) {
      case "pipeline":
        if (expr.length >= 3 && Array.isArray(expr[2])) {
          const encoded = [expr[0], expr[1], this.codec.encodePath(expr[2])];
          if (expr.length >= 4) {
            encoded.push(this.encodePathsInValue(expr[3]));
          }
          return encoded;
        }
        break;
      case "remap":
        if (expr.length >= 3 && Array.isArray(expr[2])) {
          return [
            expr[0],
            expr[1],
            this.codec.encodePath(expr[2]),
            expr[3],
            // captures don't contain paths
            expr[4]
            // instructions don't contain user paths
          ];
        }
        break;
    }
    return expr;
  }
  // Recursively processes a value to encode paths in any nested expressions
  encodePathsInValue(value) {
    if (!(value instanceof Array)) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return value;
      }
      if (value instanceof Object) {
        const result = {};
        for (const key in value) {
          result[key] = this.encodePathsInValue(value[key]);
        }
        return result;
      }
      return value;
    }
    if (value.length > 0 && typeof value[0] === "string") {
      switch (value[0]) {
        case "pipeline":
        case "remap":
          return this.encodePathsInExpression(value);
        case "import":
        case "export":
        case "promise":
          return value;
      }
    }
    if (value.length === 1 && value[0] instanceof Array) {
      return [this.encodePathsInValue(value[0])];
    }
    return value.map((item) => this.encodePathsInValue(item));
  }
  // Recursively decodes PropertyPaths in a received message.
  decodePathsInMessage(msg) {
    if (!(msg instanceof Array)) return msg;
    switch (msg[0]) {
      case "push":
        if (msg.length > 1) {
          return ["push", this.decodePathsInExpression(msg[1])];
        }
        break;
      case "resolve":
        if (msg.length > 2) {
          return ["resolve", msg[1], this.decodePathsInValue(msg[2])];
        }
        break;
      case "reject":
        if (msg.length > 2) {
          return ["reject", msg[1], this.decodePathsInValue(msg[2])];
        }
        break;
      case "abort":
        if (msg.length > 1) {
          return ["abort", this.decodePathsInValue(msg[1])];
        }
        break;
    }
    return msg;
  }
  // Decodes paths in RPC expressions
  decodePathsInExpression(expr) {
    if (!(expr instanceof Array) || expr.length === 0) return expr;
    switch (expr[0]) {
      case "pipeline":
        if (expr.length >= 3) {
          const path = this.codec.decodePath(expr[2]);
          const decoded = [expr[0], expr[1], path];
          if (expr.length >= 4) {
            decoded.push(this.decodePathsInValue(expr[3]));
          }
          return decoded;
        }
        break;
      case "remap":
        if (expr.length >= 3) {
          return [
            expr[0],
            expr[1],
            this.codec.decodePath(expr[2]),
            expr[3],
            expr[4]
          ];
        }
        break;
    }
    return expr;
  }
  // Recursively decodes paths in values
  decodePathsInValue(value) {
    if (!(value instanceof Array)) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return value;
      }
      if (value instanceof Object) {
        const result = {};
        for (const key in value) {
          result[key] = this.decodePathsInValue(value[key]);
        }
        return result;
      }
      return value;
    }
    if (value.length > 0 && typeof value[0] === "string") {
      switch (value[0]) {
        case "pipeline":
        case "remap":
          return this.decodePathsInExpression(value);
        case "import":
        case "export":
        case "promise":
          return value;
      }
    }
    if (value.length === 1 && value[0] instanceof Array) {
      return [this.decodePathsInValue(value[0])];
    }
    return value.map((item) => this.decodePathsInValue(item));
  }
  sendCall(id, path, args) {
    if (this.abortReason) throw this.abortReason;
    let value = ["pipeline", id, path];
    if (args) {
      let devalue = Devaluator.devaluate(args.value, void 0, this, args);
      value.push(devalue[0]);
    }
    this.send(["push", value]);
    let entry = new ImportTableEntry(this, this.imports.length, false);
    this.imports.push(entry);
    return new RpcImportHook(
      /*isPromise=*/
      true,
      entry
    );
  }
  sendMap(id, path, captures, instructions) {
    if (this.abortReason) {
      for (let cap of captures) {
        cap.dispose();
      }
      throw this.abortReason;
    }
    let devaluedCaptures = captures.map((hook) => {
      let importId = this.getImport(hook);
      if (importId !== void 0) {
        return ["import", importId];
      } else {
        return ["export", this.exportStub(hook)];
      }
    });
    let value = ["remap", id, path, devaluedCaptures, instructions];
    this.send(["push", value]);
    let entry = new ImportTableEntry(this, this.imports.length, false);
    this.imports.push(entry);
    return new RpcImportHook(
      /*isPromise=*/
      true,
      entry
    );
  }
  sendPull(id) {
    if (this.abortReason) throw this.abortReason;
    this.send(["pull", id]);
  }
  sendRelease(id, remoteRefcount) {
    if (this.abortReason) return;
    this.send(["release", id, remoteRefcount]);
    delete this.imports[id];
  }
  abort(error, trySendAbortMessage = true) {
    if (this.abortReason !== void 0) return;
    this.cancelReadLoop(error);
    if (trySendAbortMessage) {
      try {
        this.transport.send(this.codec.encode(["abort", Devaluator.devaluate(error, void 0, this)])).catch((err) => {
        });
      } catch (err) {
      }
    }
    if (error === void 0) {
      error = "undefined";
    }
    this.abortReason = error;
    if (this.onBatchDone) {
      this.onBatchDone.reject(error);
    }
    if (this.transport.abort) {
      try {
        this.transport.abort(error);
      } catch (err) {
        Promise.resolve(err);
      }
    }
    for (let i in this.onBrokenCallbacks) {
      try {
        this.onBrokenCallbacks[i](error);
      } catch (err) {
        Promise.resolve(err);
      }
    }
    for (let i in this.imports) {
      this.imports[i].abort(error);
    }
    for (let i in this.exports) {
      this.exports[i].hook?.dispose();
    }
  }
  async readLoop(abortPromise) {
    while (!this.abortReason) {
      let msgData = await Promise.race([this.transport.receive(), abortPromise]);
      let msg = this.codec.decode(msgData);
      msg = this.decodePathsInMessage(msg);
      if (this.abortReason) break;
      if (msg instanceof Array) {
        switch (msg[0]) {
          case "push":
            if (msg.length > 1) {
              let payload = new Evaluator(this).evaluate(msg[1]);
              let hook = new PayloadStubHook(payload);
              hook.ignoreUnhandledRejections();
              this.exports.push({ hook, refcount: 1 });
              continue;
            }
            break;
          case "pull": {
            let exportId = msg[1];
            if (typeof exportId == "number") {
              this.ensureResolvingExport(exportId);
              continue;
            }
            break;
          }
          case "resolve":
          // ["resolve", ExportId, Expression]
          case "reject": {
            let importId = msg[1];
            if (typeof importId == "number" && msg.length > 2) {
              let imp = this.imports[importId];
              if (imp) {
                if (msg[0] == "resolve") {
                  imp.resolve(new PayloadStubHook(new Evaluator(this).evaluate(msg[2])));
                } else {
                  let payload = new Evaluator(this).evaluate(msg[2]);
                  payload.dispose();
                  imp.resolve(new ErrorStubHook(payload.value));
                }
              } else {
                if (msg[0] == "resolve") {
                  new Evaluator(this).evaluate(msg[2]).dispose();
                }
              }
              continue;
            }
            break;
          }
          case "release": {
            let exportId = msg[1];
            let refcount = msg[2];
            if (typeof exportId == "number" && typeof refcount == "number") {
              this.releaseExport(exportId, refcount);
              continue;
            }
            break;
          }
          case "abort": {
            let payload = new Evaluator(this).evaluate(msg[1]);
            payload.dispose();
            this.abort(payload, false);
            break;
          }
        }
      }
      throw new Error(`bad RPC message: ${JSON.stringify(msg)}`);
    }
  }
  async drain() {
    if (this.abortReason) {
      throw this.abortReason;
    }
    if (this.pullCount > 0) {
      let { promise, resolve, reject } = Promise.withResolvers();
      this.onBatchDone = { resolve, reject };
      await promise;
    }
  }
  getStats() {
    let result = { imports: 0, exports: 0 };
    for (let i in this.imports) {
      ++result.imports;
    }
    for (let i in this.exports) {
      ++result.exports;
    }
    return result;
  }
  getOrRestoreExportHook(exportId) {
    const entry = this.exports[exportId];
    if (!entry) {
      throw new Error(`no such export ID: ${exportId}`);
    }
    if (!entry.hook) {
      const registry = this.options.__experimental_hibernationRegistry;
      if (!registry || !entry.descriptor) {
        throw new Error(`Export ${exportId} can't be restored after hibernation.`);
      }
      entry.hook = __experimental_restoreStubHookFromHibernation(entry.descriptor, registry);
      this.reverseExports.set(entry.hook, exportId);
    }
    return entry.hook;
  }
  restoreFromSnapshot(snapshot) {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported RPC session snapshot version: ${snapshot.version}`);
    }
    this.nextExportId = snapshot.nextExportId;
    this.codec.__experimental_restoreState(snapshot.codec);
    const pendingPulls = [];
    for (let exp of snapshot.exports) {
      this.exports[exp.id] = {
        refcount: exp.refcount,
        descriptor: exp.descriptor
      };
      if (exp.pulling) {
        pendingPulls.push(exp.id);
      }
    }
    if (snapshot.imports) {
      for (let imp of snapshot.imports) {
        let entry = new ImportTableEntry(this, imp.id, false);
        entry.remoteRefcount = imp.remoteRefcount;
        this.imports[imp.id] = entry;
      }
    }
    if (pendingPulls.length > 0) {
      queueMicrotask(() => {
        for (let id of pendingPulls) {
          this.ensureResolvingExport(id);
        }
      });
    }
  }
};
var RpcSession = class {
  #session;
  #mainStub;
  constructor(transport, localMain, options = {}) {
    let mainHook;
    if (localMain) {
      mainHook = new PayloadStubHook(RpcPayload.fromAppReturn(localMain));
    } else {
      mainHook = new ErrorStubHook(new Error("This connection has no main object."));
    }
    this.#session = new RpcSessionImpl(transport, mainHook, options);
    this.#mainStub = new RpcStub(this.#session.getMainImport());
  }
  getRemoteMain() {
    return this.#mainStub;
  }
  getStats() {
    return this.#session.getStats();
  }
  drain() {
    return this.#session.drain();
  }
  __experimental_snapshot() {
    return this.#session.__experimental_snapshot();
  }
};

// ../src/websocket.ts
function newWebSocketRpcSession(webSocket, localMain, options) {
  if (typeof webSocket === "string") {
    webSocket = new WebSocket(webSocket);
  }
  let transport = new WebSocketTransport(webSocket);
  let rpc = new RpcSession(transport, localMain, options);
  return rpc.getRemoteMain();
}
function newWorkersWebSocketRpcResponse(request, localMain, options) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("This endpoint only accepts WebSocket requests.", { status: 400 });
  }
  let pair = new WebSocketPair();
  let server = pair[0];
  server.accept();
  newWebSocketRpcSession(server, localMain, options);
  return new Response(null, {
    status: 101,
    webSocket: pair[1]
  });
}
async function __experimental_newHibernatableWebSocketRpcSession(webSocket, localMain, options) {
  let attachment = getAttachment(webSocket);
  const sessionId = options.sessionId ?? attachment?.sessionId ?? makeSessionId();
  let snapshot = attachment?.snapshot ?? (options.sessionStore ? await options.sessionStore.load(sessionId) : void 0);
  let rpc;
  let persistScheduled = false;
  let transport = new HibernatableWebSocketTransport(webSocket, () => {
    if (!persistScheduled) {
      persistScheduled = true;
      queueMicrotask(() => {
        persistScheduled = false;
        void persistSnapshot();
      });
    }
  });
  rpc = new RpcSession(transport, localMain, {
    ...options,
    __experimental_hibernationRegistry: options.hibernationRegistry,
    __experimental_restoreSnapshot: snapshot
  });
  await persistSnapshot();
  return {
    sessionId,
    getRemoteMain() {
      return rpc.getRemoteMain();
    },
    handleMessage(message) {
      transport.pushIncoming(message);
    },
    handleClose(code, reason, wasClean) {
      transport.notifyClosed(code, reason, wasClean);
    },
    handleError(error) {
      transport.notifyError(error);
    }
  };
  async function persistSnapshot() {
    try {
      let snap = rpc.__experimental_snapshot();
      webSocket.serializeAttachment?.({
        sessionId,
        version: 1,
        snapshot: snap
      });
      if (options.sessionStore) {
        await options.sessionStore.save(sessionId, snap);
      }
    } catch (err) {
      transport.abort?.(err);
    }
  }
}
async function __experimental_resumeHibernatableWebSocketRpcSession(webSocket, localMain, options) {
  return __experimental_newHibernatableWebSocketRpcSession(webSocket, localMain, options);
}
function getAttachment(webSocket) {
  let attachment = webSocket.deserializeAttachment?.();
  if (attachment?.version === 1 && typeof attachment.sessionId === "string") {
    return attachment;
  }
  return void 0;
}
function makeSessionId() {
  if ("crypto" in globalThis && typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `capnweb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
var WebSocketTransport = class {
  constructor(webSocket, onActivity) {
    this.onActivity = onActivity;
    this.#webSocket = webSocket;
    webSocket.binaryType = "arraybuffer";
    if (webSocket.readyState === WebSocket.CONNECTING) {
      this.#sendQueue = [];
      webSocket.addEventListener("open", (event) => {
        try {
          for (let message of this.#sendQueue) {
            webSocket.send(message);
          }
        } catch (err) {
          this.#receivedError(err);
        }
        this.#sendQueue = void 0;
      });
    }
    webSocket.addEventListener("message", (event) => {
      if (this.#error) {
      } else {
        let message;
        const data = event.data;
        if (data instanceof ArrayBuffer) {
          message = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
          message = data;
        } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
          message = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (ArrayBuffer.isView(data)) {
          message = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        if (message) {
          if (this.#receiveResolver) {
            this.#receiveResolver(message);
            this.#receiveResolver = void 0;
            this.#receiveRejecter = void 0;
          } else {
            this.#receiveQueue.push(message);
          }
          this.onActivity?.();
        } else {
          this.#receivedError(new TypeError(`Received non-binary message from WebSocket: ${typeof data} ${Object.prototype.toString.call(data)}`));
        }
      }
    });
    webSocket.addEventListener("close", (event) => {
      this.#receivedError(new Error(`Peer closed WebSocket: ${event.code} ${event.reason}`));
    });
    webSocket.addEventListener("error", (event) => {
      this.#receivedError(new Error(`WebSocket connection failed.`));
    });
  }
  #webSocket;
  #sendQueue;
  // only if not opened yet
  #receiveResolver;
  #receiveRejecter;
  #receiveQueue = [];
  #error;
  async send(message) {
    if (this.#sendQueue === void 0) {
      this.#webSocket.send(message);
    } else {
      this.#sendQueue.push(message);
    }
    this.onActivity?.();
  }
  async receive() {
    if (this.#receiveQueue.length > 0) {
      return this.#receiveQueue.shift();
    } else if (this.#error) {
      throw this.#error;
    } else {
      return new Promise((resolve, reject) => {
        this.#receiveResolver = resolve;
        this.#receiveRejecter = reject;
      });
    }
  }
  abort(reason) {
    let message;
    if (reason instanceof Error) {
      message = reason.message;
    } else {
      message = `${reason}`;
    }
    this.#webSocket.close(3e3, message);
    if (!this.#error) {
      this.#error = reason;
    }
  }
  #receivedError(reason) {
    if (!this.#error) {
      this.#error = reason;
      if (this.#receiveRejecter) {
        this.#receiveRejecter(reason);
        this.#receiveResolver = void 0;
        this.#receiveRejecter = void 0;
      }
    }
  }
};
var HibernatableWebSocketTransport = class {
  constructor(webSocket, onActivity) {
    this.webSocket = webSocket;
    this.onActivity = onActivity;
  }
  #receiveResolver;
  #receiveRejecter;
  #receiveQueue = [];
  #error;
  async send(message) {
    if (this.#error) throw this.#error;
    this.webSocket.send(message);
    this.onActivity?.();
  }
  async receive() {
    if (this.#receiveQueue.length > 0) {
      return this.#receiveQueue.shift();
    } else if (this.#error) {
      throw this.#error;
    } else {
      return new Promise((resolve, reject) => {
        this.#receiveResolver = resolve;
        this.#receiveRejecter = reject;
      });
    }
  }
  abort(reason) {
    let message;
    if (reason instanceof Error) {
      message = reason.message;
    } else {
      message = `${reason}`;
    }
    this.webSocket.close(3e3, message);
    this.#setError(reason);
  }
  pushIncoming(message) {
    if (typeof message === "string") {
      this.#setError(new TypeError("Received non-binary message from hibernatable WebSocket."));
      return;
    }
    let bytes;
    if (message instanceof ArrayBuffer) {
      bytes = new Uint8Array(message);
    } else {
      bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    }
    if (this.#receiveResolver) {
      this.#receiveResolver(bytes);
      this.#receiveResolver = void 0;
      this.#receiveRejecter = void 0;
    } else {
      this.#receiveQueue.push(bytes);
    }
    this.onActivity?.();
  }
  notifyClosed(code, reason, wasClean) {
    const suffix = wasClean === void 0 ? "" : ` clean=${wasClean}`;
    this.#setError(new Error(`Peer closed WebSocket: ${code ?? 1005} ${reason ?? ""}${suffix}`.trim()));
  }
  notifyError(error) {
    this.#setError(error instanceof Error ? error : new Error(`${error}`));
  }
  #setError(reason) {
    if (!this.#error) {
      this.#error = reason;
      if (this.#receiveRejecter) {
        this.#receiveRejecter(reason);
        this.#receiveResolver = void 0;
        this.#receiveRejecter = void 0;
      }
    }
  }
};

// ../src/batch.ts
function encodeBatch(messages) {
  let totalLength = 0;
  for (const msg of messages) {
    totalLength += 4 + msg.length;
  }
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const msg of messages) {
    view.setUint32(offset, msg.length, false);
    offset += 4;
    result.set(msg, offset);
    offset += msg.length;
  }
  return result;
}
function decodeBatch(data) {
  const messages = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  while (offset < data.length) {
    const length = view.getUint32(offset, false);
    offset += 4;
    messages.push(data.slice(offset, offset + length));
    offset += length;
  }
  return messages;
}
var BatchClientTransport = class {
  constructor(sendBatch) {
    this.#promise = this.#scheduleBatch(sendBatch);
  }
  #promise;
  #aborted;
  #batchToSend = [];
  #batchToReceive = null;
  async send(message) {
    if (this.#batchToSend !== null) {
      this.#batchToSend.push(message);
    }
  }
  async receive() {
    if (!this.#batchToReceive) {
      await this.#promise;
    }
    let msg = this.#batchToReceive.shift();
    if (msg !== void 0) {
      return msg;
    } else {
      throw new Error("Batch RPC request ended.");
    }
  }
  abort(reason) {
    this.#aborted = reason;
  }
  async #scheduleBatch(sendBatch) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.#aborted !== void 0) {
      throw this.#aborted;
    }
    let batch = this.#batchToSend;
    this.#batchToSend = null;
    this.#batchToReceive = await sendBatch(batch);
  }
};
function newHttpBatchRpcSession(urlOrRequest, options) {
  let sendBatch = async (batch) => {
    const encoded = encodeBatch(batch);
    let response = await fetch(urlOrRequest, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      // Wrap in Blob for consistent BodyInit compatibility
      body: new Blob([encoded])
    });
    if (!response.ok) {
      response.body?.cancel();
      throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
    }
    let body = new Uint8Array(await response.arrayBuffer());
    return body.length === 0 ? [] : decodeBatch(body);
  };
  let transport = new BatchClientTransport(sendBatch);
  let rpc = new RpcSession(transport, void 0, options);
  return rpc.getRemoteMain();
}
var BatchServerTransport = class {
  constructor(batch) {
    this.#batchToReceive = batch;
  }
  #batchToSend = [];
  #batchToReceive;
  #allReceived = Promise.withResolvers();
  async send(message) {
    this.#batchToSend.push(message);
  }
  async receive() {
    let msg = this.#batchToReceive.shift();
    if (msg !== void 0) {
      return msg;
    } else {
      this.#allReceived.resolve();
      return new Promise((r) => {
      });
    }
  }
  abort(reason) {
    this.#allReceived.reject(reason);
  }
  whenAllReceived() {
    return this.#allReceived.promise;
  }
  getResponseBody() {
    return encodeBatch(this.#batchToSend);
  }
};
async function newHttpBatchRpcResponse(request, localMain, options) {
  if (request.method !== "POST") {
    return new Response("This endpoint only accepts POST requests.", { status: 405 });
  }
  let body = new Uint8Array(await request.arrayBuffer());
  let batch = body.length === 0 ? [] : decodeBatch(body);
  let transport = new BatchServerTransport(batch);
  let rpc = new RpcSession(transport, localMain, options);
  await transport.whenAllReceived();
  await rpc.drain();
  return new Response(new Blob([transport.getResponseBody()]), {
    headers: { "Content-Type": "application/octet-stream" }
  });
}
async function nodeHttpBatchRpcResponse(request, response, localMain, options) {
  if (request.method !== "POST") {
    response.writeHead(405, "This endpoint only accepts POST requests.");
    response.end();
    return;
  }
  let body = await new Promise((resolve, reject) => {
    let chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
  let batch = body.length === 0 ? [] : decodeBatch(body);
  let transport = new BatchServerTransport(batch);
  let rpc = new RpcSession(transport, localMain, options);
  await transport.whenAllReceived();
  await rpc.drain();
  const headers = {
    ...options?.headers,
    "Content-Type": "application/octet-stream"
  };
  response.writeHead(200, headers);
  const responseBody = transport.getResponseBody();
  response.end(Buffer.from(responseBody.buffer, responseBody.byteOffset, responseBody.byteLength));
}

// ../src/messageport.ts
function newMessagePortRpcSession(port, localMain, options) {
  let transport = new MessagePortTransport(port);
  let rpc = new RpcSession(transport, localMain, options);
  return rpc.getRemoteMain();
}
var MessagePortTransport = class {
  constructor(port) {
    this.#port = port;
    port.start();
    port.addEventListener("message", (event) => {
      if (this.#error) {
      } else if (event.data === null) {
        this.#receivedError(new Error("Peer closed MessagePort connection."));
      } else if (event.data instanceof ArrayBuffer) {
        const message = new Uint8Array(event.data);
        if (this.#receiveResolver) {
          this.#receiveResolver(message);
          this.#receiveResolver = void 0;
          this.#receiveRejecter = void 0;
        } else {
          this.#receiveQueue.push(message);
        }
      } else if (event.data instanceof Uint8Array) {
        if (this.#receiveResolver) {
          this.#receiveResolver(event.data);
          this.#receiveResolver = void 0;
          this.#receiveRejecter = void 0;
        } else {
          this.#receiveQueue.push(event.data);
        }
      } else {
        this.#receivedError(new TypeError("Received non-binary message from MessagePort."));
      }
    });
    port.addEventListener("messageerror", (event) => {
      this.#receivedError(new Error("MessagePort message error."));
    });
  }
  #port;
  #receiveResolver;
  #receiveRejecter;
  #receiveQueue = [];
  #error;
  async send(message) {
    if (this.#error) {
      throw this.#error;
    }
    try {
      this.#port.postMessage(message, [message.buffer]);
    } catch (err) {
      this.#port.postMessage(message);
    }
  }
  async receive() {
    if (this.#receiveQueue.length > 0) {
      return this.#receiveQueue.shift();
    } else if (this.#error) {
      throw this.#error;
    } else {
      return new Promise((resolve, reject) => {
        this.#receiveResolver = resolve;
        this.#receiveRejecter = reject;
      });
    }
  }
  abort(reason) {
    try {
      this.#port.postMessage(null);
    } catch (err) {
    }
    this.#port.close();
    if (!this.#error) {
      this.#error = reason;
    }
  }
  #receivedError(reason) {
    if (!this.#error) {
      this.#error = reason;
      if (this.#receiveRejecter) {
        this.#receiveRejecter(reason);
        this.#receiveResolver = void 0;
        this.#receiveRejecter = void 0;
      }
    }
  }
};

// ../src/map.ts
var currentMapBuilder;
var MapBuilder = class {
  context;
  captureMap = /* @__PURE__ */ new Map();
  instructions = [];
  constructor(subject, path) {
    if (currentMapBuilder) {
      this.context = {
        parent: currentMapBuilder,
        captures: [],
        subject: currentMapBuilder.capture(subject),
        path
      };
    } else {
      this.context = {
        parent: void 0,
        captures: [],
        subject,
        path
      };
    }
    currentMapBuilder = this;
  }
  unregister() {
    currentMapBuilder = this.context.parent;
  }
  makeInput() {
    return new MapVariableHook(this, 0);
  }
  makeOutput(result) {
    let devalued;
    try {
      devalued = Devaluator.devaluate(result.value, void 0, this, result);
    } finally {
      result.dispose();
    }
    this.instructions.push(devalued);
    if (this.context.parent) {
      this.context.parent.instructions.push(
        [
          "remap",
          this.context.subject,
          this.context.path,
          this.context.captures.map((cap) => ["import", cap]),
          this.instructions
        ]
      );
      return new MapVariableHook(this.context.parent, this.context.parent.instructions.length);
    } else {
      return this.context.subject.map(this.context.path, this.context.captures, this.instructions);
    }
  }
  pushCall(hook, path, params) {
    let devalued = Devaluator.devaluate(params.value, void 0, this, params);
    devalued = devalued[0];
    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path, devalued]);
    return new MapVariableHook(this, this.instructions.length);
  }
  pushGet(hook, path) {
    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path]);
    return new MapVariableHook(this, this.instructions.length);
  }
  capture(hook) {
    if (hook instanceof MapVariableHook && hook.mapper === this) {
      console.log(`[MAP CAPTURE] Own MapVariableHook idx=${hook.idx}`);
      return hook.idx;
    }
    let result = this.captureMap.get(hook);
    if (result === void 0) {
      if (this.context.parent) {
        let parentIdx = this.context.parent.capture(hook);
        this.context.captures.push(parentIdx);
        console.log(`[MAP CAPTURE] Via parent, parentIdx=${parentIdx}, captures now:`, this.context.captures);
      } else {
        this.context.captures.push(hook);
        console.log(`[MAP CAPTURE] Root capture, hook type=${hook.constructor.name}, captures.length=${this.context.captures.length}`);
      }
      result = -this.context.captures.length;
      this.captureMap.set(hook, result);
    }
    console.log(`[MAP CAPTURE] Returning result=${result}`);
    return result;
  }
  // ---------------------------------------------------------------------------
  // implements Exporter
  exportStub(hook) {
    throw new Error(
      "Can't construct an RpcTarget or RPC callback inside a mapper function. Try creating a new RpcStub outside the callback first, then using it inside the callback."
    );
  }
  exportPromise(hook) {
    return this.exportStub(hook);
  }
  getImport(hook) {
    return this.capture(hook);
  }
  unexport(ids) {
  }
  onSendError(error) {
  }
};
mapImpl.sendMap = (hook, path, func) => {
  let builder = new MapBuilder(hook, path);
  let result;
  try {
    result = RpcPayload.fromAppReturn(withCallInterceptor(builder.pushCall.bind(builder), () => {
      return func(new RpcPromise(builder.makeInput(), []));
    }));
  } finally {
    builder.unregister();
  }
  if (result instanceof Promise) {
    result.catch((err) => {
    });
    throw new Error("RPC map() callbacks cannot be async.");
  }
  return new RpcPromise(builder.makeOutput(result), []);
};
function throwMapperBuilderUseError() {
  throw new Error(
    "Attempted to use an abstract placeholder from a mapper function. Please make sure your map function has no side effects."
  );
}
var MapVariableHook = class extends StubHook {
  constructor(mapper, idx) {
    super();
    this.mapper = mapper;
    this.idx = idx;
  }
  // We don't have anything we actually need to dispose, so dup() can just return the same hook.
  dup() {
    return this;
  }
  dispose() {
  }
  get(path) {
    if (path.length == 0) {
      return this;
    } else if (currentMapBuilder) {
      return currentMapBuilder.pushGet(this, path);
    } else {
      throwMapperBuilderUseError();
    }
  }
  // Other methods should never be called.
  call(path, args) {
    throwMapperBuilderUseError();
  }
  map(path, captures, instructions) {
    throwMapperBuilderUseError();
  }
  pull() {
    throwMapperBuilderUseError();
  }
  ignoreUnhandledRejections() {
  }
  onBroken(callback) {
    throwMapperBuilderUseError();
  }
};
var MapApplicator = class _MapApplicator {
  constructor(captures, input) {
    this.captures = captures;
    this.variables = [input];
    this.instanceId = ++_MapApplicator.instanceCount;
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} created, captures.length=${captures.length}, input=${input.constructor.name}`);
  }
  variables;
  static instanceCount = 0;
  instanceId;
  dispose() {
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} dispose() called, variables.length=${this.variables.length}`);
    for (let variable of this.variables) {
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} disposing variable: ${variable.constructor.name}`);
      variable.dispose();
    }
  }
  apply(instructions) {
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} apply() called, instructions.length=${instructions.length}`);
    try {
      if (instructions.length < 1) {
        throw new Error("Invalid empty mapper function.");
      }
      for (let instruction of instructions.slice(0, -1)) {
        console.log(`[MAP APPLY] MapApplicator#${this.instanceId} evaluating instruction:`, JSON.stringify(instruction).substring(0, 100));
        let payload = new Evaluator(this).evaluateCopy(instruction);
        if (payload.value instanceof RpcStub) {
          let hook = unwrapStubNoProperties(payload.value);
          if (hook) {
            this.variables.push(hook);
            console.log(`[MAP APPLY] MapApplicator#${this.instanceId} added unwrapped hook to variables, now ${this.variables.length}`);
            continue;
          }
        }
        this.variables.push(new PayloadStubHook(payload));
        console.log(`[MAP APPLY] MapApplicator#${this.instanceId} added PayloadStubHook to variables, now ${this.variables.length}`);
      }
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} evaluating final instruction`);
      return new Evaluator(this).evaluateCopy(instructions[instructions.length - 1]);
    } finally {
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} apply() completed`);
    }
  }
  importStub(idx) {
    throw new Error("A mapper function cannot refer to exports.");
  }
  importPromise(idx) {
    return this.importStub(idx);
  }
  getExport(idx) {
    let result;
    if (idx < 0) {
      result = this.captures[-idx - 1];
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} getExport(${idx}) -> captures[${-idx - 1}] = ${result?.constructor.name}`);
    } else {
      result = this.variables[idx];
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} getExport(${idx}) -> variables[${idx}] = ${result?.constructor.name}`);
    }
    return result;
  }
};
function applyMapToElement(input, parent, owner, captures, instructions) {
  console.log(`[MAP ELEMENT] applyMapToElement called, input type=${typeof input}, captures.length=${captures.length}`);
  let inputHook = new PayloadStubHook(RpcPayload.deepCopyFrom(input, parent, owner));
  let mapper = new MapApplicator(captures, inputHook);
  try {
    return mapper.apply(instructions);
  } finally {
    console.log(`[MAP ELEMENT] applyMapToElement finally block, calling mapper.dispose()`);
    mapper.dispose();
  }
}
mapImpl.applyMap = (input, parent, owner, captures, instructions) => {
  try {
    let result;
    if (input instanceof RpcPromise) {
      throw new Error("applyMap() can't be called on RpcPromise");
    } else if (input instanceof Array) {
      let payloads = [];
      try {
        for (let elem of input) {
          payloads.push(applyMapToElement(elem, input, owner, captures, instructions));
        }
      } catch (err) {
        for (let payload of payloads) {
          payload.dispose();
        }
        throw err;
      }
      result = RpcPayload.fromArray(payloads);
    } else if (input === null || input === void 0) {
      result = RpcPayload.fromAppReturn(input);
    } else {
      result = applyMapToElement(input, parent, owner, captures, instructions);
    }
    return new PayloadStubHook(result);
  } finally {
    for (let cap of captures) {
      cap.dispose();
    }
  }
};
function forceInitMap() {
}

// ../src/rpc-handler-registry.ts
var RpcHandlerRegistry = class {
  handlers = /* @__PURE__ */ new Map();
  /**
   * Register a handler for a given key.
   *
   * IMPORTANT: This calls dup() on the handler to keep it alive.
   * Without dup(), the handler would be disposed when the RPC call
   * that passed it completes.
   *
   * If a handler already exists for this key, it is disposed and replaced.
   *
   * @param key - Unique identifier for this handler
   * @param handler - The RpcStub to store (will be dup'd)
   */
  register(key, handler) {
    const existing = this.handlers.get(key);
    if (existing) {
      this.disposeHandler(existing);
    }
    const stableHandler = this.dupHandler(handler);
    this.handlers.set(key, stableHandler);
  }
  /**
   * Unregister and dispose a handler.
   *
   * @param key - The key of the handler to remove
   * @returns true if a handler was removed, false if none existed
   */
  unregister(key) {
    const handler = this.handlers.get(key);
    if (handler) {
      this.disposeHandler(handler);
      this.handlers.delete(key);
      return true;
    }
    return false;
  }
  /**
   * Get a handler by key.
   *
   * @param key - The key to look up
   * @returns The handler stub, or undefined if not found
   */
  get(key) {
    return this.handlers.get(key);
  }
  /**
   * Check if a handler exists for a key.
   */
  has(key) {
    return this.handlers.has(key);
  }
  /**
   * Get all registered keys.
   */
  keys() {
    return this.handlers.keys();
  }
  /**
   * Get the number of registered handlers.
   */
  get size() {
    return this.handlers.size;
  }
  /**
   * Dispose all handlers and clear the registry.
   *
   * Call this when the containing object is being destroyed
   * (e.g., on connection close).
   */
  dispose() {
    for (const handler of this.handlers.values()) {
      this.disposeHandler(handler);
    }
    this.handlers.clear();
  }
  /**
   * Iterate over all handlers.
   */
  forEach(callback) {
    this.handlers.forEach((handler, key) => callback(handler, key));
  }
  /**
   * Duplicate a handler to keep it alive.
   * Handles the case where dup() might not exist.
   */
  dupHandler(handler) {
    const anyHandler = handler;
    if (typeof anyHandler.dup === "function") {
      return anyHandler.dup();
    }
    return handler;
  }
  /**
   * Dispose a handler safely.
   */
  disposeHandler(handler) {
    try {
      const anyHandler = handler;
      if (typeof anyHandler[Symbol.dispose] === "function") {
        anyHandler[Symbol.dispose]();
      }
    } catch (err) {
      console.warn("[RpcHandlerRegistry] Error disposing handler:", err);
    }
  }
};

// ../src/hibernation.ts
function __experimental_newDurableObjectSessionStore(storage, prefix = "capnweb:session:") {
  return {
    async load(sessionId) {
      const value = await storage.get(`${prefix}${sessionId}`);
      return value;
    },
    async save(sessionId, snapshot) {
      await storage.put(`${prefix}${sessionId}`, snapshot);
    },
    async delete(sessionId) {
      await storage.delete?.(`${prefix}${sessionId}`);
    }
  };
}

// ../src/index.ts
forceInitMap();
var RpcStub2 = RpcStub;
var RpcPromise2 = RpcPromise;
var RpcSession2 = RpcSession;
var RpcTarget4 = RpcTarget;
var newWebSocketRpcSession2 = newWebSocketRpcSession;
var __experimental_newHibernatableWebSocketRpcSession2 = __experimental_newHibernatableWebSocketRpcSession;
var __experimental_resumeHibernatableWebSocketRpcSession2 = __experimental_resumeHibernatableWebSocketRpcSession;
var newHttpBatchRpcSession2 = newHttpBatchRpcSession;
var newMessagePortRpcSession2 = newMessagePortRpcSession;
async function newWorkersRpcResponse(request, localMain) {
  if (request.method === "POST") {
    let response = await newHttpBatchRpcResponse(request, localMain);
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  } else if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return newWorkersWebSocketRpcResponse(request, localMain);
  } else {
    return new Response("This endpoint only accepts POST or WebSocket requests.", { status: 400 });
  }
}
export {
  CborCodec,
  RpcHandlerRegistry,
  RpcPromise2 as RpcPromise,
  RpcSession2 as RpcSession,
  RpcStub2 as RpcStub,
  RpcTarget4 as RpcTarget,
  __experimental_newDurableObjectSessionStore,
  __experimental_newHibernatableWebSocketRpcSession2 as __experimental_newHibernatableWebSocketRpcSession,
  __experimental_resumeHibernatableWebSocketRpcSession2 as __experimental_resumeHibernatableWebSocketRpcSession,
  cborCodec,
  newHttpBatchRpcResponse,
  newHttpBatchRpcSession2 as newHttpBatchRpcSession,
  newMessagePortRpcSession2 as newMessagePortRpcSession,
  newWebSocketRpcSession2 as newWebSocketRpcSession,
  newWorkersRpcResponse,
  newWorkersWebSocketRpcResponse,
  nodeHttpBatchRpcResponse
};
