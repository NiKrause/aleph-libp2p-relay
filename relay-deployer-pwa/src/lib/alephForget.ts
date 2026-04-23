import { ALEPH_API_HOST, ALEPH_DEFAULT_CHANNEL } from './config'
import { broadcastAlephMessage } from './alephApi'
import { sha256Hex } from './crypto'
import { signaturePayload } from './alephMessage'
import { personalSign } from './wallet'
import type { AlephBroadcastMessage, AlephBroadcastResponse, AlephForgetContent, MessageStatus } from './types'

export function createForgetContent(args: {
  address: string
  hashes: string[]
  reason?: string
  now?: number
}): AlephForgetContent {
  return {
    address: args.address,
    time: args.now ?? Date.now() / 1000,
    hashes: args.hashes,
    reason: args.reason?.trim() || undefined
  }
}

export async function createUnsignedForgetMessage(args: {
  sender: string
  content: AlephForgetContent
  channel?: string
  now?: number
}): Promise<Omit<AlephBroadcastMessage, 'signature'>> {
  const itemContent = JSON.stringify(args.content)
  const itemHash = await sha256Hex(itemContent)

  return {
    sender: args.sender,
    chain: 'ETH',
    type: 'FORGET',
    item_hash: itemHash,
    item_type: 'inline',
    item_content: itemContent,
    time: args.now ?? Date.now() / 1000,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
  }
}

export async function signForgetMessage(
  unsignedMessage: Omit<AlephBroadcastMessage, 'signature'>,
  signer = personalSign
): Promise<AlephBroadcastMessage> {
  const signature = await signer(unsignedMessage.sender, signaturePayload(unsignedMessage))
  return {
    ...unsignedMessage,
    signature: signature.startsWith('0x') ? signature : `0x${signature}`
  }
}

function normalizeStatus(httpStatus: number, responseStatus: unknown): MessageStatus {
  if (httpStatus === 202) return 'pending'
  if (typeof responseStatus !== 'string') return 'unknown'

  const normalized = responseStatus.toLowerCase()
  if (normalized === 'processed' || normalized === 'pending' || normalized === 'rejected') {
    return normalized
  }
  return 'unknown'
}

function normalizeSdkStatus(error: unknown): MessageStatus {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('rejected')) return 'rejected'
  return 'unknown'
}

export async function deleteInstance(args: {
  sender: string
  instanceHash: string
  reason?: string
  channel?: string
}): Promise<{
  itemHash: string
  status: MessageStatus
  message: AlephBroadcastMessage
  response: AlephBroadcastResponse
}> {
  try {
    const unsignedMessage = await createUnsignedForgetMessage({
      sender: args.sender,
      content: createForgetContent({
        address: args.sender,
        hashes: [args.instanceHash],
        reason: args.reason
      }),
      channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
    })
    const message = await signForgetMessage(unsignedMessage)
    const { response, httpStatus } = await broadcastAlephMessage(message, ALEPH_API_HOST, false)
    const status = normalizeStatus(httpStatus, response.message_status)

    return {
      itemHash: message.item_hash,
      status,
      message,
      response
    }
  } catch (error) {
    const status = normalizeSdkStatus(error)
    return {
      itemHash: '',
      status,
      message: {
        sender: args.sender,
        chain: 'ETH',
        signature: '',
        type: 'FORGET',
        item_hash: '',
        item_type: 'inline',
        item_content: JSON.stringify(
          createForgetContent({
            address: args.sender,
            hashes: [args.instanceHash],
            reason: args.reason
          })
        ),
        time: Date.now() / 1000,
        channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
      },
      response: {
        message_status: status,
        details: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
