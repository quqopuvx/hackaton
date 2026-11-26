<script setup lang="ts">
import { mailTextSizes, type MailTextStyle } from "../../lib/school-mail-design";

const style = defineModel<MailTextStyle>("style", { required: true });
const inputClass = "min-h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm";
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
    <label class="grid gap-1 text-sm">Размер текста
      <select :value="style.size" :class="inputClass"
        @change="style = { ...style, size: Number(($event.target as HTMLSelectElement).value) as MailTextStyle['size'] }">
        <option v-for="size in mailTextSizes" :key="size" :value="size">{{ size }} px</option>
      </select>
    </label>
    <label class="grid gap-1 text-sm">Выравнивание
      <select :value="style.align" :class="inputClass" @change="style = { ...style, align: ($event.target as HTMLSelectElement).value as MailTextStyle['align'] }">
        <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
      </select>
    </label>
    <label class="flex min-h-10 items-center gap-2 self-end text-sm">
      <input :checked="style.bold" type="checkbox" class="accent-accent" @change="style = { ...style, bold: ($event.target as HTMLInputElement).checked }" /> Жирный
    </label>
  </div>
</template>
