<script setup lang="ts">
import { computed, ref } from "vue";
import { mailDesignBlockLimit, mailDesignImageLimit, mailImageDataUrl, mailImageTypes, mailImageWidths,
  type MailDesignBlock, type SchoolMailDesign } from "../../lib/school-mail-design";
import { schoolMailTextLimit, schoolNameToken } from "../../lib/school-mail";
import { loadMailImage } from "../school-mail-images";
import MailTextStyleFields from "./MailTextStyleFields.vue";

const design = defineModel<SchoolMailDesign>("design", { required: true });
const body = defineModel<string>("body", { required: true });
defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ processing: [busy: boolean] }>();
const error = ref("");
const busy = ref(false);
const accept = mailImageTypes.join(",");
const inputClass = "min-h-10 w-full rounded-xl border border-line bg-canvas px-3 text-sm";
const actionClass = "min-h-10 rounded-xl border border-line px-3 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-45";
const blockLabels = { body: "Основной текст", text: "Текст", image: "Изображение", divider: "Разделитель" };
const imagesAvailable = computed(() => Math.min(mailDesignBlockLimit - design.value.blocks.length,
  mailDesignImageLimit - design.value.blocks.filter((block) => block.type === "image").length));

function addBlock(type: "text" | "divider"): void {
  if (design.value.blocks.length >= mailDesignBlockLimit) return;
  const block: MailDesignBlock = type === "divider" ? { type } : { type, text: "", size: 16, align: "left", bold: false };
  design.value.blocks.push(block);
}

async function upload(event: Event, forBackground = false): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length || busy.value) return;
  const target = design.value;
  busy.value = true;
  emit("processing", true);
  error.value = "";
  try {
    const chosen = files.slice(0, forBackground ? 1 : imagesAvailable.value);
    const errors = files.length > chosen.length ? ["Достигнут лимит изображений или блоков."] : [];
    for (const file of chosen) {
      try {
        const image = await loadMailImage(file);
        if (target !== design.value) break;
        if (forBackground) target.background = image;
        else target.blocks.push({ type: "image", image, width: 100, align: "center", alt: "" });
      } catch (cause) {
        errors.push(file.name + " — " + (cause instanceof Error ? cause.message : "Не удалось загрузить изображение."));
      }
    }
    error.value = errors.join(" ");
  } finally {
    busy.value = false;
    emit("processing", false);
  }
}

function moveBlock(index: number, step: -1 | 1): void {
  const blocks = design.value.blocks;
  const next = index + step;
  if (next < 0 || next >= blocks.length) return;
  const [block] = blocks.splice(index, 1);
  blocks.splice(next, 0, block);
}
</script>

<template>
  <fieldset :disabled="disabled || busy" class="min-w-0 space-y-4">
    <p v-if="busy" class="text-sm text-secondary" role="status">Подготавливаю изображения…</p>
    <div class="space-y-3 rounded-2xl border border-line bg-canvas p-3 sm:p-4">
      <h4 class="font-semibold">Заголовок и фон</h4>
      <MailTextStyleFields v-model:style="design.heading" />
      <div class="flex flex-wrap gap-3">
        <label class="flex items-center gap-2 text-sm"><input v-model="design.textColor" type="color" class="size-9" /> Цвет текста</label>
        <label class="flex items-center gap-2 text-sm"><input v-model="design.backgroundColor" type="color" class="size-9" /> Цвет фона</label>
      </div>
      <label class="grid min-w-0 gap-1 text-sm font-medium">
        Фоновое изображение
        <input type="file" :accept="accept" class="w-full text-sm file:mr-2 file:rounded-xl file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-accent"
          @change="upload($event, true)" />
      </label>
      <div v-if="design.background" class="flex flex-wrap items-center gap-2">
        <img :src="mailImageDataUrl(design.background)" alt="Фон письма" class="h-12 w-20 rounded object-cover" />
        <button type="button" class="min-h-10 px-2 text-sm text-danger" @click="design.background = null">Убрать фон</button>
      </div>
    </div>

    <div class="space-y-2">
      <h4 class="font-semibold">Порядок блоков</h4>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" :class="actionClass" :disabled="design.blocks.length >= mailDesignBlockLimit" @click="addBlock('text')">Добавить текст</button>
        <button type="button" :class="actionClass" :disabled="design.blocks.length >= mailDesignBlockLimit" @click="addBlock('divider')">Добавить разделитель</button>
      </div>
      <label class="grid min-w-0 gap-1 text-sm font-medium">
        <input type="file" multiple :accept="accept" :disabled="imagesAvailable === 0"
          class="w-full text-sm file:mr-2 file:rounded-xl file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-accent disabled:opacity-45"
          @change="upload($event)" />
      </label>
      <p v-if="error" role="alert" class="text-sm text-danger [overflow-wrap:anywhere]">{{ error }}</p>
    </div>

    <ol class="space-y-2">
      <li v-for="(block, index) in design.blocks" :key="index" class="min-w-0 space-y-2 rounded-2xl border border-line bg-canvas p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h5 class="text-sm font-semibold">{{ blockLabels[block.type] }}</h5>
          <div class="flex flex-wrap items-center gap-1">
            <button type="button" :class="actionClass" :aria-label="`Переместить блок ${index + 1} вверх`" :disabled="index === 0"
              @click="moveBlock(index, -1)">↑</button>
            <button type="button" :class="actionClass" :aria-label="`Переместить блок ${index + 1} вниз`" :disabled="index === design.blocks.length - 1"
              @click="moveBlock(index, 1)">↓</button>
            <button v-if="block.type !== 'body'" type="button" class="min-h-10 px-2 text-sm text-danger"
              :aria-label="`Удалить блок ${index + 1}`" @click="design.blocks.splice(index, 1)">Удалить</button>
          </div>
        </div>
        <template v-if="block.type === 'body' || block.type === 'text'">
          <MailTextStyleFields :style="block" @update:style="Object.assign(block, $event)" />
          <textarea v-if="block.type === 'body'" v-model="body" rows="5" :maxlength="schoolMailTextLimit" required
            aria-label="Основной текст письма" :class="inputClass" class="resize-y py-2" />
          <textarea v-else v-model="block.text" rows="3" :maxlength="schoolMailTextLimit" :aria-label="`Текст блока ${index + 1}`"
            :class="inputClass" class="resize-y py-2" />
        </template>
        <template v-else-if="block.type === 'image'">
          <img :src="mailImageDataUrl(block.image)" :alt="block.alt" class="max-h-24 max-w-full rounded object-contain" />
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="grid gap-1 text-sm">Ширина
              <select v-model="block.width" :class="inputClass">
                <option v-for="width in mailImageWidths" :key="width" :value="width">{{ width }}%</option>
              </select>
            </label>
            <label class="grid gap-1 text-sm">Выравнивание
              <select v-model="block.align" :class="inputClass">
                <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
              </select>
            </label>
          </div>
          <label class="grid gap-1 text-sm">Описание изображения
            <input v-model="block.alt" :class="inputClass" maxlength="200" />
          </label>
        </template>
      </li>
    </ol>
    <p class="text-xs text-secondary">В текстовых блоках <code>{{ schoolNameToken }}</code> заменится названием учреждения.</p>
  </fieldset>
</template>
