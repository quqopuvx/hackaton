import { randomBytes } from "node:crypto";
import { hashPassword } from "./accounts.ts";
import { loadLocalEnv } from "./env.ts";
import { database } from "../lib/store.ts";
import type { Account } from "../lib/accounts.ts";

const accounts: Account[] = [
  { username: "admin", name: "Администратор", role: "admin" },
  { username: "employee", name: "Сотрудник учебного отдела", role: "employee" },
];

async function setup(): Promise<void> {
  loadLocalEnv();
  const pool = await database();
  try {
    const prepared = await Promise.all(accounts.map(async (account) => {
      const password = randomBytes(24).toString("base64url");
      return { ...account, password, hash: await hashPassword(password) };
    }));
    const { rows } = await pool.query<{ username: string }>(
      `INSERT INTO app_users (username, display_name, role, password_hash)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
       ON CONFLICT (username) DO NOTHING RETURNING username`,
      prepared.flatMap(({ username, name, role, hash }) => [username, name, role, hash]),
    );
    if (!rows.length) console.log("Оба аккаунта уже существуют.");
    for (const { username } of rows) {
      const account = prepared.find((item) => item.username === username);
      if (account) console.log(`${account.name} (${username})\nПароль: ${account.password}`);
    }
    if (rows.length) console.log("Сохраните пароли. Команда показывает их только при создании аккаунтов.");
  } finally {
    await pool.end();
  }
}

await setup().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Не удалось создать аккаунты.");
  process.exitCode = 1;
});
