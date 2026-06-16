import {
  pauseTracking,
  resetTracking,
  ReactiveEffect,
  triggerEffects,
  createDep,
  setGlobalEffectScheduler
} from './dep.js'
import { debug } from './debug.js'

let batching = false
const pendingEffects: Set<ReactiveEffect> = new Set()

export function batch<T>(fn: () => T): T {
  if (batching) {
    return fn()
  }

  batching = true
  if (debug.enabled) {
    debug.trackBatchStart()
  }

  try {
    const result = fn()
    batching = false
    const merged = pendingEffects.size
    if (debug.enabled && merged > 0) {
      debug.trackBatchMerged(merged)
    }
    flushPendingEffects()
    return result
  } finally {
    if (batching) {
      batching = false
    }
    pendingEffects.clear()
  }
}

export function queueEffectForBatch(effect: ReactiveEffect) {
  if (batching) {
    pendingEffects.add(effect)
  } else {
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}

function flushPendingEffects() {
  const effects = Array.from(pendingEffects)
  pendingEffects.clear()

  if (effects.length === 0) return

  const dep = createDep(effects)
  triggerEffects(dep)
}

export function isBatching(): boolean {
  return batching
}

let inAction = false
const actionStack: boolean[] = []

export function action<T>(fn: () => T): T {
  const alreadyInAction = inAction
  actionStack.push(inAction)
  inAction = true

  try {
    return fn()
  } finally {
    actionStack.pop()
    inAction = alreadyInAction || actionStack.length > 0
  }
}

export function runInAction<T>(name: string, fn: () => T): T
export function runInAction<T>(fn: () => T): T
export function runInAction<T>(arg1: string | (() => T), arg2?: () => T): T {
  const fn = (typeof arg1 === 'function' ? arg1 : arg2) as () => T
  return batch(fn)
}

export interface IAutorunOptions {
  delay?: number
  scheduler?: (callback: () => void) => void
  onError?: (error: any) => void
}

export class ReactionScheduler {
  private queue: Set<() => void> = new Set()
  private scheduled = false
  private flushPromise: Promise<void> | null = null

  schedule(callback: () => void) {
    this.queue.add(callback)
    if (!this.scheduled) {
      this.scheduled = true
      this.flushPromise = Promise.resolve().then(() => this.flush())
    }
  }

  private flush() {
    const items = Array.from(this.queue)
    this.queue.clear()
    this.scheduled = false

    for (const callback of items) {
      try {
        callback()
      } catch (e) {
        console.error('Error in reaction scheduler:', e)
      }
    }
  }

  async flushSync() {
    if (this.flushPromise) {
      await this.flushPromise
    }
  }
}

export const reactionScheduler = new ReactionScheduler()

export class Transaction {
  private effects: ReactiveEffect[] = []
  private committed = false

  commit() {
    if (this.committed) return
    this.committed = true

    for (const effect of this.effects) {
      if (effect.scheduler) {
        effect.scheduler()
      } else {
        effect.run()
      }
    }
    this.effects = []
  }

  rollback() {
    this.effects = []
    this.committed = true
  }

  addEffect(effect: ReactiveEffect) {
    if (!this.committed && !this.effects.includes(effect)) {
      this.effects.push(effect)
    }
  }
}

let currentTransaction: Transaction | null = null

export function createTransaction(): Transaction {
  return new Transaction()
}

export function runInTransaction<T>(fn: () => T): T {
  const transaction = new Transaction()
  const prevTransaction = currentTransaction
  currentTransaction = transaction

  try {
    const result = fn()
    transaction.commit()
    return result
  } catch (e) {
    transaction.rollback()
    throw e
  } finally {
    currentTransaction = prevTransaction
  }
}

export function getCurrentTransaction(): Transaction | null {
  return currentTransaction
}

export function queueEffect(effect: ReactiveEffect) {
  const transaction = getCurrentTransaction()
  if (transaction) {
    transaction.addEffect(effect)
  } else if (isBatching()) {
    queueEffectForBatch(effect)
  } else {
    if (effect.scheduler) {
      effect.scheduler()
    } else {
      effect.run()
    }
  }
}

let untrackedDepth = 0

export function untracked<T>(fn: () => T): T {
  untrackedDepth++
  pauseTracking()
  try {
    return fn()
  } finally {
    untrackedDepth--
    if (untrackedDepth === 0) {
      resetTracking()
    }
  }
}

export function isUntracked(): boolean {
  return untrackedDepth > 0
}

setGlobalEffectScheduler(queueEffect)
