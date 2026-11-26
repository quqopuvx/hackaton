<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { domain } from "../config/domain";
import type { Account } from "../lib/accounts";
import App from "./App.vue";
import { getSession, logIn, logOut, sessionExpiredEvent } from "./session-api";

const user = ref<Account>();
const username = ref("");
const password = ref("");
const checking = ref(true);
const signingIn = ref(false);
const signingOut = ref(false);
const error = ref("");
const logoutError = ref("");

function sessionExpired(): void {
  if (!user.value) return;
  username.value = user.value.username;
  user.value = undefined;
  error.value = "Сессия завершилась. Войдите снова.";
}

async function checkSession(): Promise<void> {
  try {
    user.value = (await getSession()).user;
  } catch {
    error.value = "Не удалось проверить сессию. Попробуйте войти.";
  } finally {
    checking.value = false;
  }
}

async function signIn(): Promise<void> {
  if (signingIn.value) return;
  signingIn.value = true;
  error.value = "";
  try {
    user.value = await logIn(username.value.trim(), password.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось войти в аккаунт.";
  } finally {
    password.value = "";
    signingIn.value = false;
  }
}

async function signOut(): Promise<void> {
  if (signingOut.value) return;
  signingOut.value = true;
  logoutError.value = "";
  try {
    await logOut();
    window.history.replaceState(null, "", "/");
    user.value = undefined;
    username.value = "";
    error.value = "";
  } catch (cause) {
    logoutError.value = cause instanceof Error ? cause.message : "Не удалось выйти. Попробуйте ещё раз.";
  } finally {
    signingOut.value = false;
  }
}

onMounted(() => {
  window.addEventListener(sessionExpiredEvent, sessionExpired);
  void checkSession();
});
onUnmounted(() => window.removeEventListener(sessionExpiredEvent, sessionExpired));
</script>

<template>
  <App v-if="user" :key="user.username" :user="user" :signing-out="signingOut" :logout-error="logoutError" @logout="signOut" />
  <main v-else class="grid min-h-svh place-items-center bg-canvas p-4">
    <section class="w-full max-w-md rounded-3xl border border-line bg-surface p-6 sm:p-8" aria-labelledby="login-title">
      <p class="brand mb-5 text-accent"><span class="brand-mark" aria-hidden="true"></span>{{ domain.caseTitle }}</p>
      <h1 id="login-title" class="text-2xl font-bold">Вход в аккаунт</h1>
      <p v-if="checking" class="mt-4 text-sm text-secondary" role="status">Проверяю сессию…</p>
      <form v-else class="mt-4 grid gap-4" @submit.prevent="signIn">
        <label class="grid gap-1 text-sm font-semibold">
          Логин
          <input v-model="username" type="text" autocomplete="username" autocapitalize="none" maxlength="48" required
            class="min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent" />
        </label>
        <label class="grid gap-1 text-sm font-semibold">
          Пароль
          <input v-model="password" type="password" autocomplete="current-password" maxlength="256" required
            class="min-h-11 rounded-xl border border-line bg-canvas px-3 focus-visible:outline-accent" />
        </label>
        <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
        <button type="submit" :disabled="signingIn" class="min-h-11 rounded-ui bg-accent px-5 text-sm font-bold text-white disabled:opacity-50">
          {{ signingIn ? "Вхожу…" : "Войти" }}
        </button>
      </form>
    </section>
  </main>
</template>
