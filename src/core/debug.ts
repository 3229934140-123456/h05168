export interface DebugStats {
  effectRuns: number
  computedRuns: number
  computedCacheHits: number
  batchUpdates: number
  batchMerged: number
  triggerCount: number
  trackCount: number
}

export interface DebugEvent {
  type: 'effect' | 'computed' | 'trigger' | 'track' | 'batch'
  message: string
  timestamp: number
}

class Debugger {
  private _enabled = false
  private _stats: DebugStats = {
    effectRuns: 0,
    computedRuns: 0,
    computedCacheHits: 0,
    batchUpdates: 0,
    batchMerged: 0,
    triggerCount: 0,
    trackCount: 0
  }

  private _events: DebugEvent[] = []
  private _maxEvents = 100
  private _listeners: Set<() => void> = new Set()

  get enabled(): boolean {
    return this._enabled
  }

  get stats(): Readonly<DebugStats> {
    return { ...this._stats }
  }

  get events(): Readonly<DebugEvent[]> {
    return [...this._events]
  }

  enable() {
    this._enabled = true
  }

  disable() {
    this._enabled = false
  }

  reset() {
    this._stats = {
      effectRuns: 0,
      computedRuns: 0,
      computedCacheHits: 0,
      batchUpdates: 0,
      batchMerged: 0,
      triggerCount: 0,
      trackCount: 0
    }
    this._events = []
    this._notify()
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  private _notify() {
    this._listeners.forEach(fn => fn())
  }

  private _addEvent(type: DebugEvent['type'], message: string) {
    if (!this._enabled) return
    this._events.push({
      type,
      message,
      timestamp: Date.now()
    })
    if (this._events.length > this._maxEvents) {
      this._events.shift()
    }
    this._notify()
  }

  trackEffectRun() {
    if (!this._enabled) return
    this._stats.effectRuns++
    this._notify()
  }

  trackComputedRun(cached: boolean) {
    if (!this._enabled) return
    if (cached) {
      this._stats.computedCacheHits++
    } else {
      this._stats.computedRuns++
    }
    this._notify()
  }

  trackTrigger() {
    if (!this._enabled) return
    this._stats.triggerCount++
    this._notify()
  }

  trackTrack() {
    if (!this._enabled) return
    this._stats.trackCount++
    this._notify()
  }

  trackBatchStart() {
    if (!this._enabled) return
    this._stats.batchUpdates++
    this._notify()
  }

  trackBatchMerged(count: number) {
    if (!this._enabled) return
    this._stats.batchMerged += count
    this._notify()
  }

  log(type: DebugEvent['type'], message: string) {
    this._addEvent(type, message)
  }
}

export const debug = new Debugger()
