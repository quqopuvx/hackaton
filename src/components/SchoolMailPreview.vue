<script setup lang="ts">
import { computed } from "vue";
import { renderSchoolMailHtml } from "../../lib/school-mail-html";
import { personalizeSchoolMail, type SchoolMailLayout } from "../../lib/school-mail";
import { renderDesignedMail } from "../../lib/school-mail-design-html";
import type { SchoolMailDesign } from "../../lib/school-mail-design";

const props = defineProps<{ subject: string; text: string; layout: SchoolMailLayout; design?: SchoolMailDesign | null; signature?: string; schoolName?: string }>();
const personalize = (text: string) => props.schoolName ? personalizeSchoolMail(text, props.schoolName) : text;
const plainText = computed(() => personalize(props.text));
const html = computed(() => props.design
  ? renderDesignedMail(props.design, props.subject, props.text, props.signature, personalize)
  : renderSchoolMailHtml(props.layout, props.subject, plainText.value));
</script>

<template>
  <section aria-label="Предпросмотр письма" class="overflow-hidden rounded-ui border border-line bg-canvas text-sm [overflow-wrap:anywhere]">
    <div class="px-4 py-3">
      <p class="text-xs font-medium text-secondary">Предпросмотр письма</p>
      <p class="mt-1 font-semibold">{{ subject }}</p>
      <p v-if="!html" class="mt-2 whitespace-pre-wrap">{{ plainText }}</p>
    </div>
    <div v-if="html" v-html="html" />
  </section>
</template>
