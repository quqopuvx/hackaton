<script setup lang="ts">
import { computed, ref } from "vue";
import { regionByCode, regionMap } from "../regions";

const selected = defineModel<string>({ required: true });
const props = defineProps<{
  counts: ReadonlyMap<string, number>;
  otherRegions: Array<{ code: string; region: string }>;
  total: number;
}>();
const svg = ref<SVGSVGElement>();
const hovered = ref("");
const zoom = ref(1);
const offset = ref({ x: 0, y: 0 });
const colors = ["#dce7f0", "#a8d7f3", "#50a8dc", "#2373ab"];
const names = new Intl.Collator("ru", { numeric: true });
const options = computed(() => [
  ...regionMap.regions.map(({ code, name }) => ({ code, region: name })),
  ...props.otherRegions,
].sort((a, b) => names.compare(a.region, b.region)));
const active = computed(() => {
  const code = hovered.value || selected.value;
  return options.value.find((region) => region.code === code);
});
const coverage = computed(() => regionMap.regions.filter(({ code }) => (props.counts.get(code) ?? 0) > 0).length);
const viewBox = computed(() => `${offset.value.x} ${offset.value.y} ${regionMap.width / zoom.value} ${regionMap.height / zoom.value}`);
const dragging = ref(false);
let ignoreClick = false;
let pointer: { id: number; x: number; y: number; factor: number; origin: { x: number; y: number } } | undefined;

function color(code: string): string {
  if (selected.value === code) return "#174f79";
  const count = props.counts.get(code) ?? 0;
  return colors[count >= 10 ? 3 : count >= 4 ? 2 : count > 0 ? 1 : 0];
}

function moveView(x: number, y: number): void {
  offset.value = {
    x: Math.max(0, Math.min(regionMap.width - regionMap.width / zoom.value, x)),
    y: Math.max(0, Math.min(regionMap.height - regionMap.height / zoom.value, y)),
  };
}

function changeZoom(multiplier: number): void {
  const centerX = offset.value.x + regionMap.width / (zoom.value * 2);
  const centerY = offset.value.y + regionMap.height / (zoom.value * 2);
  zoom.value = Math.max(1, Math.min(5, zoom.value * multiplier));
  moveView(centerX - regionMap.width / (zoom.value * 2), centerY - regionMap.height / (zoom.value * 2));
}

function resetView(): void {
  zoom.value = 1;
  moveView(0, 0);
}

function startPan(event: PointerEvent): void {
  ignoreClick = false;
  if (zoom.value === 1 || event.button !== 0) return;
  const scale = svg.value?.getScreenCTM()?.a;
  if (!scale) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, factor: 1 / scale, origin: { ...offset.value } };
}

function pan(event: PointerEvent): void {
  if (!pointer || event.pointerId !== pointer.id) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  if (!dragging.value && Math.hypot(dx, dy) < 5) return;
  if (!dragging.value) {
    svg.value?.setPointerCapture(event.pointerId);
    dragging.value = true;
    ignoreClick = true;
    hovered.value = "";
  }
  moveView(pointer.origin.x - dx * pointer.factor, pointer.origin.y - dy * pointer.factor);
}

function stopPan(): void {
  pointer = undefined;
  dragging.value = false;
}

function hoverRegion(code: string): void {
  hovered.value = dragging.value ? "" : code;
}

function leaveMap(): void {
  hovered.value = "";
  if (!dragging.value) stopPan();
}

function toggle(code: string): void {
  selected.value = selected.value === code ? "" : code;
}

function selectByClick(code: string): void {
  if (!ignoreClick) toggle(code);
}

