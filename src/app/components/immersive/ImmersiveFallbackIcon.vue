<template>
  <img class="ui-image" :src="icons[kind]" :width="size" :height="size" :alt="label" :style="{ display: 'block', flex: 'none' }" />
</template>
<script setup lang="ts">
import KINETIC from '@/assets/immersive/damage/kinetic.svg';
import HIGH_EXPLOSIVE from '@/assets/immersive/damage/high-explosive.svg';
import FRAGMENTATION from '@/assets/immersive/damage/fragmentation.svg';
import ENERGY from '@/assets/immersive/damage/energy.svg';
import OTHER from '@/assets/immersive/damage/other.svg';
import hullmod from '@/assets/immersive/icons/generic-hullmod.svg';
import fighter from '@/assets/immersive/icons/fighter-blank.svg';
defineProps<{ kind: string; size: number; label: string }>();
const icons: Record<string, string> = { KINETIC, HIGH_EXPLOSIVE, FRAGMENTATION, ENERGY, OTHER, hullmod, fighter };
</script>
