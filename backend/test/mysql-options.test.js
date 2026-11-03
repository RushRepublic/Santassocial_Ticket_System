import { test } from "node:test";
import assert from "node:assert/strict";
import { mysqlOptions } from "../src/mysql-options.js";

test("individual MySQL credentials preserve literal password characters and override a stale URL", () => {
  const password = 'synthetic@#%:/?+"\\ password';
  const result = mysqlOptions({
    DB_USER: "santauser",
    DB_PASSWORD: password,
    DB_NAME: "santaticket_db",
    DATABASE_URL: "invalid-old-value",
  });
  assert.deepEqual(result, {
    host: "127.0.0.1",
    port: 3306,
    user: "santauser",
    password,
    database: "santaticket_db",
  });
  assert.equal(
    mysqlOptions({
      DB_HOST: "mysql.internal",
      DB_PORT: "3307",
      DB_USER: "u",
      DB_PASSWORD: "p",
      DB_NAME: "d",
    }).port,
    3307,
  );
});

test("MySQL URL compatibility remains and incomplete raw fields fail without disclosing credentials", () => {
  const uri = "mysql://u:encoded%40password@127.0.0.1:3306/santa";
  assert.deepEqual(mysqlOptions({ DATABASE_URL: uri }), { uri });
  for (const env of [
    {},
    { DATABASE_URL: "postgres://u:p@host/db" },
    { DB_USER: "u", DB_PASSWORD: "private-test-value", DATABASE_URL: uri },
    {
      DB_USER: "u",
      DB_PASSWORD: "private-test-value",
      DB_NAME: "d",
      DB_PORT: "bad",
    },
  ]) {
    assert.throws(
      () => mysqlOptions(env),
      (error) => {
        assert.ok(!error.message.includes("private-test-value"));
        assert.ok(!error.message.includes(uri));
        return true;
      },
    );
  }
});
