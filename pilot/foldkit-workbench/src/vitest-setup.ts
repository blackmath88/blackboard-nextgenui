/**
 * Test environment set-up.
 *
 * The workbench talks to `globalThis.localStorage` only through Commands and the
 * persistence module, so the only thing the suite needs is that key.
 */

const memory = new Map<string, string>()

const shim: Storage = {
  get length() {
    return memory.size
  },
  key: (index: number) => [...memory.keys()][index] ?? null,
  getItem: (key: string) => (memory.has(key) ? (memory.get(key) as string) : null),
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => {
    memory.clear()
  },
}

if (globalThis.localStorage === undefined || globalThis.localStorage === null) {
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true })
}
