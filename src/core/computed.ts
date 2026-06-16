import {
  ReactiveEffect,
  ReactiveEffectOptions,
  trackEffects,
  triggerEffects,
  createDep,
  Dep,
  isTracking
} from './dep.js'
import { isObject } from './dep.js'
import { reactive, ReactiveFlags, WritableComputedRef, ComputedRef } from './reactive.js'
import { debug } from './debug.js'

export interface ComputedOptions<T> {
  get?: () => T
  set?: (value: T) => void
}

export interface WritableComputedOptions<T> {
  get: () => T
  set: (value: T) => void
}

declare module './reactive.js' {
  export interface WritableComputedRef<T> extends ComputedRef<T> {
    value: T
  }
}

const NOOP = () => {}

export class ComputedRefImpl<T> {
  public dep?: Dep = undefined
  private _value!: T
  public readonly effect: ReactiveEffect<T>
  public readonly __v_isRef = true
  public readonly __v_isReadonly: boolean = false
  public _dirty = true
  public _cacheable: boolean

  constructor(
    getter: () => T,
    private readonly _setter: (v: T) => void,
    isReadonly: boolean
  ) {
    const effectOptions: ReactiveEffectOptions = {
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          triggerRefValue(this)
        }
      }
    }
    this.effect = new ReactiveEffect(getter, effectOptions)
    ;(this.effect as any).computed = this
    this._cacheable = true
    this.__v_isReadonly = isReadonly
  }

  get value() {
    const self = toRaw(this)
    trackRefValue(self)
    if (self._dirty || !self._cacheable) {
      self._dirty = false
      self._value = self.effect.run()!
      if (debug.enabled) {
        debug.trackComputedRun(false)
      }
    } else {
      if (debug.enabled) {
        debug.trackComputedRun(true)
      }
    }
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}

export function computed<T>(getter: () => T, debugOptions?: any): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>,
  debugOptions?: any
): WritableComputedRef<T>
export function computed<T>(
  arg1: (() => T) | WritableComputedOptions<T>,
  arg2: any = EMPTY_OBJ
): ComputedRef<T> | WritableComputedRef<T> {
  const onlyGetter = isFunction(arg1)

  let get: () => T
  let set: (v: T) => void

  if (onlyGetter) {
    get = arg1
    set = NOOP
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      set = () => {
        console.warn('Write operation failed: computed value is readonly')
      }
    }
  } else {
    get = arg1.get
    set = arg1.set
  }

  const cRef = new ComputedRefImpl(get, set, onlyGetter)

  return cRef as any
}

export function trackRefValue(ref: ComputedRefImpl<any>) {
  if (isTracking()) {
    if (!ref.dep) {
      ref.dep = createDep()
    }
    trackEffects(ref.dep)
  }
}

export function triggerRefValue(ref: ComputedRefImpl<any>, newVal?: any) {
  if (ref.dep) {
    triggerEffects(ref.dep)
  }
}

declare module './dep.js' {
  interface ReactiveEffect<T = any> {
    computed?: ComputedRefImpl<T>
  }
}

export function isComputed<T>(value: any): value is ComputedRef<T> {
  return !!(value && value.effect instanceof ReactiveEffect && value.__v_isRef)
}

const isFunction = (val: unknown): val is Function => typeof val === 'function'
const EMPTY_OBJ: { readonly [key: string]: any } = Object.freeze({})

function toRaw<T>(observed: T): T {
  const raw = observed && (observed as any).__v_raw
  return raw ? toRaw(raw) : observed
}

Object.defineProperty(ComputedRefImpl.prototype, ReactiveFlags.RAW, {
  configurable: true,
  get() {
    return undefined
  }
})

export interface IObservableObject<T = any> {
  [key: string]: T
}

export function extendObservable<A extends Object, B extends Object>(
  target: A,
  properties: B
): A & B {
  const descriptors = Object.getOwnPropertyDescriptors(properties)
  for (const key in descriptors) {
    const descriptor = descriptors[key]
    if (descriptor.get || descriptor.set) {
      defineObservableProperty(target, key, {
        get: descriptor.get,
        set: descriptor.set
      }, target)
    } else {
      defineObservableProperty(target, key, descriptor.value, target)
    }
  }
  return target as A & B
}

export function defineObservableProperty(
  target: any,
  key: string | symbol,
  value: any,
  originalTarget: any
) {
  if (typeof value === 'function') {
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      value: value.bind(target)
    })
  } else if (value && isComputed(value)) {
    const computedValue: any = value
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        return computedValue.value
      },
      set(v: any) {
        computedValue.value = v
      }
    })
  } else if (value && typeof value.get === 'function') {
    const getter = value.get.bind(target)
    const setter = value.set ? value.set.bind(target) : undefined
    const computedValue: any = computed(getter, setter)
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        return computedValue.value
      },
      set(v: any) {
        computedValue.value = v
      }
    })
  } else {
    const reactiveValue = isObject(value) ? reactive(value) : value
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      writable: true,
      value: reactiveValue
    })
  }
}

export function observable<T extends object>(target: T): T {
  if (isObject(target)) {
    const result = reactive({}) as any
    const descriptors = Object.getOwnPropertyDescriptors(target)
    for (const key in descriptors) {
      const descriptor = descriptors[key]
      if (descriptor.get || descriptor.set) {
        defineObservableProperty(result, key, {
          get: descriptor.get,
          set: descriptor.set
        }, target)
      } else {
        defineObservableProperty(result, key, descriptor.value, target)
      }
    }
    return result as T
  }
  return target
}

declare const __DEV__: boolean
