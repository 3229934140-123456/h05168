import {
  track,
  trigger,
  ITERATE_KEY,
  MAP_KEY_ITERATE_KEY,
  hasOwn,
  isObject,
  isIntegerKey,
  TriggerOpTypes,
  pauseTracking,
  resetTracking,
  trackEffects,
  triggerEffects,
  createDep,
  isTracking
} from './dep.js'

export const enum ReactiveFlags {
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw',
  SKIP = '__v_skip'
}

export interface Target {
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.IS_SHALLOW]?: boolean
  [ReactiveFlags.RAW]?: any
  [ReactiveFlags.SKIP]?: boolean
}

export interface ComputedRef<T = any> {
  readonly value: T
  readonly __v_isRef: true
  readonly __v_isReadonly: boolean
}

export interface WritableComputedRef<T> extends ComputedRef<T> {
  value: T
}

const reactiveMap = new WeakMap<object, any>()
const readonlyMap = new WeakMap<object, any>()
const shallowReactiveMap = new WeakMap<object, any>()

function isCollectionType(value: unknown): boolean {
  return value instanceof Map || value instanceof Set
}

function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  isShallow: boolean,
  proxyMap: WeakMap<object, any>
) {
  if (!isObject(target)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }

  if (target[ReactiveFlags.RAW]) {
    return target
  }

  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }

  if (target[ReactiveFlags.SKIP] || !Object.isExtensible(target)) {
    return target
  }

  const isCollection = isCollectionType(target)
  const handlers = isCollection
    ? isReadonly
      ? readonlyCollectionHandlers as any
      : mutableCollectionHandlers as any
    : isReadonly
      ? readonlyHandlers
      : isShallow
        ? shallowMutableHandlers
        : mutableHandlers

  const proxy = new Proxy(target, handlers)
  proxyMap.set(target, proxy)
  return proxy
}

export function isReactive(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}

export function markRaw<T extends object>(value: T): T {
  if (Object.isExtensible(value)) {
    Object.defineProperty(value, ReactiveFlags.SKIP, {
      configurable: true,
      enumerable: false,
      value: true
    })
  }
  return value
}

export function reactive<T extends object>(target: T): T {
  if (isReadonly(target)) {
    return target
  }
  return createReactiveObject(target, false, false, reactiveMap)
}

export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(target, false, true, shallowReactiveMap)
}

export function readonly<T extends object>(target: T): T {
  return createReactiveObject(target, true, false, readonlyMap)
}

const arrayInstrumentations: Record<string, Function> = {}

;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function(this: any[], ...args: any[]) {
    const arr = toRaw(this)
    for (let i = 0, l = this.length; i < l; i++) {
      track(arr, i + '')
    }
    const res = (arr as any)[key](...args)
    if (res === -1 || res === false) {
      return (arr as any)[key](...args.map(toRaw))
    } else {
      return res
    }
  }
})

;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  arrayInstrumentations[key] = function(this: any[], ...args: any[]) {
    pauseTracking()
    const res = (Array.prototype[key] as any).apply(this, args)
    resetTracking()
    return res
  }
})

function hasOwnProperty(this: object, key: string) {
  const obj = toRaw(this)
  track(obj, key)
  return obj.hasOwnProperty(key)
}

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter((val: unknown): val is symbol => typeof val === 'symbol')
)

class BaseReactiveHandler implements ProxyHandler<Target> {
  constructor(
    protected readonly _isReadonly = false,
    protected readonly _isShallow = false
  ) {}

  get(target: Target, key: string | symbol, receiver: object) {
    const isReadonly = this._isReadonly
    const isShallow = this._isShallow

    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    } else if (key === ReactiveFlags.RAW) {
      if (
        receiver ===
        (isReadonly
          ? readonlyMap
          : isShallow
            ? shallowReactiveMap
            : reactiveMap
        ).get(target)
      ) {
        return target
      }
      return undefined
    }

    const targetIsArray = Array.isArray(target)
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    if (key === 'hasOwnProperty') {
      return hasOwnProperty
    }

