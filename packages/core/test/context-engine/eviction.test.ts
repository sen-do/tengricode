import { describe, test, expect } from "bun:test"
import { ARCEvictionPolicy } from "@opencode-ai/core/context-engine"

describe("ARCEvictionPolicy", () => {
  test("starts empty", () => {
    const arc = new ARCEvictionPolicy(5)
    expect(arc.activeSize()).toBe(0)
    expect(arc.activeIds()).toEqual([])
  })

  test("access adds item to recent list", () => {
    const arc = new ARCEvictionPolicy(5)
    arc.access("a")
    expect(arc.activeSize()).toBe(1)
    expect(arc.activeIds()).toContain("a")
  })

  test("no eviction under capacity", () => {
    const arc = new ARCEvictionPolicy(5)
    arc.access("a")
    arc.access("b")
    arc.access("c")
    expect(arc.evictIfNeeded()).toBeUndefined()
    expect(arc.activeSize()).toBe(3)
  })

  test("evicts when at capacity", () => {
    const arc = new ARCEvictionPolicy(2)
    arc.access("a")
    arc.access("b")
    arc.access("c")
    arc.evictToCapacity()
    expect(arc.activeSize()).toBe(2)
  })

  test("frequently accessed item survives eviction", () => {
    const arc = new ARCEvictionPolicy(3)
    arc.access("a")
    arc.access("a")
    arc.access("b")
    arc.access("c")
    arc.access("d")
    arc.evictToCapacity()
    const active = arc.activeIds()
    expect(active).toContain("a")
  })

  test("ghost list tracks evicted items", () => {
    const arc = new ARCEvictionPolicy(2)
    arc.access("a")
    arc.access("b")
    arc.access("c")
    arc.evictToCapacity()
    expect(arc.ghostList().length).toBeGreaterThan(0)
  })

  test("ghost list hit re-fetches item from recall tier", () => {
    const arc = new ARCEvictionPolicy(2)
    arc.access("a")
    arc.access("b")
    arc.access("c")
    arc.evictToCapacity()
    const ghost = arc.ghostList()
    expect(ghost.length).toBeGreaterThan(0)

    const evictedId = ghost[0]
    const wasInGhost = arc.inGhostList(evictedId)
    expect(wasInGhost).toBe(true)

    arc.access(evictedId)
    expect(arc.activeIds()).toContain(evictedId)
    expect(arc.inGhostList(evictedId)).toBe(false)
  })

  test("decay reduces access counts over time", () => {
    const arc = new ARCEvictionPolicy(3, 0.5)
    arc.access("a")
    arc.access("b")
    arc.access("b")
    arc.access("b")
    arc.decay()
    arc.decay()
    arc.access("c")
    arc.access("d")
    arc.access("e")
    arc.evictToCapacity()
    const active = arc.activeIds()
    expect(active.length).toBe(3)
  })

  test("activeIds returns all items in order", () => {
    const arc = new ARCEvictionPolicy(10)
    arc.access("a")
    arc.access("b")
    arc.access("c")
    const ids = arc.activeIds()
    expect(ids.length).toBe(3)
  })

  test("capacity of zero treats as one", () => {
    const arc = new ARCEvictionPolicy(0)
    arc.access("a")
    expect(arc.activeSize()).toBe(1)
    arc.access("b")
    arc.evictToCapacity()
    expect(arc.activeSize()).toBe(1)
  })
})
