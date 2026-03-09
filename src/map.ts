// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { StubHook, PropertyPath, RpcPayload, RpcStub, RpcPromise, withCallInterceptor, ErrorStubHook, mapImpl, PayloadStubHook, unwrapStubAndPath, unwrapStubNoProperties } from "./core.js";
import { Devaluator, Exporter, Importer, ExportId, ImportId, Evaluator } from "./serialize.js";

let currentMapBuilder: MapBuilder | undefined;

// We use this type signature when building the instructions for type checking purposes. It
// describes a subset of the overall RPC protocol.
export type MapInstruction =
    | ["pipeline", number, PropertyPath]
    | ["pipeline", number, PropertyPath, unknown]
    | ["remap", number, PropertyPath, ["import", number][], MapInstruction[]]

export type RecordedMapProgram = {
  captures: ["import", number][];
  instructions: unknown[];
};

export class MapBuilder implements Exporter {
  private context:
    | {parent: undefined, captures: StubHook[], subject: StubHook, path: PropertyPath}
    | {parent: MapBuilder, captures: number[], subject: number, path: PropertyPath};
  private captureMap: Map<StubHook, number> = new Map();

  private instructions: MapInstruction[] = [];

  constructor(subject: StubHook, path: PropertyPath) {
    if (currentMapBuilder) {
      this.context = {
        parent: currentMapBuilder,
        captures: [],
        subject: currentMapBuilder.capture(subject),
        path
      };
    } else {
      this.context = {
        parent: undefined,
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

  makeInput(): MapVariableHook {
    return new MapVariableHook(this, 0);
  }

  makeOutput(result: RpcPayload): StubHook {
    let devalued: unknown;
    try {
      devalued = Devaluator.devaluate(result.value, undefined, this, result);
    } finally {
      result.dispose();
    }

    // The result is the final instruction. This doesn't actually fit our MapInstruction type
    // signature, so we cheat a bit.
    this.instructions.push(<any>devalued);

    if (this.context.parent) {
      this.context.parent.instructions.push(
        ["remap", this.context.subject, this.context.path,
                  this.context.captures.map(cap => ["import", cap]),
                  this.instructions]
      );
      return new MapVariableHook(this.context.parent, this.context.parent.instructions.length);
    } else {
      return this.context.subject.map(this.context.path, this.context.captures, this.instructions);
    }
  }

  pushCall(hook: StubHook, path: PropertyPath, params: RpcPayload): StubHook {
    let devalued = Devaluator.devaluate(params.value, undefined, this, params);
    // HACK: Since the args is an array, devaluator will wrap in a second array. Need to unwrap.
    // TODO: Clean this up somehow.
    devalued = (<Array<unknown>>devalued)[0];

    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path, devalued]);
    return new MapVariableHook(this, this.instructions.length);
  }

  pushGet(hook: StubHook, path: PropertyPath): StubHook {
    let subject = this.capture(hook.dup());
    this.instructions.push(["pipeline", subject, path]);
    return new MapVariableHook(this, this.instructions.length);
  }

  capture(hook: StubHook): number {
    if (hook instanceof MapVariableHook && hook.mapper === this) {
      // Oh, this is already our own hook.
      console.log(`[MAP CAPTURE] Own MapVariableHook idx=${hook.idx}`);
      return hook.idx;
    }

    // TODO: Well, the hooks passed in are always unique, so they'll never exist in captureMap.
    //   I suppose this is a problem with RPC as well. We need a way to identify hooks that are
    //   dupes of the same target.
    let result = this.captureMap.get(hook);
    if (result === undefined) {
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

  exportStub(hook: StubHook, _path?: PropertyPath): ExportId {
    // It appears someone did something like:
    //
    //     stub.map(x => { return x.doSomething(new MyRpcTarget()); })
    //
    // That... won't work. They need to do this instead:
    //
    //     using myTargetStub = new RpcStub(new MyRpcTarget());
    //     stub.map(x => { return x.doSomething(myTargetStub.dup()); })
    //
    // TODO(someday): Consider carefully if the inline syntax is maybe OK. If so, perhaps the
    //   serializer could try calling `getImport()` even for known-local hooks.
    // TODO(someday): Do we need to support rpc-thenable somehow?
    throw new Error(
        "Can't construct an RpcTarget or RPC callback inside a mapper function. Try creating a " +
        "new RpcStub outside the callback first, then using it inside the callback.");
  }
  exportPromise(hook: StubHook, _path?: PropertyPath): ExportId {
    return this.exportStub(hook);
  }
  getImport(hook: StubHook): ImportId | undefined {
    return this.capture(hook);
  }

  unexport(ids: Array<ExportId>): void {
    // Presumably this MapBuilder is cooked anyway, so we don't really have to release anything.
  }

  createPipe(readable: ReadableStream): never {
    throw new Error("Cannot send ReadableStream inside a mapper function.");
  }

  onSendError(error: Error): Error | void {
    // TODO(someday): Can we use the error-sender hook from the RPC system somehow?
  }
};

mapImpl.sendMap = (hook: StubHook, path: PropertyPath, func: (promise: RpcPromise) => unknown) => {
  let builder = new MapBuilder(hook, path);
  let result: RpcPayload;
  try {
    result = RpcPayload.fromAppReturn(withCallInterceptor(builder.pushCall.bind(builder), () => {
      return func(new RpcPromise(builder.makeInput(), []));
    }));
  } finally {
    builder.unregister();
  }

  // Detect misuse: Map callbacks cannot be async.
  if (result instanceof Promise) {
    // Squelch unhandled rejections from the map function itself -- it'll probably just throw
    // something about pulling a MapVariableHook.
    result.catch(err => {});

    // Throw an understandable error.
    throw new Error("RPC map() callbacks cannot be async.");
  }

  return new RpcPromise(builder.makeOutput(result), []);
}

function throwMapperBuilderUseError(): never {
  throw new Error(
      "Attempted to use an abstract placeholder from a mapper function. Please make sure your " +
      "map function has no side effects.");
}

// StubHook which represents a variable in a map function.
export class MapVariableHook extends StubHook {
  constructor(public mapper: MapBuilder, public idx: number) {
    super();
  }

  // We don't have anything we actually need to dispose, so dup() can just return the same hook.
  dup(): StubHook { return this; }
  dispose(): void {}

  get(path: PropertyPath): StubHook {
    // This can actually be invoked as part of serialization, so we'll need to support it.
    if (path.length == 0) {
      // Since this hook cannot be pulled anyway, and dispose() is a no-op, we can actually just
      // return the same hook again to represent getting the empty path.
      return this;
    } else if (currentMapBuilder) {
      return currentMapBuilder.pushGet(this, path);
    } else {
      throwMapperBuilderUseError();
    }
  }

  // Other methods should never be called.
  call(path: PropertyPath, args: RpcPayload): StubHook {
    // Can't be called; all calls are intercepted.
    throwMapperBuilderUseError();
  }

  map(path: PropertyPath, captures: StubHook[], instructions: unknown[]): StubHook {
    // Can't be called; all map()s are intercepted.
    throwMapperBuilderUseError();
  }

  pull(): RpcPayload | Promise<RpcPayload> {
    // Map functions cannot await.
    throwMapperBuilderUseError();
  }

  ignoreUnhandledRejections(): void {
    // Probably never called but whatever.
  }

  onBroken(callback: (error: any) => void): void {
    throwMapperBuilderUseError();
  }
}

export function __experimental_recordInputPath(path: PropertyPath): RecordedMapProgram {
  let builder = new MapBuilder(new ErrorStubHook(new Error("map-recorder-subject")), []);
  let result: RpcPayload;
  try {
    let hook = builder.makeInput().get(path);
    result = RpcPayload.fromAppReturn(new RpcPromise(hook, []));
    let devalued = Devaluator.devaluate(result.value, undefined, builder, result);
    // The result is the final instruction, same as makeOutput() does internally.
    builder.instructions.push(<any>devalued);
    return {
      captures: [],
      instructions: [...builder.instructions],
    };
  } finally {
    builder.unregister();
    result?.dispose();
  }
}

// =======================================================================================

class MapApplicator implements Importer {
  private variables: StubHook[];
  private static instanceCount = 0;
  private instanceId: number;

  constructor(private captures: StubHook[], input: StubHook) {
    this.variables = [input];
    this.instanceId = ++MapApplicator.instanceCount;
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} created, captures.length=${captures.length}, input=${input.constructor.name}`);
  }

  dispose() {
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} dispose() called, variables.length=${this.variables.length}`);
    for (let variable of this.variables) {
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} disposing variable: ${variable.constructor.name}`);
      variable.dispose();
    }
  }

  apply(instructions: unknown[]): RpcPayload {
    console.log(`[MAP APPLY] MapApplicator#${this.instanceId} apply() called, instructions.length=${instructions.length}`);
    try {
      if (instructions.length < 1) {
        throw new Error("Invalid empty mapper function.");
      }

      for (let instruction of instructions.slice(0, -1)) {
        console.log(`[MAP APPLY] MapApplicator#${this.instanceId} evaluating instruction:`, JSON.stringify(instruction).substring(0, 100));
        let payload = new Evaluator(this).evaluateCopy(instruction);

        // The payload almost always contains a single stub. As an optimization, unwrap it.
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
      // Note: Variables are disposed by the caller via mapper.dispose(), not here.
      // Disposing here would cause double-disposal which breaks PromiseStubHook's
      // deferred disposal scheduling.
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} apply() completed`);
    }
  }

  importStub(idx: ImportId): StubHook {
    // This implies we saw an "export" appear inside the body of a mapper function. This should be
    // impossible because exportStub()/exportPromise() throw exceptions in MapBuilder.
    throw new Error("A mapper function cannot refer to exports.");
  }
  importPromise(idx: ImportId): StubHook {
    return this.importStub(idx);
  }

  getExport(idx: ExportId): StubHook | undefined {
    let result: StubHook | undefined;
    if (idx < 0) {
      result = this.captures[-idx - 1];
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} getExport(${idx}) -> captures[${-idx - 1}] = ${result?.constructor.name}`);
    } else {
      result = this.variables[idx];
      console.log(`[MAP APPLY] MapApplicator#${this.instanceId} getExport(${idx}) -> variables[${idx}] = ${result?.constructor.name}`);
    }
    return result;
  }

