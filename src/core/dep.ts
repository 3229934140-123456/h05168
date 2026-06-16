export interface ReactiveEffectOptions {
  scheduler?: EffectScheduler
  lazy?: boolean
  onStop?: () => void
  allowRecurse?: boolean
  onTrack?: (event: any) => void
  onTrigger?: (event: any) => void
}

import { debug } from './debug.js'

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export type Dep = Set<ReactiveEffect> & {
  w: number
  n: number
}

export class ReactiveEffect<T = any> {
  active = true
  deps: Dep[] = []
  parent: ReactiveEffect | undefined = undefined
  onStop?: () => void
  scheduler?: () => void
  allowRecurse?: boolean
  onTrack?: (event: any) => void
  onTrigger?: (event: any) => void

  constructor(
    public fn: () => T,
    options: ReactiveEffectOptions = {}
  ) {
    this.scheduler = options.scheduler
    this.onStop = options.onStop
    this.allowRecurse = options.allowRecurse
    this.onTrack = options.onTrack
    this.onTrigger = options.onTrigger
  }

  run(): T {
    if (!this.active) {
      return this.fn()
    }

    let parent: ReactiveEffect | undefined = activeEffect
    let lastShouldTrack = shouldTrack

    while (parent) {
      if (parent === this) {
        return undefined as any
      }
      parent = parent.parent
    }

    try {
      this.parent = activeEffect
      activeEffect = this
      shouldTrack = true

      cleanupEffect(this)
      if (debug.enabled) {
        debug.trackEffectRun()
      }
      return this.fn()
    } finally {
      activeEffect = this.parent
      shouldTrack = lastShouldTrack
      this.parent = undefined
    }
  }

  stop() {
    if (this.active) {
      cleanupEffect(this)
      if (this.onStop) {
        this.onStop()
      }
      this.active = false
    }
  }
}

function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

export let activeEffect: ReactiveEffect | undefined = undefined
export let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last !== undefined ? last : true
}

export function isTracking() {
  return shouldTrack && activeEffect !== undefined
}

const targetMap = new WeakMap<any, Map<any, Dep>>()

export function createDep(effects?: ReactiveEffect[]): Dep {
  const dep = new Set<ReactiveEffect>(effects) as Dep
  dep.w = 0
  dep.n = 0
  return dep
}

export function track(target: object, key: unknown) {
  if (!isTracking()) return

  let depsMap = targetMap.get(target)
  if (!depsMap) {
    depsMap = new Map()
    targetMap.set(target, depsMap)
  }

  let dep = depsMap.get(key)
  if (!dep) {
    dep = createDep()
    depsMap.set(key, dep)
  }

  trackEffects(dep)
}

export function trackEffects(dep: Dep) {
  let shouldTrack = !dep.has(activeEffect!)

  if (shouldTrack) {
    dep.add(activeEffect!)
    activeEffect!.deps.push(dep)
    if (debug.enabled) {
      debug.trackTrack()
    }
  }
}

export function trigger(
  target: object,
  key: unknown,
  type: TriggerOpTypes = TriggerOpTypes.SET,
  newValue?: unknown
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return

  const deps: (Dep | undefined)[] = []

  if (key === 'length' && Array.isArray(target)) {
    const newLength = Number(newValue)
    depsMap.forEach((dep, k) => {
      if (k === 'length' || (typeof k !== 'symbol' && Number(k) >= newLength)) {
        deps.push(dep)
      }
    })
  } else {
    if (key !== undefined) {
      deps.push(depsMap.get(key))
    }

    if (type === TriggerOpTypes.ADD || type === TriggerOpTypes.DELETE) {
      deps.push(depsMap.get(ITERATE_KEY))
      if (Array.isArray(target)) {
        deps.push(depsMap.get('length'))
      }
      if (target instanceof Map) {
        deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
      }
    }

    if (type === TriggerOpTypes.CLEAR) {
      deps.push(depsMap.get(ITERATE_KEY))
      if (target instanceof Map) {
        deps.push(depsMap.get(MAP_KEY_ITERATE_KEY))
      }
    }
  }

  const effects: ReactiveEffect[] = []
  for (const dep of deps) {
    if (dep) {
      effects.push(...dep)
    }
  }

  if (effects.length > 0) {
    if (debug.enabled) {
      debug.trackTrigger()
    }
    triggerEffects(createDep(effects))
  }
}

export type EffectSchedulerFn = (effect: ReactiveEffect) => void
export type EffectScheduler = () => void

let globalEffectScheduler: EffectSchedulerFn | null = null

export function setGlobalEffectScheduler(scheduler: EffectSchedulerFn | null) {
  globalEffectScheduler = scheduler
}

export function getGlobalEffectScheduler(): EffectSchedulerFn | null {
  return globalEffectScheduler
}

export function triggerEffects(dep: Dep) {
  const effects = [...dep]

  for (const effect of effects) {
    if (effect !== activeEffect || effect.allowRecurse) {
      if (globalEffectScheduler) {
        globalEffectScheduler(effect)
      } else if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()
      }
    }
  }
}

export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}

export const ITERATE_KEY = Symbol('iterate')
export const MAP_KEY_ITERATE_KEY = Symbol('Map key iterate')

export const hasOwn = (val: object, key: string | symbol): key is keyof typeof val =>
  Object.prototype.hasOwnProperty.call(val, key)

export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isIntegerKey = (key: unknown) =>
  typeof key === 'string' && key !== 'NaN' && key[0] !== '-' && '' + parseInt(key, 10) === key