    const res = Reflect.get(target, key, receiver)

    if (typeof key === 'symbol' && builtInSymbols.has(key)) {
      return res
    }

    if (!isReadonly) {
      track(target, key)
    }

    if (isShallow) {
      return res
    }

    if (isObject(res)) {
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

class MutableReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(false, isShallow)
  }

  set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    let oldValue = (target as any)[key]

    if (!this._isShallow) {
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
    }

    const hadKey =
      Array.isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)

    const result = Reflect.set(target, key, value, receiver)

    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, key, TriggerOpTypes.ADD, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, key, TriggerOpTypes.SET, value)
      }
    }

    return result
  }

  deleteProperty(target: object, key: string | symbol): boolean {
    const hadKey = hasOwn(target, key)
    const oldValue = (target as any)[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, key, TriggerOpTypes.DELETE, undefined)
    }
    return result
  }

  has(target: object, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (typeof key !== 'symbol' || !builtInSymbols.has(key)) {
      track(target, key)
    }
    return result
  }

  ownKeys(target: object): (string | symbol)[] {
    track(target, Array.isArray(target) ? 'length' : ITERATE_KEY)
    return Reflect.ownKeys(target)
  }
}

class ReadonlyReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(true, isShallow)
  }

  set(target: object, key: string | symbol) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }

  deleteProperty(target: object, key: string | symbol) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

const mutableHandlers: ProxyHandler<object> = new MutableReactiveHandler()
const shallowMutableHandlers: ProxyHandler<object> = new MutableReactiveHandler(true)
const readonlyHandlers: ProxyHandler<object> = new ReadonlyReactiveHandler()

function hasChanged(value: any, oldValue: any): boolean {
  return !Object.is(value, oldValue)
}

function isShallow(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_SHALLOW])
}

export interface Ref<T = any> {
  value: T
  __v_isRef: true
}

export function ref<T>(value: T): Ref<T>
export function ref(value: unknown): Ref<unknown>
export function ref(value: unknown): any {
  return createRef(value, false)
}

export function shallowRef<T>(value: T): Ref<T>
export function shallowRef(value: unknown): Ref<unknown>
export function shallowRef(value: unknown): any {
  return createRef(value, true)
}

function createRef(rawValue: unknown, shallow: boolean) {
  if (isRef(rawValue)) {
    return rawValue
  }
  return new RefImpl(rawValue, shallow)
}

class RefImpl<T> {
  private _value: T
  private _rawValue: T
  public dep?: any
  public readonly __v_isRef = true

  constructor(value: T, public readonly __v_isShallow: boolean) {
    this._rawValue = __v_isShallow ? value : toRaw(value)
    this._value = __v_isShallow ? value : convert(value)
  }

  get value() {
    trackRefValue(this)
    return this._value
  }

  set value(newVal) {
    const useDirectValue = this.__v_isShallow || isShallow(newVal) || isReadonly(newVal)
    newVal = useDirectValue ? newVal : toRaw(newVal)
    if (hasChanged(newVal, this._rawValue)) {
      this._rawValue = newVal as T
      this._value = useDirectValue ? newVal as T : convert(newVal)
      triggerRefValue(this, newVal)
    }
  }
}

function convert<T>(val: T): T {
  return isObject(val) ? reactive(val as object) as T : val
}

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
export function isRef(r: any): r is Ref {
  return Boolean(r && r.__v_isRef === true)
}

export function trackRefValue(ref: any) {
  if (isTracking()) {
    if (!ref.dep) {
      ref.dep = createDep()
    }
    trackEffects(ref.dep)
  }
}

export function triggerRefValue(ref: any, newVal?: any) {
  if (ref.dep) {
    triggerEffects(ref.dep)
  }
}

// ==================== 集合类型响应式处理 ====================

