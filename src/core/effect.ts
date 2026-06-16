import {
  ReactiveEffect,
  ReactiveEffectOptions,
  ReactiveEffectRunner,
  shouldTrack,
  pauseTracking,
  resetTracking
} from './dep.js'

export {
  ReactiveEffect,
  activeEffect,
  shouldTrack
} from './dep.js'

export type {
  ReactiveEffectOptions,
  ReactiveEffectRunner
} from './dep.js'

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = {}
): ReactiveEffectRunner<T> {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const _effect = new ReactiveEffect(fn, options)

  if (!options.lazy) {
    _effect.run()
  }

  const runner = _effect.run.bind(_effect) as ReactiveEffectRunner<T>
  runner.effect = _effect
  return runner
}

export function stop(runner: ReactiveEffectRunner) {
  runner.effect.stop()
}

export interface WatchOptions<Immediate = boolean> {
  immediate?: Immediate
  deep?: boolean
  flush?: 'pre' | 'post' | 'sync'
  onTrack?: (event: any) => void
  onTrigger?: (event: any) => void
}

export type WatchEffect = (onCleanup: OnCleanup) => void
export type WatchSource<T = any> = () => T | Ref<T>
export type OnCleanup = (cleanupFn: () => void) => void

export interface Ref<T = any> {
  value: T
  __v_isRef: true
}

export function watchEffect(
  effect: WatchEffect,
  options?: WatchOptions
) {
  return doWatch(effect, null, options as WatchOptions)
}

export function watch<T = any, Immediate extends Readonly<boolean> = false>(
  source: T | WatchSource<T>,
  cb: any,
  options?: WatchOptions<Immediate>
) {
  return doWatch(source as any, cb, options as WatchOptions)
}

function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect | object,
  cb: WatchCallBack | null,
  options: WatchOptions = {}
) {
  const { immediate, deep: deepOption, flush = 'pre' } = options
  let deep = deepOption

  let getter: () => any
  let forceTrigger = false
  let isMultiSource = false

  if (isRef(source)) {
    getter = () => source.value
    forceTrigger = isShallow(source)
  } else if (isReactive(source)) {
    getter = () => source
    deep = true
  } else if (isArray(source)) {
    isMultiSource = true
    forceTrigger = source.some(s => isReactive(s) || isShallow(s))
    getter = () =>
      source.map(s => {
        if (isRef(s)) {
          return s.value
        } else if (isReactive(s)) {
          return traverse(s)
        } else if (isFunction(s)) {
          return s()
        }
        return undefined
      })
  } else if (isFunction(source)) {
    if (cb) {
      getter = () => (source as () => any)()
    } else {
      getter = () => {
        if (cleanup) {
          cleanup()
        }
        return (source as WatchEffect)(onCleanup)
      }
    }
  } else {
    getter = () => {}
  }

  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  let cleanup: () => void
  let onCleanup: OnCleanup = (fn: () => void) => {
    cleanup = effectInstance.onStop = () => {
      fn()
    }
  }

  let oldValue: any = isMultiSource
    ? new Array((source as []).length).fill(INITIAL_WATCHER_VALUE)
    : INITIAL_WATCHER_VALUE
  let job: SchedulerJob
  const jobRunner = () => {
    if (!effectInstance.active) {
      return
    }
    if (cb) {
      const newValue = effectInstance.run()
      if (
        deep ||
        forceTrigger ||
        (isMultiSource
          ? (newValue as any[]).some((v, i) => hasChanged(v, (oldValue as any[])[i]))
          : hasChanged(newValue, oldValue))
      ) {
        if (cleanup) {
          cleanup()
        }
        cb(newValue, oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue, onCleanup)
        oldValue = newValue
      }
    } else {
      effectInstance.run()
    }
  }

  job = jobRunner
  job.allowRecurse = !!cb

  let scheduler: ReactiveEffectOptions['scheduler']

  if (flush === 'sync') {
    scheduler = () => job()
  } else {
    scheduler = () => queueJob(job)
  }

  const effectInstance = new ReactiveEffect(getter, { scheduler })

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    effectInstance.onTrack = options.onTrack
    effectInstance.onTrigger = options.onTrigger
  }

  const unwatch = () => {
    effectInstance.stop()
  }

  if (cb) {
    if (immediate) {
      job()
    } else {
      oldValue = effectInstance.run()
    }
  } else {
    effectInstance.run()
  }

  return unwatch
}

type WatchCallBack<T = any, V = any> = (
  newValue: T,
  oldValue: V,
  onCleanup: OnCleanup
) => void

const INITIAL_WATCHER_VALUE = {}

function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
function isRef(r: any): r is Ref {
  return Boolean(r && r.__v_isRef === true)
}

function isReactive(value: unknown): boolean {
  return !!(value && (value as any).__v_isReactive)
}

function isShallow(value: unknown): boolean {
  return !!(value && (value as any).__v_isShallow)
}

function isFunction(value: unknown): value is Function {
  return typeof value === 'function'
}

function isArray(value: unknown): value is any[] {
  return Array.isArray(value)
}

