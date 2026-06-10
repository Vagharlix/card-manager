<template>
  <div class="flex gap-2 items-center">
    <span class="text-sm text-muted w-12 shrink-0">{{ label }}</span>

    <USelect v-model="op" :items="OPERATORS" class="w-18 shrink-0" size="sm" />

    <UInput v-model="valueStr" type="number" placeholder="—" size="sm" class="flex-1 min-w-0" />

    <div class="w-6 shrink-0 flex justify-center">
      <UButton
        v-if="modelValue"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="clear"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NumericFilter } from '~/services/search'

const props = defineProps<{
  label: string
  modelValue: NumericFilter | undefined
}>()

const emit = defineEmits<{ 'update:modelValue': [value: NumericFilter | undefined] }>()

const OPERATORS = ['=', '>=', '<=', '>', '<']

// état local des deux champs
const op = ref<NumericFilter['op']>(props.modelValue?.op ?? '>=')
const valueStr = ref<string>(props.modelValue?.value != null ? String(props.modelValue.value) : '')

// garde les champs locaux en phase si le parent change (ex: reset)
watch(
  () => props.modelValue,
  (v) => {
    op.value = v?.op ?? '>='
    valueStr.value = v?.value != null ? String(v.value) : ''
  }
)

// émet le filtre dès que l'opérateur OU la valeur change
watch([op, valueStr], () => {
  if (valueStr.value === '' || Number.isNaN(Number(valueStr.value))) {
    emit('update:modelValue', undefined)
  } else {
    emit('update:modelValue', { op: op.value, value: Number(valueStr.value) })
  }
})

function clear() {
  valueStr.value = ''
  op.value = '>='
}
</script>
