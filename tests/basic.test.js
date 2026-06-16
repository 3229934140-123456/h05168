// @ts-nocheck
globalThis.__DEV__ = false

import {
  reactive,
  ref,
  computed,
  effect,
  stop,
  watch,
  batch,
  runInAction,
  untracked,
  isReactive,
  isRef,
  isComputed,
  toRaw,
  markRaw,
  observable
} from '../dist/index.js'

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
  console.log(`✓ ${message}`)
}

async function runTests() {
  console.log('\n=== 开始测试 ===\n')

  const tests = [
    { name: '1. reactive 基本功能', fn: test1 },
    { name: '2. ref 基本功能', fn: test2 },
    { name: '3. computed 计算属性', fn: test3 },
    { name: '4. computed 缓存功能', fn: test4 },
    { name: '5. effect 停止', fn: test5 },
    { name: '6. batch 批量更新', fn: test6 },
    { name: '7. runInAction', fn: test7 },
    { name: '8. untracked', fn: test8 },
    { name: '9. watch', fn: test9 },
    { name: '10. watch immediate', fn: test10 },
    { name: '11. toRaw', fn: test11 },
    { name: '12. markRaw', fn: test12 },
    { name: '13. observable', fn: test13 },
    { name: '14. 可写 computed', fn: test14 },
    { name: '15. 循环引用检测', fn: test15 },
    { name: '16. 数组响应式', fn: test16 },
    { name: '17. 深层响应式', fn: test17 },
    { name: '18. effect 清理依赖', fn: test18 },
  ]

  for (const test of tests) {
    console.log(`\n${test.name}`)
    try {
      await test.fn()
      console.log(`  ✓ ${test.name} 完成`)
    } catch (e) {
      console.error(`  ✗ ${test.name} 失败:`, e.message)
      throw e
    }
  }

  console.log('\n=== 所有测试通过! ===\n')
}

function test1() {
  const state = reactive({ count: 0, name: 'test' })
  assert(isReactive(state), 'reactive 返回的对象应该是响应式的')
  assert(state.count === 0, '初始值应该正确')

  let dummy
  effect(() => {
    dummy = state.count
  })
  assert(dummy === 0, 'effect 应该立即执行')

  state.count++
  assert(dummy === 1, '数据变化后 effect 应该重新运行')
}

function test2() {
  const count = ref(0)
  assert(isRef(count), 'ref 返回的对象应该是 Ref 类型')
  assert(count.value === 0, '初始值应该正确')

  let dummy
  effect(() => {
    dummy = count.value
  })
  assert(dummy === 0, 'effect 应该立即执行')

  count.value++
  assert(dummy === 1, '数据变化后 effect 应该重新运行')
}

function test3() {
  const count = ref(1)
  const doubled = computed(() => count.value * 2)
  assert(isComputed(doubled), 'computed 返回的应该是计算属性')
  assert(doubled.value === 2, '计算属性初始值应该正确')

  let dummy
  effect(() => {
    dummy = doubled.value
  })
  assert(dummy === 2, 'effect 应该能读取计算属性')

  count.value = 2
  assert(doubled.value === 4, '依赖变化后计算属性应该重新计算')
  assert(dummy === 4, 'effect 应该响应计算属性变化')
}

function test4() {
  let computeCount = 0
  const count = ref(1)
  const doubled = computed(() => {
    computeCount++
    return count.value * 2
  })

  doubled.value
  doubled.value
  assert(computeCount === 1, '多次读取应该只计算一次')

  count.value = 2
  doubled.value
  doubled.value
  assert(computeCount === 2, '依赖变化后才重新计算')
}

function test5() {
  const count = ref(0)
  let dummy
  const runner = effect(() => {
    dummy = count.value
  })

  count.value = 1
  assert(dummy === 1, '停止前应该响应')

  stop(runner)
  count.value = 2
  assert(dummy === 1, '停止后不应该响应')
}