function accessibleName(code: string): string {
  return `${regionByCode.get(code)?.name}: учреждений в реестре ${props.counts.get(code) ?? 0}`;
}
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-line bg-surface sm:rounded-[1.75rem]" aria-labelledby="region-map-title">
    <div class="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4 sm:px-7 sm:py-5">
      <div class="min-w-0">
        <h2 id="region-map-title" class="text-lg font-semibold tracking-tight sm:text-xl">Карта учреждений реестра</h2>
        <p class="mt-1 text-sm text-secondary">Выберите регион, чтобы отфильтровать реестр.</p>
      </div>
      <label class="flex w-full min-w-0 flex-col gap-1 text-xs font-medium text-secondary sm:max-w-80" for="registry-region">
        Регион
        <select id="registry-region" v-model="selected"
          class="min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-base text-ink focus-visible:outline-accent sm:text-sm">
          <option value="">Все регионы</option>
          <option v-for="option in options" :key="option.code" :value="option.code">
            {{ option.region }} ({{ counts.get(option.code) ?? 0 }})
          </option>
        </select>
      </label>
    </div>

    <div class="flex flex-wrap gap-x-5 gap-y-1 border-y border-line bg-slate-50 px-4 py-2 text-sm text-secondary sm:gap-x-7 sm:px-7 sm:py-3">
      <span>В реестре <strong class="ml-1 text-base text-ink">{{ total }}</strong></span>
      <span>Регионов с записями на карте <strong class="ml-1 text-base text-ink">{{ coverage }} из {{ regionMap.regions.length }}</strong></span>
      <span v-if="selected">Выбрано учреждений <strong class="ml-1 text-base text-ink">{{ counts.get(selected) ?? 0 }}</strong></span>
    </div>

    <div class="relative bg-[#f2f7fc]">
      <svg ref="svg" :viewBox="viewBox" class="block w-full select-none overflow-hidden"
        :class="{ 'touch-none': zoom > 1, 'cursor-grabbing': dragging }"
        role="group" aria-label="Интерактивная карта регионов"
        @pointerdown="startPan" @pointermove="pan" @pointerup="stopPan" @pointercancel="stopPan"
        @lostpointercapture="stopPan" @pointerleave="leaveMap">
        <path v-for="region in regionMap.regions" :key="region.code" :d="region.path"
          :fill="color(region.code)" :class="{ 'region-hover': hovered === region.code }"
          fill-rule="evenodd" class="map-region" role="button" tabindex="-1"
          :aria-label="accessibleName(region.code)" :aria-pressed="selected === region.code"
          @pointerenter="hoverRegion(region.code)" @pointerleave="hovered = ''"
          @focus="hovered = region.code" @blur="hovered = ''"
          @click="selectByClick(region.code)" @keydown.enter.prevent="toggle(region.code)" @keydown.space.prevent="toggle(region.code)">
          <title>{{ accessibleName(region.code) }}</title>
        </path>
        <template v-for="region in regionMap.regions" :key="`marker-${region.code}`">
          <circle v-if="region.marker" :cx="region.marker[0]" :cy="region.marker[1]" :r="5 / zoom"
            :fill="color(region.code)" :class="{ 'region-hover': hovered === region.code }"
            class="map-city" role="button" tabindex="0" :aria-label="accessibleName(region.code)"
            :aria-pressed="selected === region.code"
            @pointerenter="hoverRegion(region.code)" @pointerleave="hovered = ''"
            @focus="hovered = region.code" @blur="hovered = ''"
            @click="selectByClick(region.code)" @keydown.enter.prevent="toggle(region.code)" @keydown.space.prevent="toggle(region.code)">
            <title>{{ accessibleName(region.code) }}</title>
          </circle>
        </template>
      </svg>

      <div class="flex justify-end gap-1 px-3 pb-3 sm:absolute sm:top-4 sm:right-4 sm:flex-col sm:p-0"
        role="group" aria-label="Масштаб карты">
        <button type="button" class="map-control" :disabled="zoom >= 5" aria-label="Приблизить карту" @click="changeZoom(1.5)">+</button>
        <button type="button" class="map-control" :disabled="zoom <= 1" aria-label="Отдалить карту" @click="changeZoom(1 / 1.5)">−</button>
        <button type="button" class="map-control text-xs!" :disabled="zoom <= 1" aria-label="Сбросить масштаб карты" @click="resetView">1×</button>
      </div>
    </div>

    <div class="border-t border-line px-4 py-3 sm:px-7">
      <p class="min-h-5 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
        <template v-if="active">{{ active.region }} · {{ counts.get(active.code) ?? 0 }}</template>
        <template v-else>Учреждений в регионе</template>
      </p>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
        <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary" aria-label="Легенда по числу учреждений">
          <li v-for="(label, index) in ['0', '1–3', '4–9', '10+']" :key="label" class="flex items-center gap-1.5">
            <span class="size-3.5 rounded-sm border border-slate-300" :style="{ background: colors[index] }" aria-hidden="true"></span>
            {{ label }}
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.map-region, .map-city {
  cursor: pointer;
  stroke: #fff;
  stroke-width: 1.1;
  vector-effect: non-scaling-stroke;
}

.map-city {
  stroke: #477391;
  stroke-width: 1.5;
}

.region-hover, .map-region:focus-visible, .map-city:focus-visible {
  filter: brightness(0.86);
  outline: none;
  stroke: #174f79;
  stroke-width: 1.8;
}

.map-control {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 0.75rem;
  border: 1px solid #cfdeea;
  background: #fff;
  color: #174f79;
  font-size: 1.25rem;
  font-weight: 700;
}

.map-control:hover:enabled {
  background: #e5f2ff;
}

.map-control:disabled {
  opacity: 0.46;
}
</style>
