import { ALEPH_API_HOST, CRN_LIST_URL } from './config'
import { fetchWithTimeout } from './http'
import type {
  AlephBroadcastMessage,
  AlephBroadcastResponse,
  BalanceResponse,
  Crn,
  CrnListResponse,
  InstanceMessage
} from './types'

export async function fetchBalance(address: string, apiHost = ALEPH_API_HOST): Promise<BalanceResponse> {
  const response = await fetchWithTimeout(`${apiHost}/api/v0/addresses/${address}/balance`, {
    cache: 'no-cache'
  })

  if (!response.ok) throw new Error(`Balance request failed: ${response.status}`)
  return (await response.json()) as BalanceResponse
}

export async function fetchCrns(url = CRN_LIST_URL): Promise<Crn[]> {
  const requestUrl = new URL(url)
  requestUrl.searchParams.set('filter_inactive', 'true')

  const response = await fetchWithTimeout(requestUrl, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`CRN list request failed: ${response.status}`)

  const payload = (await response.json()) as CrnListResponse
  return payload.crns ?? []
}

export async function fetchInstances(address: string, apiHost = ALEPH_API_HOST): Promise<InstanceMessage[]> {
  const url = new URL('/api/v0/messages.json', apiHost)
  url.searchParams.set('msgTypes', 'INSTANCE')
  url.searchParams.set('addresses', address)
  url.searchParams.set('message_statuses', 'processed,removing')
  url.searchParams.set('pagination', '100')
  url.searchParams.set('page', '1')
  url.searchParams.set('sortOrder', '-1')

  const response = await fetchWithTimeout(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Instance list request failed: ${response.status}`)

  const payload = (await response.json()) as { messages?: InstanceMessage[] }
  return payload.messages ?? []
}

export async function broadcastInstanceMessage(
  message: AlephBroadcastMessage,
  apiHost = ALEPH_API_HOST,
  sync = false
): Promise<{ response: AlephBroadcastResponse; httpStatus: number }> {
  const response = await fetchWithTimeout(`${apiHost}/api/v0/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sync,
      message
    })
  })

  const payload = (await response.json().catch(() => ({}))) as AlephBroadcastResponse

  if (!response.ok && response.status !== 202) {
    throw new Error(`Broadcast failed: ${response.status} ${JSON.stringify(payload)}`)
  }

  return {
    response: payload,
    httpStatus: response.status
  }
}
