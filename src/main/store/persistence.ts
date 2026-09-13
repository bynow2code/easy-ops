import Store from 'electron-store'

export interface Persistence<T> {
  read: () => T
  write: (next: T) => void
}

export function createElectronStore<T extends Record<string, unknown>>(
  name: string,
  defaults: T,
  key: string
): Persistence<T> {
  const store = new Store<T>({ name, defaults })
  return {
    read: () => (store.get(key) as T) ?? defaults,
    write: (next) => {
      store.set(key, next)
    }
  }
}

export function createMemoryPersistence<T>(initial: T): Persistence<T> {
  let data = initial
  return {
    read: () => data,
    write: (next) => {
      data = next
    }
  }
}
