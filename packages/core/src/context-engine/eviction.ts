export class ARCEvictionPolicy {
  private t1 = new Map<string, AccessInfo>()
  private t2 = new Map<string, AccessInfo>()
  private b1 = new Map<string, AccessInfo>()
  private b2 = new Map<string, AccessInfo>()
  private p = 0
  private capacity: number
  private decayRate: number

  constructor(capacity: number, decayRate = 0.1) {
    this.capacity = Math.max(1, capacity)
    this.decayRate = decayRate
  }

  access(id: string): void {
    if (this.t1.has(id)) {
      this.t2.set(id, this.promote(this.t1.get(id)!))
      this.t1.delete(id)
      return
    }
    if (this.t2.has(id)) {
      this.t2.set(id, this.promote(this.t2.get(id)!))
      return
    }
    if (this.b1.has(id)) {
      this.p = Math.min(this.capacity, this.p + Math.max(1, this.b2.size / Math.max(1, this.b1.size)))
      this.t2.set(id, this.promote(this.b1.get(id)!))
      this.b1.delete(id)
      return
    }
    if (this.b2.has(id)) {
      this.p = Math.max(0, this.p - Math.max(1, this.b1.size / Math.max(1, this.b2.size)))
      this.t2.set(id, this.promote(this.b2.get(id)!))
      this.b2.delete(id)
      return
    }
    this.t1.set(id, AccessInfo.fresh())
  }

  evictIfNeeded(): string | undefined {
    if (this.t1.size + this.t2.size <= this.capacity) return undefined
    const t1Size = this.t1.size
    if (t1Size >= Math.max(1, this.p)) return this.evictOne(this.t1, this.b1)
    return this.evictOne(this.t2, this.b2)
  }

  evictToCapacity(): string[] {
    const evicted: string[] = []
    while (this.t1.size + this.t2.size > this.capacity) {
      const id = this.evictIfNeeded()
      if (id) evicted.push(id)
      if (!id) break
    }
    return evicted
  }

  decay(): void {
    for (const info of this.t1.values()) info.decay(this.decayRate)
    for (const info of this.t2.values()) info.decay(this.decayRate)
  }

  inGhostList(id: string): boolean {
    return this.b1.has(id) || this.b2.has(id)
  }

  ghostList(): string[] {
    return [...this.b1.keys(), ...this.b2.keys()]
  }

  activeSize(): number {
    return this.t1.size + this.t2.size
  }

  activeIds(): string[] {
    return [...this.t1.keys(), ...this.t2.keys()]
  }

  private promote(info: AccessInfo): AccessInfo {
    return new AccessInfo(info.accessCount + 1, Date.now())
  }

  private evictOne(source: Map<string, AccessInfo>, ghost: Map<string, AccessInfo>): string | undefined {
    let oldest: string | undefined
    let oldestTime = Infinity
    for (const [id, info] of source) {
      if (info.lastAccess < oldestTime) {
        oldestTime = info.lastAccess
        oldest = id
      }
    }
    if (oldest !== undefined) {
      ghost.set(oldest, source.get(oldest)!)
      source.delete(oldest)
    }
    return oldest
  }
}

class AccessInfo {
  accessCount: number
  lastAccess: number

  constructor(accessCount: number, lastAccess: number) {
    this.accessCount = accessCount
    this.lastAccess = lastAccess
  }

  static fresh(): AccessInfo {
    return new AccessInfo(1, Date.now())
  }

  decay(rate: number): void {
    this.accessCount = Math.max(0, this.accessCount * (1 - rate))
  }
}