  getPipeReadable(exportId: ExportId): never {
    throw new Error("A mapper function cannot use pipe readables.");
  }
}

function applyMapToElement(input: unknown, parent: object | undefined, owner: RpcPayload | null,
                           captures: StubHook[], instructions: unknown[]): RpcPayload {
  // TODO(perf): I wonder if we could use .fromAppParams() instead of .deepCopyFrom()? It
  //   maybe wouldn't correctly handle the case of RpcTargets in the input, so we need a variant
  //   which takes an `owner`, which does add some complexity.
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

mapImpl.applyMap = (input: unknown, parent: object | undefined, owner: RpcPayload | null,
                    captures: StubHook[], instructions: unknown[]) => {
  try {
    let result: RpcPayload;
    if (input instanceof RpcPromise) {
      // The caller is responsible for making sure the input is not a promise, since we can't
      // then know if it would resolve to an array later.
      throw new Error("applyMap() can't be called on RpcPromise");
    } else if (input instanceof Array) {
      let payloads: RpcPayload[] = [];
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
    } else if (input === null || input === undefined) {
      result = RpcPayload.fromAppReturn(input);
    } else {
      result = applyMapToElement(input, parent, owner, captures, instructions);
    }

    // TODO(perf): We should probably return a hook that allows pipelining but whose pull() doesn't
    //   resolve until all promises in the payload have been substituted.
    return new PayloadStubHook(result);
  } finally {
    for (let cap of captures) {
      cap.dispose();
    }
  }
}

export function forceInitMap() {}
