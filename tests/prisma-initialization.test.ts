import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type {
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlResultSet,
  Transaction,
} from "@prisma/driver-adapter-utils";
import { PrismaClient } from "../src/generated/prisma/client";
import { createLazyClient } from "../src/lib/lazy-client";

interface AdapterStats {
  connections: number;
  queries: number;
  transactions: number;
  commits: number;
  rollbacks: number;
}

function createInMemoryAdapterFactory(stats: AdapterStats): SqlDriverAdapterFactory {
  const queryRaw = async (): Promise<SqlResultSet> => {
    stats.queries += 1;
    return { columnNames: [], columnTypes: [], rows: [] };
  };
  const executeRaw = async (): Promise<number> => {
    stats.queries += 1;
    return 1;
  };
  const transaction: Transaction = {
    provider: "postgres",
    adapterName: "@prisma/adapter-mock",
    options: { usePhantomQuery: false },
    queryRaw,
    executeRaw,
    commit: async () => {
      stats.commits += 1;
    },
    rollback: async () => {
      stats.rollbacks += 1;
    },
  };
  const adapter: SqlDriverAdapter = {
    provider: "postgres",
    adapterName: "@prisma/adapter-mock",
    queryRaw,
    executeRaw,
    executeScript: async () => {},
    startTransaction: async () => {
      stats.transactions += 1;
      return transaction;
    },
    dispose: async () => {},
  };

  return {
    provider: "postgres",
    adapterName: "@prisma/adapter-mock",
    connect: async () => {
      stats.connections += 1;
      return adapter;
    },
  };
}

test("Prisma module import stays lazy without DATABASE_URL", async () => {
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const { getPrismaDatabaseIdentity, prisma } = await import("../src/lib/prisma");

    assert.deepEqual(getPrismaDatabaseIdentity(), {
      target: null,
      source: "uninitialized",
    });
    assert.throws(
      () => prisma.siteProfile.findMany({}),
      /The DATABASE_URL environment variable is not set\./u,
    );
    assert.deepEqual(getPrismaDatabaseIdentity(), {
      target: null,
      source: "uninitialized",
    });
  } finally {
    if (configuredDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = configuredDatabaseUrl;
    }
  }
});

test("diagnostic identity reflects a pre-existing generated client without connecting", () => {
  const script = `
    import assert from "node:assert/strict";
    for (const name of Object.keys(process.env)) {
      if (/DATABASE|POSTGRES|DB_URL|DIRECT_URL|SHADOW/iu.test(name)) delete process.env[name];
    }
    const { PrismaClient } = await import("./src/generated/prisma/client.ts");
    const { mockAdapterFactory } = await import("@prisma/driver-adapter-utils");
    globalThis.prisma = new PrismaClient({ adapter: mockAdapterFactory("postgres") });
    const { getPrismaDatabaseIdentity } = await import("./src/lib/prisma.ts");
    assert.deepEqual(getPrismaDatabaseIdentity(), {
      target: null,
      source: "existing-client-env-fallback",
    });
  `;
  const environment = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/DATABASE|POSTGRES|DB_URL|DIRECT_URL|SHADOW/iu.test(name),
      ),
    ),
    NODE_ENV: "development" as const,
  };
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import=tsx", "--input-type=module", "-e", script],
    { cwd: process.cwd(), env: environment, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});

test("lazy client initializes once and preserves delegate and transaction behavior", async () => {
  let constructions = 0;
  let operations = 0;
  const transactionClient = {
    model: {
      read: () => "transaction-result",
    },
  };
  const configuredClient = {
    model: {
      read: () => {
        operations += 1;
        return "client-result";
      },
    },
    $transaction(
      this: { transactionCount: number },
      callback: (transaction: typeof transactionClient) => string,
    ) {
      this.transactionCount += 1;
      return callback(transactionClient);
    },
    transactionCount: 0,
  };
  const lazyClient = createLazyClient(() => {
    constructions += 1;
    return configuredClient;
  });

  assert.equal(lazyClient.peekClient(), undefined);
  assert.equal(constructions, 0);

  await Promise.all(
    Array.from({ length: 8 }, () =>
      Promise.resolve().then(() => lazyClient.client.model.read()),
    ),
  ).then((results) => {
    assert.deepEqual(results, Array.from({ length: 8 }, () => "client-result"));
  });
  assert.equal(constructions, 1);
  assert.equal(operations, 8);

  assert.equal(
    lazyClient.client.$transaction((transaction) => transaction.model.read()),
    "transaction-result",
  );
  assert.equal(configuredClient.transactionCount, 1);
  assert.equal(lazyClient.getClient(), configuredClient);
  assert.equal(constructions, 1);
});

