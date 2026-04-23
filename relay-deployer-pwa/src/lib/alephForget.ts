import { ALEPH_API_HOST, ALEPH_DEFAULT_CHANNEL } from './config'
import { createAuthenticatedAlephHttpClient, inlineStorageEngine } from './alephSdk'
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
  const client = await createAuthenticatedAlephHttpClient(undefined, ALEPH_API_HOST)
  if (client.account.address.toLowerCase() !== args.sender.toLowerCase()) {
    throw new Error('Connected wallet changed. Reconnect the wallet before deleting the instance.')
  }

  try {
    const sdkMessage = await client.forget({
      channel: args.channel ?? ALEPH_DEFAULT_CHANNEL,
      hashes: [args.instanceHash],
      reason: args.reason?.trim(),
      storageEngine: inlineStorageEngine(),
      sync: false
    })

    const message = {
      chain: sdkMessage.chain,
      channel: sdkMessage.channel ?? args.channel ?? ALEPH_DEFAULT_CHANNEL,
      item_content:
        sdkMessage.item_content ??
        JSON.stringify(
          createForgetContent({
            address: args.sender,
            hashes: [args.instanceHash],
            reason: args.reason
          })
        ),
      item_hash: sdkMessage.item_hash,
      item_type: sdkMessage.item_type,
      sender: sdkMessage.sender,
      signature: sdkMessage.signature,
      time: sdkMessage.time,
      type: sdkMessage.type
    } as AlephBroadcastMessage

    return {
      itemHash: message.item_hash,
      status: 'pending',
      message,
      response: {
        message_status: 'pending',
        publication_status: {
          status: 'submitted'
        }
      }
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
