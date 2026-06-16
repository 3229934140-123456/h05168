// @ts-nocheck
globalThis.__DEV__ = false

import {
  reactive,
  ref,
  computed,
  effect,
  toRaw
} from '../dist/index.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`✓ ${message}`)
  } else {
    failed++
    console.error(`✗ ${message}`)
  }
}

console.log('\n=== Map/Set 响应式测试 ===\n')

console.log('1. Map 基本功能')
{
  const map = reactive(new Map())
  let size
  let runCount = 0

  effect(() => {
    runCount++
    size = map.size
    console.log('  effect ran, size =', size)
  })

  assert(size === 0, '初始 size 为 0')
  
  map.set('a', 1)
  assert(size === 1, 'set 后 size 变为 1')
  
  map.set('b', 2)
  assert(size === 2, '再 set 后 size 变为 2')
  
  map.set('a', 10)
  assert(size === 2, '更新已有 key 后 size 不变')
  
  assert(map.get('a') === 10, 'get 能获取正确的值')
  
  map.delete('a')
  assert(size === 1, 'delete 后 size 变为 1')
  
  assert(map.has('a') === false, 'has 正确判断不存在')
  assert(map.has('b') === true, 'has 正确判断存在')
  
  map.clear()
  assert(size === 0, 'clear 后 size 变为 0')
}

console.log('\n2. Map 遍历响应式')
{
  const map = reactive(new Map([['a', 1], ['b', 2]]))
  let entries = []
  
  effect(() => {
    entries = []
    for (const [k, v] of map) {
      entries.push([k, v])
    }
    console.log('  entries:', entries)
  })
  
  assert(entries.length === 2, '初始有 2 个条目')
  
  map.set('c', 3)
  assert(entries.length === 3, '新增后有 3 个条目')
}

console.log('\n3. Set 基本功能')
{
  const set = reactive(new Set())
  let size
  let runCount = 0

  effect(() => {
    runCount++
    size = set.size
    console.log('  effect ran, size =', size)
  })

  assert(size === 0, '初始 size 为 0')
  
  set.add(1)
  assert(size === 1, 'add 后 size 变为 1')
  
  set.add(2)
  assert(size === 2, '再 add 后 size 变为 2')
  
  set.add(1)
  assert(size === 2, '重复 add 不改变 size')
  
  assert(set.has(1) === true, 'has 正确判断存在')
  
  set.delete(1)
  assert(size === 1, 'delete 后 size 变为 1')
  
  set.clear()
  assert(size === 0, 'clear 后 size 变为 0')
}

console.log('\n4. Set 遍历响应式')
{
  const set = reactive(new Set([1, 2, 3]))
  let values = []
  
  effect(() => {
    values = []
    for (const v of set) {
      values.push(v)
    }
    console.log('  values:', values)
  })
  
  assert(values.length === 3, '初始有 3 个值')
  
  set.add(4)
  assert(values.length === 4, '新增后有 4 个值')
}

console.log('\n5. Map 派生计算属性')
{
  const map = reactive(new Map())
  
  const total = computed(() => {
    let sum = 0
    map.forEach(v => { sum += v })
    return sum
  })
  
  map.set('a', 10)
  map.set('b', 20)
  
  assert(total.value === 30, '计算属性 sum 正确')
  
  map.set('a', 100)
  assert(total.value === 120, '更新后计算属性重新计算')
}

console.log('\n6. 深层响应式 - Map 中的对象值')
{
  const map = reactive(new Map())
  const obj = { count: 0 }
  map.set('obj', obj)
  
  let count
  
  effect(() => {
    const item = map.get('obj')
    count = item ? item.count : 0
  })
  
  assert(count === 0, '初始 count 为 0')
  
  map.get('obj').count = 10
  assert(count === 10, '深层修改能触发响应式')
}

console.log(`\n=== 测试完成: ${passed} 通过, ${failed} 失败 ===\n`)

if (failed > 0) {
  process.exit(1)
}
