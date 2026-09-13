import Store from 'electron-store'

export interface Persistence<T> {
  read: () => T
  write: (next: T) => void
}

// 约束与 electron-store 自身一致(`Record<string, any>` 允许 interface 类型;`unknown` 不允许)
export function createElectronStore<T extends Record<string, any>>(
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
