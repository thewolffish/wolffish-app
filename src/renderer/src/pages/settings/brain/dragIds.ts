import type { CloudProviderConfig } from '@preload/index'

type ProviderId = CloudProviderConfig['id']

/** Stable @dnd-kit drag id for a model. Provider ids and model ids never contain '::'. */
export function dragId(providerId: ProviderId, model: string): string {
  return `${providerId}::${model}`
}

export function decodeDragId(id: string): { providerId: ProviderId; model: string } {
  const sep = id.indexOf('::')
  return { providerId: id.slice(0, sep) as ProviderId, model: id.slice(sep + 2) }
}
