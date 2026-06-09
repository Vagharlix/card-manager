<template>
  <AppPage>
    <div class="flex flex-col items-center justify-center text-center gap-4 py-20">
      <UIcon name="i-lucide-cards" class="text-5xl text-primary" />
      <h1 class="text-2xl font-semibold">card-manager</h1>
      <p class="text-muted max-w-md">Lorem Ipsum</p>
      <div class="flex gap-3 mt-2">
        <UButton to="/collection" label="Ma collection" icon="i-lucide-layout-grid" />
        <UButton to="/search" label="Parcourir les cartes" icon="i-lucide-search" variant="soft" />
      </div>
    </div>
  </AppPage>
</template>
