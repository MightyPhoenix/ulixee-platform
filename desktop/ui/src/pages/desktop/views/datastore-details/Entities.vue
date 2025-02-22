<template>
  <div class="flex h-full flex-col">
    <div class="basis-2/3">
      <ul role="list" class="grid grid-cols-6 gap-x-4 gap-y-8">
        <li
          v-for="entity in entities"
          class="cursor-pointer justify-center justify-center rounded-xl p-5 text-center align-middle"
          :class="
            activeEntity?.name === entity.name
              ? [
                  'bg-gray-600 text-white shadow-inner ring-1 ring-fuchsia-800 ring-opacity-20 ring-opacity-80',
                ]
              : [
                  ' bg-white text-gray-700 shadow-md ring-1 ring-black ring-opacity-5 hover:shadow-sm',
                ]
          "
          @click.prevent="
            activeEntity?.name === entity.name ? (activeEntity = null) : (activeEntity = entity)
          "
        >
          <InlineSvg
            class="mx-auto h-14 w-14"
            :src="
              {
                Crawler: require('@/assets/icons/spider.svg'),
                Extractor: require('@/assets/icons/extractor.svg'),
                Table: require('@/assets/icons/table.svg'),
              }[entity.type]
            "
          />
          <div class="text-md mt-4 font-thin">{{ entity.name }}</div>
        </li>
      </ul>
    </div>
    <div
      v-if="activeEntity"
      class="max-h-1/3 mt-10 basis-1/3 overflow-hidden border border-gray-200 bg-white/50 px-8 py-7 shadow-inner"
    >
      <div class="mb-2" v-if="activeEntity.example">
        <span class="text-sm font-bold text-gray-500">Example Query:</span>
        <Prism language="sql">{{ exampleSql(activeEntity.example) }}</Prism>
      </div>
      <div class="mb-2">
        <span class="text-sm font-bold text-gray-500">Type</span
        ><span class="ml-2 text-sm font-thin">{{ activeEntity.type }}</span>
      </div>
      <div class="mb-2" v-if="activeEntity.description">
        ><span class="ml-2 text-sm font-thin">{{ activeEntity.description }}</span>
      </div>
      <Json :json="this.getSchema(activeEntity)" />
    </div>
  </div>
</template>

<script lang="ts">
import { useDatastoreStore } from '@/pages/desktop/stores/DatastoresStore';
import { storeToRefs } from 'pinia';
import * as Vue from 'vue';
import Prism from '@/pages/desktop/components/Prism.vue';
import { useRoute } from 'vue-router';
import { convertJsonToFlat } from '@/utils/flattenJson';
import Json from '@/components/Json.vue';

export default Vue.defineComponent({
  name: 'Entities',
  components: { Json, Prism },
  setup() {
    const route = useRoute();
    const datastoresStore = useDatastoreStore();
    const datastoreId = route.params.datastoreId as string;
    const version = route.params.version as string;
    const { datastoresById } = storeToRefs(datastoresStore);
    datastoresStore.refreshMetadata(datastoreId, version);

    const activeEntity = Vue.ref<{ name: string; type: string; description: string; schema: any }>(
      null,
    );

    const entities = Vue.computed(() => {
      const { details } = datastoresById.value[datastoreId];
      return [
        ...Object.entries(details?.tablesByName ?? {}).map(x => ({
          name: x[0],
          description: x[1].description,
          schema: x[1].schemaAsJson,
          example: details.examplesByEntityName?.[x[0]],
          type: 'Table',
        })),
        ...Object.entries(details?.crawlersByName ?? {}).map(x => ({
          name: x[0],
          description: x[1].description,
          schema: x[1].schemaAsJson,
          example: details.examplesByEntityName?.[x[0]],
          type: 'Crawler',
        })),
        ...Object.entries(details?.extractorsByName ?? {}).map(x => ({
          name: x[0],
          description: x[1].description,
          schema: x[1].schemaAsJson,
          example: details.examplesByEntityName?.[x[0]],
          type: 'Extractor',
        })),
      ];
    });
    return {
      version,
      activeEntity,
      entities,
      datastoresStore,
      datastoresById,
    };
  },
  watch: {},
  methods: {
    getSchema(activeEntity: { schema: any }) {
      if (activeEntity.schema) {
        return convertJsonToFlat(activeEntity.schema);
      }
    },
    exampleSql(example: { formatted: string; args: Record<string, any> }): string {
      let replacedFormatted = example.formatted;
      let key = 1;
      for (const value of Object.values(example.args)) {
        let parsed = `${value}`;
        if (typeof value === 'string') parsed = `'${value}'`;
        replacedFormatted = replacedFormatted.replaceAll(`$${key}`, parsed);
        key += 1;
      }
      return `SELECT * FROM ${replacedFormatted}`;
    },
  },
});
</script>
