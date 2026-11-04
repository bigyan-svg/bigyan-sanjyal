export interface LazyClient<T extends object> {
  client: T;
  getClient(): T;
  peekClient(): T | undefined;
}

export function createLazyClient<T extends object>(
  createClient: () => T,
  getExistingClient?: () => T | undefined,
  cacheClient?: (client: T) => void,
): LazyClient<T> {
  let client: T | undefined;

  const getClient = (): T => {
    const existingClient = client ?? getExistingClient?.();
    if (existingClient) {
      client = existingClient;
      return existingClient;
    }

    const createdClient = createClient();
    client = createdClient;
    cacheClient?.(createdClient);
    return createdClient;
  };

  const peekClient = (): T | undefined => client ?? getExistingClient?.();

  const lazyClient = new Proxy(Object.create(null) as T, {
    get(_target, property) {
      const activeClient = getClient();
      const value = Reflect.get(activeClient, property, activeClient) as unknown;
      return typeof value === "function" ? value.bind(activeClient) : value;
    },
  });

  return { client: lazyClient, getClient, peekClient };
}
