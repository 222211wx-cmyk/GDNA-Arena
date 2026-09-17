import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_UNAVAILABLE_MESSAGE,
  createOptionalOpenAI,
  isOpenAIAvailable,
  resetOpenAICircuitForTests,
  type OpenAIClientFactory,
} from "./openai-client";

const originalKey = process.env.OPENAI_API_KEY;

test.afterEach(() => {
  resetOpenAICircuitForTests();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

test("missing configuration is safe at import and initialization", async () => {
  delete process.env.OPENAI_API_KEY;
  let constructed = false;
  const client = createOptionalOpenAI({
    clientFactory: (() => {
      constructed = true;
      throw new Error("must not construct");
    }) as OpenAIClientFactory,
  });

  assert.equal(isOpenAIAvailable(), false);
  await assert.rejects(
    client.embeddings.create({ model: "text-embedding-3-small", input: "hello" }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "AI_UNAVAILABLE" &&
      error.message === AI_UNAVAILABLE_MESSAGE,
  );
  assert.equal(constructed, false);
});

test("chat and embeddings calls use an injected client, including streams", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  let calls = 0;
  async function* stream() {
    yield { choices: [{ delta: { content: "hello" } }] };
  }
  const injected = {
    chat: {
      completions: {
        create: async (parameters: { stream?: boolean }) => {
          calls += 1;
          return parameters.stream ? stream() : { choices: [{ message: { content: "ok" } }] };
        },
      },
    },
    embeddings: {
      create: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    },
    moderations: { create: async () => ({ results: [] }) },
  };

  const client = createOptionalOpenAI({
    apiKey: "test-key",
    clientFactory: (() => injected) as unknown as OpenAIClientFactory,
  });
  const completion = await client.chat.completions.create({
    model: "test",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.deepEqual(completion.choices[0].message.content, "ok");
  const embedding = await client.embeddings.create({
    model: "test",
    input: "hello",
  });
  assert.deepEqual(embedding.data[0].embedding, [0.1, 0.2]);
  const result = await client.chat.completions.create({
    model: "test",
    messages: [{ role: "user", content: "hello" }],
    stream: true,
  });
  const chunks = [];
  for await (const chunk of result) chunks.push(chunk);
  assert.equal(chunks.length, 1);
  assert.equal(calls, 2);
});

test("quota failures open a shared finite circuit and recover", async () => {
  let now = 1_000;
  let calls = 0;
  const quotaClient = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          throw {
            status: 429,
            error: { code: "insufficient_quota", message: "secret provider details" },
          };
        },
      },
    },
    embeddings: { create: async () => ({ data: [] }) },
    moderations: { create: async () => ({ results: [] }) },
  };
  const first = createOptionalOpenAI({
    apiKey: "same-key",
    now: () => now,
    cooldownMs: 100,
    clientFactory: (() => quotaClient) as unknown as OpenAIClientFactory,
  });
  await assert.rejects(
    first.chat.completions.create({ model: "test", messages: [] }),
    (error: any) => {
    assert.equal(error.code, "AI_QUOTA_EXHAUSTED");
    assert.equal(error.status, 429);
    assert.equal(error.message.includes("secret"), false);
    return true;
    },
  );

  const second = createOptionalOpenAI({
    apiKey: "same-key",
    now: () => now,
    clientFactory: (() => {
      throw new Error("circuit should suppress this network call");
    }) as OpenAIClientFactory,
  });
  await assert.rejects(
    second.embeddings.create({ model: "test", input: "hello" }),
    (error: any) => {
    assert.equal(error.code, "AI_QUOTA_EXHAUSTED");
    assert.equal(error.status, 503);
    return true;
    },
  );
  assert.equal(calls, 1);

  now += 101;
  const recovered = createOptionalOpenAI({
    apiKey: "same-key",
    now: () => now,
    clientFactory: (() => ({
      chat: { completions: { create: async () => ({ choices: [] }) } },
      embeddings: { create: async () => ({ data: [] }) },
      moderations: { create: async () => ({ results: [] }) },
    })) as unknown as OpenAIClientFactory,
  });
  await recovered.chat.completions.create({ model: "test", messages: [] });
});

test("provider errors are sanitized and stream errors are sanitized", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  async function* failingStream() {
    yield { choices: [] };
    throw {
      status: 500,
      headers: { authorization: "Bearer super-secret" },
      message: "raw internal details super-secret",
    };
  }
  const client = createOptionalOpenAI({
    apiKey: "test-key",
    clientFactory: (() => ({
      chat: { completions: { create: async () => failingStream() } },
      embeddings: {
        create: async () => {
          throw { status: 401, headers: { authorization: "Bearer super-secret" } };
        },
      },
      moderations: { create: async () => ({ results: [] }) },
    })) as unknown as OpenAIClientFactory,
  });

  await assert.rejects(
    client.embeddings.create({ model: "test", input: "hello" }),
    (error: any) => {
    assert.equal(error.code, "AI_UNAUTHORIZED");
    assert.equal(error.status, 401);
    assert.equal(error.message.includes("super-secret"), false);
    assert.equal("headers" in error, false);
    return true;
    },
  );

  resetOpenAICircuitForTests();
  const stream = await client.chat.completions.create({
    model: "test",
    messages: [],
    stream: true,
  });
  await assert.rejects(
    (async () => {
      for await (const _chunk of stream) {
        // consume until the provider error
      }
    })(),
    (error: any) => {
      assert.equal(error.code, "AI_PROVIDER_ERROR");
      assert.equal(error.status, 500);
      assert.equal(error.message.includes("super-secret"), false);
      return true;
    },
  );
});