const mutableCollectionHandlers: ProxyHandler<Map<any, any> | Set<any>> = {
  get(target, key, receiver) {
    target = toRaw(target) as any
    const isReadonly = false
    const isShallow = false

    if (key === ReactiveFlags.IS_REACTIVE) return !isReadonly
    if (key === ReactiveFlags.IS_READONLY) return isReadonly
    if (key === ReactiveFlags.IS_SHALLOW) return isShallow
    if (key === ReactiveFlags.RAW) return target

    if (key === 'size') {
      track(target, ITERATE_KEY)
      return Reflect.get(target, key, target)
    }

    const res = Reflect.get(target, key, target)

    if (key === Symbol.iterator || key === 'entries' || key === 'values' || key === 'keys') {
      return function(this: any) {
        track(target, key === 'keys' ? MAP_KEY_ITERATE_KEY : ITERATE_KEY)
        const iterator = (target as any)[key]()
        const method = key
        return {
          next() {
            const { value, done } = iterator.next()
            if (!done) {
              if (method === 'entries' || target instanceof Map) {
                return { value: [toReactive(value[0]), toReactive(value[1])], done }
              } else {
                return { value: toReactive(value), done }
              }
            }
            return { value, done }
          },
          [Symbol.iterator]() {
            return this
          }
        }
      }
    }

    if (typeof res === 'function') {
      return function(this: any, ...args: any[]) {
        const rawTarget = toRaw(this) as Map<any, any> | Set<any>
        const hadKey = key === 'delete' || key === 'has' || key === 'set' || key === 'add'
          ? rawTarget.has(args[0])
          : false

        let oldValue: any
        if (key === 'set' && hadKey) {
          oldValue = (rawTarget as Map<any, any>).get(args[0])
        }

        const result = res.apply(rawTarget, args)

        if (key === 'set' || key === 'add') {
          if (!hadKey) {
            trigger(rawTarget, args[0], TriggerOpTypes.ADD, args[1] ?? args[0])
          } else if (key === 'set') {
            if (hasChanged(args[1], oldValue)) {
              trigger(rawTarget, args[0], TriggerOpTypes.SET, args[1])
            }
          }
        } else if (key === 'delete') {
          if (hadKey) {
            trigger(rawTarget, args[0], TriggerOpTypes.DELETE)
          }
        } else if (key === 'clear') {
          if ((rawTarget as Map<any, any>).size > 0 || (rawTarget as Set<any>).size > 0) {
            trigger(rawTarget, undefined, TriggerOpTypes.CLEAR)
          }
        } else if (key === 'has') {
          track(rawTarget, args[0])
        } else if (key === 'get') {
          track(rawTarget, args[0])
          return isShallow ? result : toReactive(result)
        } else if (key === 'forEach') {
          track(rawTarget, ITERATE_KEY)
          const [cb, thisArg] = args
          return (rawTarget as Map<any, any>).forEach((value: any, key: any) => {
            cb.call(thisArg, toReactive(value), toReactive(key), receiver)
          })
        }

        return result
      }
    }

    return res
  }
}

const readonlyCollectionHandlers: ProxyHandler<Map<any, any> | Set<any>> = {
  get(target, key, receiver) {
    target = toRaw(target) as any
    const isReadonly = true

    if (key === ReactiveFlags.IS_REACTIVE) return !isReadonly
    if (key === ReactiveFlags.IS_READONLY) return isReadonly
    if (key === ReactiveFlags.RAW) return target

    if (key === 'size') {
      track(target, ITERATE_KEY)
      return Reflect.get(target, key, target)
    }

    if (typeof (target as any)[key] === 'function') {
      if (key === 'set' || key === 'add' || key === 'delete' || key === 'clear') {
        return function() {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn(`collection is readonly`)
          }
          return key === 'delete' ? false : undefined
        }
      }
      return mutableCollectionHandlers.get!.apply(null, [target, key, receiver] as any)
    }

    return Reflect.get(target, key, receiver)
  }
}

function toReactive<T>(value: T): T {
  return isObject(value) ? reactive(value as any) : value
}

declare const __DEV__: boolean