test("generated Prisma Client delegates and both transaction forms work through the lazy proxy", async () => {
  const stats: AdapterStats = {
    connections: 0,
    queries: 0,
    transactions: 0,
    commits: 0,
    rollbacks: 0,
  };
  const generatedClient = new PrismaClient({
    adapter: createInMemoryAdapterFactory(stats),
  });
  let constructions = 0;
  const lazyClient = createLazyClient(() => {
    constructions += 1;
    return generatedClient;
  });

  try {
    assert.equal(constructions, 0);
    const inspectedDelegate = lazyClient.client.siteProfile;
    assert.ok(inspectedDelegate);
    assert.equal(constructions, 1);
    assert.equal(stats.connections, 0);

    await lazyClient.client.$connect();
    assert.equal(stats.connections, 1);

    const firstQuery = inspectedDelegate.findMany();
    assert.equal(typeof firstQuery.then, "function");
    assert.deepEqual(await firstQuery, []);
    assert.equal(stats.connections, 1);
    assert.equal(stats.queries, 1);

    const interactiveResult = await lazyClient.client.$transaction(async (transaction) => {
      assert.equal(typeof transaction.siteProfile.findMany, "function");
      return transaction.siteProfile.findMany();
    });
    assert.deepEqual(interactiveResult, []);
    assert.equal(stats.transactions, 1);
    assert.equal(stats.commits, 1);

    const firstArrayQuery = lazyClient.client.siteProfile.findMany();
    const secondArrayQuery = lazyClient.client.skill.findMany();
    const arrayTransaction = lazyClient.client.$transaction([
      firstArrayQuery,
      secondArrayQuery,
    ]);
    assert.equal(typeof arrayTransaction.then, "function");
    assert.deepEqual(await arrayTransaction, [[], []]);
    assert.equal(constructions, 1);
    assert.equal(stats.connections, 1);
    assert.equal(stats.transactions, 2);
    assert.equal(stats.commits, 2);
    assert.equal(stats.rollbacks, 0);
  } finally {
    await lazyClient.client.$disconnect();
  }
});

test("failed initialization propagates and can be retried without caching a bad client", () => {
  const expectedError = new Error("controlled initialization failure");
  let attempts = 0;
  let cachedClient: { ready: true } | undefined;
  const lazyClient = createLazyClient(
    () => {
      attempts += 1;
      if (attempts === 1) throw expectedError;
      return { ready: true as const };
    },
    () => cachedClient,
    (client) => {
      cachedClient = client;
    },
  );

  assert.throws(() => lazyClient.client.ready, expectedError);
  assert.equal(lazyClient.peekClient(), undefined);
  assert.equal(cachedClient, undefined);
  assert.equal(lazyClient.client.ready, true);
  assert.equal(lazyClient.getClient(), cachedClient);
  assert.equal(attempts, 2);
});

test("lazy client reuses an existing global singleton", () => {
  let constructions = 0;
  const existingClient = { value: "existing" };
  let cachedClient: typeof existingClient | undefined = existingClient;
  const lazyClient = createLazyClient(
    () => {
      constructions += 1;
      return { value: "new" };
    },
    () => cachedClient,
    (client) => {
      cachedClient = client;
    },
  );

  assert.equal(lazyClient.client.value, "existing");
  assert.equal(lazyClient.getClient(), existingClient);
  assert.equal(constructions, 0);
  assert.equal(cachedClient, existingClient);
});

test("lazy client caches a newly initialized client for subsequent accesses", () => {
  let constructions = 0;
  let cachedClient: { value: string } | undefined;
  const lazyClient = createLazyClient(
    () => {
      constructions += 1;
      return { value: "created" };
    },
    () => cachedClient,
    (client) => {
      cachedClient = client;
    },
  );

  assert.equal(lazyClient.client.value, "created");
  assert.equal(lazyClient.peekClient(), cachedClient);
  assert.equal(lazyClient.client.value, "created");
  assert.equal(constructions, 1);
});
