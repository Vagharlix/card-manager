<template>
  <div class="flex flex-1 h-full overflow-hidden">
    <!-- DESKTOP : sidebar fixe -->
    <!-- double écran (charnière verticale) : la sidebar occupe tout l'écran de
         gauche, le contenu commence après la charnière (cf. useViewportSegments) -->
    <aside
      v-if="!isMobile && $slots.sidebar"
      class="shrink-0 border-r border-default overflow-y-auto p-4"
      :class="dual ? '' : 'w-80'"
      :style="
        dual
          ? { width: `${segments.leftWidth}px`, marginRight: `${segments.hingeWidth}px` }
          : undefined
      "
      :data-dual-screen="dual || undefined"
    >
      <slot name="sidebar" />
    </aside>

    <!-- MOBILE : la sidebar devient un panneau qui monte du bas (sauf si la
         page la remplace elle-même : mobile-sidebar=false) -->
    <UDrawer
      v-if="isMobile && $slots.sidebar && mobileSidebar"
      :open="sidebarOpen"
      :title="sidebarLabel"
      handle-only
      :ui="{
        content:
          'max-h-[calc(100dvh-var(--safe-top)-0.75rem)] left-(--safe-left) right-(--safe-right)',
      }"
      @update:open="onSidebarOpen"
    >
      <template #header>
        <div class="flex items-center gap-2 w-full">
          <h2 class="flex-1 min-w-0 truncate text-highlighted font-semibold">
            {{ sidebarLabel }}
          </h2>
          <UButton
            data-drawer-close
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="lg"
            aria-label="Close"
            @click="onSidebarOpen(false)"
          />
        </div>
      </template>
      <template #body>
        <div class="pb-[var(--safe-bottom)]">
          <slot name="sidebar" />
        </div>
      </template>
    </UDrawer>

    <!-- contenu : hauteur contrainte, pas de scroll ici (la page gère son scroll interne) -->
    <div
      class="flex-1 min-h-0 overflow-hidden flex flex-col"
      :class="isMobile ? 'px-4 pt-3' : 'p-4'"
    >
      <!-- MOBILE : grand titre de page + actions -->
      <div
        v-if="
          isMobile &&
          (title || $slots.actions || ($slots.sidebar && mobileSidebar && sidebarButton))
        "
        class="flex items-center gap-2 mb-3 shrink-0"
      >
        <slot name="leading" />
        <div class="flex-1 min-w-0">
          <h1 class="text-2xl max-[340px]:text-xl font-bold tracking-tight truncate">
            {{ title }}
          </h1>
          <p v-if="subtitle" class="text-xs text-muted truncate">{{ subtitle }}</p>
        </div>
        <UButton
          v-if="$slots.sidebar && mobileSidebar && sidebarButton"
          icon="i-lucide-sliders-horizontal"
          color="neutral"
          variant="soft"
          size="lg"
          :aria-label="sidebarLabel"
          data-mobile-sidebar-btn
          @click="openSidebar"
        />
        <slot name="actions" />
      </div>
      <div class="flex-1 min-h-0">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    sidebarLabel?: string
    /** titre affiché en haut de page sur mobile (sur desktop, la page gère le sien) */
    title?: string
    subtitle?: string
    /** false : la page affiche elle-même le contenu de la sidebar sur mobile */
    mobileSidebar?: boolean
    /** false : la page ouvre elle-même le panneau (v-model:sidebar-open) */
    sidebarButton?: boolean
  }>(),
  {
    sidebarLabel: 'Filters',
    title: undefined,
    subtitle: undefined,
    mobileSidebar: true,
    sidebarButton: true,
  }
)
const sidebarOpen = defineModel<boolean>('sidebarOpen', { default: false })
const { segments } = useViewportSegments()
// double écran côte à côte, et un écran de gauche assez large pour la sidebar
const dual = computed(() => segments.value.columns && segments.value.leftWidth >= 280)

function onSidebarOpen(value: boolean) {
  // pas de clic fantôme sur la page dessous ; seulement à la vraie fermeture :
  // un panneau qui finit de se fermer signale encore les touchers extérieurs
  if (!value && sidebarOpen.value) shieldClicks()
  sidebarOpen.value = value
}
const { isMobile } = useResponsive()
function openSidebar() {
  sidebarOpen.value = true
}
</script>
