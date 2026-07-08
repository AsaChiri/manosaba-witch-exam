<script setup lang="ts">
/*
 * Vue twin of Seal.astro — same geometry, for use inside the exam island
 * (Astro components can't render into a Vue island). Keep the two in sync.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    size?: number | string
    stained?: boolean
    glow?: boolean
    title?: string
  }>(),
  { size: '1em', stained: false, glow: false },
)

const dim = computed(() => (typeof props.size === 'number' ? `${props.size}px` : props.size))
const C = 50
const ticks = Array.from({ length: 60 }, (_, i) => (i * 360) / 60)
const beads = Array.from({ length: 24 }, (_, i) => {
  const a = ((i * 360) / 24 - 90) * (Math.PI / 180)
  return { x: C + 40 * Math.cos(a), y: C + 40 * Math.sin(a) }
})
const orbits = [0, 60, 120]
const petal = (R: number, halfW: number, waist: number) =>
  `M${C} ${C} Q${C + halfW} ${C - R * waist}, ${C} ${C - R} Q${C - halfW} ${C - R * waist}, ${C} ${C} Z`
const outerPetals = Array.from({ length: 12 }, (_, i) => (i * 360) / 12)
const innerPetals = Array.from({ length: 6 }, (_, i) => (i * 360) / 6 + 30)
const uid = 'vseal-' + Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg
    class="seal"
    :width="dim"
    :height="dim"
    viewBox="0 0 100 100"
    :role="title ? 'img' : 'presentation'"
    :aria-label="title"
    :aria-hidden="title ? undefined : 'true'"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title v-if="title">{{ title }}</title>
    <defs>
      <radialGradient :id="`${uid}-core`" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="var(--seal-rose, #eb8b79)" :stop-opacity="stained ? 0.9 : 0" />
        <stop offset="55%" stop-color="var(--seal-cobalt, #4f86b8)" :stop-opacity="stained ? 0.5 : 0" />
        <stop offset="100%" stop-color="var(--seal-cobalt, #4f86b8)" stop-opacity="0" />
      </radialGradient>
      <filter v-if="glow" :id="`${uid}-glow`" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <g
      stroke="currentColor"
      stroke-width="1.1"
      stroke-linecap="round"
      :filter="glow ? `url(#${uid}-glow)` : undefined"
    >
      <circle cx="50" cy="50" r="47.5" stroke-width="1.3" />
      <circle cx="50" cy="50" r="43" stroke-width="0.7" opacity="0.85" />
      <circle cx="50" cy="50" r="34" stroke-width="0.5" opacity="0.5" />
      <g stroke-width="0.5" opacity="0.6">
        <line
          v-for="(a, i) in ticks"
          :key="'t' + i"
          x1="50"
          y1="4.5"
          x2="50"
          y2="7.2"
          :transform="`rotate(${a} 50 50)`"
        />
      </g>
      <circle v-if="stained" cx="50" cy="50" r="21.5" :fill="`url(#${uid}-core)`" stroke="none" />
      <g fill="currentColor" stroke="none" opacity="0.75">
        <circle v-for="(b, i) in beads" :key="'b' + i" :cx="b.x" :cy="b.y" r="0.7" />
      </g>
      <g stroke-width="0.75" opacity="0.68">
        <ellipse v-for="(r, i) in orbits" :key="'o' + i" cx="50" cy="50" rx="30" ry="12" :transform="`rotate(${r} 50 50)`" />
      </g>
      <g stroke-width="0.8" opacity="0.92">
        <path v-for="(a, i) in outerPetals" :key="'p' + i" :d="petal(20, 4.4, 0.42)" :transform="`rotate(${a} 50 50)`" />
      </g>
      <g stroke-width="0.7" opacity="0.8">
        <path v-for="(a, i) in innerPetals" :key="'q' + i" :d="petal(10.5, 3.1, 0.4)" :transform="`rotate(${a} 50 50)`" />
      </g>
      <circle cx="50" cy="50" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="50" cy="50" r="5.2" stroke-width="0.6" opacity="0.7" />
    </g>
  </svg>
</template>

<style scoped>
.seal {
  display: inline-block;
  overflow: visible;
  flex: none;
}
</style>