function test6() {
  const count = ref(0)
  const name = ref('test')
  let runCount = 0

  effect(() => {
    runCount++
    count.value + name.value
  })

  assert(runCount === 1, '初始运行一次')

  batch(() => {
    count.value++
    count.value++
    name.value = 'updated'
  })

  assert(runCount === 2, '批量更新后只运行一次')
}

function test7() {
  const count = ref(0)
  let runCount = 0

  effect(() => {
    runCount++
    count.value
  })

  assert(runCount === 1, '初始运行一次')

  runInAction(() => {
    count.value = 1
    count.value = 2
    count.value = 3
  })

  assert(runCount === 2, 'runInAction 应该批量更新')
}

function test8() {
  const count = ref(0)
  let dummy
  let runCount = 0

  effect(() => {
    runCount++
    dummy = untracked(() => count.value)
  })

  assert(runCount === 1, '初始运行一次')
  assert(dummy === 0, '应该能读取值')

  count.value++
  assert(runCount === 1, 'untracked 内部的依赖不应该被追踪')
}

function test9() {
  const count = ref(0)
  let oldVal, newVal

  watch(count, (nv, ov) => {
    newVal = nv
    oldVal = ov
  }, { flush: 'sync' })

  count.value = 1
  assert(newVal === 1 && oldVal === 0, 'watch 应该能获取新旧值')
}

function test10() {
  const count = ref(0)
  let called = false

  watch(count, () => {
    called = true
  }, { immediate: true, flush: 'sync' })

  assert(called === true, 'immediate 选项应该立即执行回调')
}

function test11() {
  const original = { count: 0 }
  const observed = reactive(original)
  assert(toRaw(observed) === original, 'toRaw 应该返回原始对象')
  assert(toRaw(original) === original, 'toRaw 对非响应式对象应该返回自身')
}

function test12() {
  const obj = markRaw({ foo: 1 })
  const observed = reactive(obj)
  assert(observed === obj, 'markRaw 的对象不应该被代理')
}

function test13() {
  const store = observable({
    count: 0,
    get doubled() {
      return this.count * 2
    },
    increment() {
      this.count++
    }
  })

  let dummy
  effect(() => {
    dummy = store.doubled
  })

  assert(dummy === 0, '初始计算属性正确')
  store.increment()
  assert(dummy === 2, '方法调用后响应式更新')
}

function test14() {
  const count = ref(1)
  const doubled = computed({
    get: () => count.value * 2,
    set: (val) => { count.value = val / 2 }
  })

  assert(doubled.value === 2, 'getter 正常工作')
  doubled.value = 10
  assert(count.value === 5, 'setter 正常工作')
}

function test15() {
  const a = reactive({ value: 1 })
  const b = reactive({ value: 2 })

  let runCount = 0
  effect(() => {
    runCount++
    a.value + b.value
  })

  assert(runCount === 1, '初始运行一次')

  batch(() => {
    a.value = 10
    b.value = 20
  })

  assert(runCount === 2, '批量更新避免多次运行')
}

function test16() {
  const arr = reactive([1, 2, 3])
  let sum

  effect(() => {
    sum = arr.reduce((a, b) => a + b, 0)
  })

  assert(sum === 6, '数组初始求和正确')

  arr.push(4)
  assert(sum === 10, 'push 后响应式更新')

  arr[0] = 10
  assert(sum === 19, '索引赋值后响应式更新')
}

function test17() {
  const state = reactive({
    nested: {
      count: 0
    }
  })

  let dummy
  effect(() => {
    dummy = state.nested.count
  })

  state.nested.count++
  assert(dummy === 1, '深层属性应该响应式')
}

function test18() {
  const show = ref(true)
  const count = ref(0)
  let runCount = 0

  effect(() => {
    runCount++
    if (show.value) {
      count.value
    }
  })

  assert(runCount === 1, '初始运行一次')

  show.value = false
  assert(runCount === 2, '切换 show 触发更新')

  count.value++
  assert(runCount === 2, 'count 不再是依赖，不应该触发')
}

runTests().catch(e => {
  console.error('测试失败:', e)
  process.exit(1)
})
