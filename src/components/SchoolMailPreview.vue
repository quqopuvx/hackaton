<script setup lang="ts">
import { computed } from "vue";
import { renderSchoolMailHtml } from "../../lib/school-mail-html";
import type { SchoolMailLayout } from "../../lib/school-mail";

const props = defineProps<{ subject: string; text: string; layout: SchoolMailLayout }>();
const html = computed(() => renderSchoolMailHtml(props.layout, props.subject, props.text));
</script>

<template>
  <section aria-label="Предпросмотр письма" class="overflow-hidden rounded-ui border border-line bg-canvas text-sm [overflow-wrap:anywhere]">
    <div class="px-4 py-3">
      <p class="text-xs font-medium text-secondary">Предпросмотр письма</p>
      <p class="mt-1 font-semibold">{{ subject }}</p>
      <p v-if="!html" class="mt-2 whitespace-pre-wrap">{{ text }}</p>
    </div>
    <div v-if="html" v-html="html" />
  </section>
</template>