function hasChanged(value: any, oldValue: any): boolean {
  return !Object.is(value, oldValue)
}

const seenObjects = new WeakSet()

function traverse(value: unknown, seen: WeakSet<object> = seenObjects): any {
  if (!isObject(value) || (value as any).__v_skip) {
    return value
  }
  if (seen.has(value as object)) {
    return value
  }
  seen.add(value as object)
  if (isRef(value)) {
    traverse(value.value, seen)
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (value instanceof Map) {
    value.forEach((v, key) => {
      traverse(key, seen)
      traverse(v, seen)
    })
  } else if (value instanceof Set) {
    value.forEach(v => traverse(v, seen))
  } else if (isObject(value)) {
    for (const key in value) {
      traverse((value as Record<string, any>)[key], seen)
    }
  }
  return value
}

function isObject(val: unknown): val is Record<any, any> {
  return val !== null && typeof val === 'object'
}

const queue: SchedulerJob[] = []
let flushIndex = -1

const pendingPostFlushCbs: SchedulerJob[] = []
let activePostFlushCbs: SchedulerJob[] | null = null
let postFlushIndex = 0

const resolvedPromise = Promise.resolve() as Promise<any>
let currentFlushPromise: Promise<void> | null = null

const RECURSION_LIMIT = 100
type CountMap = Map<SchedulerJob, number>

export interface SchedulerJob extends Function {
  id?: number
  pre?: boolean
  active?: boolean
  computed?: boolean
  allowRecurse?: boolean
  once?: boolean
}

export interface SchedulerCb extends Function {
  id?: number
}

export function nextTick<T = void>(
  this: T,
  fn?: (this: T) => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

export function queueJob(job: SchedulerJob) {
  if (
    (!queue.length ||
      !queue.includes(
        job,
        flushIndex + 1
      )) &&
    job !== currentPreFlushParentJob
  ) {
    if (job.id == null) {
      queue.push(job)
    } else {
      queue.splice(findInsertionIndex(job.id), 0, job)
    }
    queueFlush()
  }
}

let isFlushing = false
let isFlushPending = false

function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

function findInsertionIndex(id: number) {
  let start = flushIndex + 1
  let end = queue.length

  while (start < end) {
    const middle = (start + end) >>> 1
    const middleJob = queue[middle]
    const middleJobId = getId(middleJob)
    if (middleJobId < id || (middleJobId === id && middleJob.allowRecurse)) {
      start = middle + 1
    } else {
      end = middle
    }
  }

  return start
}

const getId = (job: SchedulerJob): number =>
  job.id == null ? Infinity : job.id

let currentPreFlushParentJob: SchedulerJob | null = null

function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    seen = seen || new Map()
  }

  queue.sort(comparator)

  const check = typeof __DEV__ !== 'undefined' && __DEV__
    ? (job: SchedulerJob) => checkRecursiveUpdates(seen!, job)
    : NOOP

  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job && job.active !== false) {
        if (typeof __DEV__ !== 'undefined' && __DEV__ && check(job)) {
          continue
        }
        if (job.pre) {
          currentPreFlushParentJob = job
        }
        callWithErrorHandling(job, null, 14)
        currentPreFlushParentJob = null
      }
    }
  } finally {
    flushIndex = -1
    queue.length = 0

    flushPostFlushCbs(seen)

    isFlushing = false
    currentFlushPromise = null

    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs(seen)
    }
  }
}

function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob) {
  const count = seen.get(fn) || 0
  if (count > RECURSION_LIMIT) {
    console.warn(
      `Maximum recursive updates exceeded. ` +
        `This means you have a reactive effect that is mutating its own ` +
        `dependencies and thus recursively triggering itself.`
    )
    return true
  }
  seen.set(fn, count + 1)
  return false
}

const comparator = (a: SchedulerJob, b: SchedulerJob) => {
  const diff = getId(a) - getId(b)
  if (diff === 0) {
    if (a.pre && !b.pre) return -1
    if (b.pre && !a.pre) return 1
  }
  return diff
}

export function queuePostFlushCb(cb: SchedulerCb | SchedulerCb[]) {
  if (!isArray(cb)) {
    if (
      !activePostFlushCbs ||
      !activePostFlushCbs.includes(
        cb as SchedulerJob,
        postFlushIndex + 1
      )
    ) {
      pendingPostFlushCbs.push(cb as SchedulerJob)
    }
  } else {
    pendingPostFlushCbs.push(...cb)
  }
  queueFlush()
}

export function flushPostFlushCbs(seen?: CountMap) {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      seen = seen || new Map()
    }

    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      if (
        typeof __DEV__ !== 'undefined' && __DEV__ &&
        checkRecursiveUpdates(seen!, activePostFlushCbs[postFlushIndex])
      ) {
        continue
      }
      activePostFlushCbs[postFlushIndex]()
    }

    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

function callWithErrorHandling(fn: Function, instance: any, type: number, args?: any[]) {
  try {
    fn(...(args || []))
  } catch (e) {
    console.error(e)
  }
}

const NOOP = () => {}

declare const __DEV__: boolean
