// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Message Type Encoding
 *
 * Defines the RPC message types and expression types used in capnweb.
 * Supports three encoding modes:
 *
 * - 'array': Original format using string literals in arrays
 *   ["push", ["pipeline", -1, path, args]]
 *
 * - 'object': Object keys for CBOR structure optimization
 *   {push: {pipeline: [-1, path, args]}}
 *
 * - 'numeric': Numeric IDs for minimal overhead (like MoQ)
 *   [0, [6, -1, path, args]]
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/** Top-level RPC message types */
export const MessageType = {
	PUSH: 'push',
	PULL: 'pull',
	RESOLVE: 'resolve',
	REJECT: 'reject',
	RELEASE: 'release',
	ABORT: 'abort',
	/**
	 * EXPERIMENTAL (NOT YET FUNCTIONAL): Hibernation support for Cloudflare Durable Objects.
	 *
	 * RECONNECT is intended to be sent by the client after detecting the server has woken
	 * from hibernation. Would contain the client's known import/export IDs so the server
	 * can reconstruct state.
	 *
	 * @experimental This is part of an incomplete attempt at Hibernatable WebSocket support.
	 * The hibernation feature does not yet work. May change significantly or be removed.
	 */
	RECONNECT: 'reconnect',
	/**
	 * EXPERIMENTAL (NOT YET FUNCTIONAL): Hibernation support for Cloudflare Durable Objects.
	 *
	 * READY is intended to be sent by the server in response to RECONNECT, confirming which
	 * imports/exports were restored and which were lost.
	 *
	 * @experimental This is part of an incomplete attempt at Hibernatable WebSocket support.
	 * The hibernation feature does not yet work. May change significantly or be removed.
	 */
	READY: 'ready',
} as const

export type MessageTypeName = (typeof MessageType)[keyof typeof MessageType]

/** Numeric IDs for message types (used in 'numeric' mode) */
export const MessageTypeId = {
	push: 0,
	pull: 1,
	resolve: 2,
	reject: 3,
	release: 4,
	abort: 5,
} as const

/** Reverse lookup: ID to name */
export const MessageTypeById: Record<number, MessageTypeName> = {
	0: 'push',
	1: 'pull',
	2: 'resolve',
	3: 'reject',
	4: 'release',
	5: 'abort',
}

// ============================================================================
// EXPRESSION TYPES
// ============================================================================

/** Expression types used within message payloads */
export const ExpressionType = {
	PIPELINE: 'pipeline',
	IMPORT: 'import',
	EXPORT: 'export',
	PROMISE: 'promise',
	REMAP: 'remap',
} as const

export type ExpressionTypeName = (typeof ExpressionType)[keyof typeof ExpressionType]

/** Numeric IDs for expression types (used in 'numeric' mode) */
export const ExpressionTypeId = {
	pipeline: 6,
	import: 7,
	export: 8,
	promise: 9,
	remap: 10,
} as const

/** Reverse lookup: ID to name */
export const ExpressionTypeById: Record<number, ExpressionTypeName> = {
	6: 'pipeline',
	7: 'import',
	8: 'export',
	9: 'promise',
	10: 'remap',
}

// ============================================================================
// SPECIAL VALUE TYPES (used in serialize.ts)
// ============================================================================

/** Special value type markers */
export const SpecialType = {
	BIGINT: 'bigint',
	DATE: 'date',
	BYTES: 'bytes',
	ERROR: 'error',
	UNDEFINED: 'undefined',
	INF: 'inf',
	NEG_INF: '-inf',
	NAN: 'nan',
} as const

export type SpecialTypeName = (typeof SpecialType)[keyof typeof SpecialType]

/** Numeric IDs for special types (used in 'numeric' mode) */
export const SpecialTypeId = {
	bigint: 11,
	date: 12,
	bytes: 13,
	error: 14,
	undefined: 15,
	inf: 16,
	'-inf': 17,
	nan: 18,
} as const

/** Reverse lookup: ID to name */
export const SpecialTypeById: Record<number, SpecialTypeName> = {
	11: 'bigint',
	12: 'date',
	13: 'bytes',
	14: 'error',
	15: 'undefined',
	16: 'inf',
	17: '-inf',
	18: 'nan',
}

// ============================================================================
// ENCODING MODE
// ============================================================================

/**
 * Message encoding mode.
 *
 * - 'array': String type names as array first element (original format)
 * - 'object': Type name as object key (enables CBOR structure optimization)
 * - 'numeric': Numeric type IDs (minimal overhead, MoQ-style)
 */
export type MessageEncodingMode = 'array' | 'object' | 'numeric'

// ============================================================================
// ENCODER/DECODER HELPERS
// ============================================================================

/**
 * Encode a message type based on the encoding mode.
 */
export function encodeMessageType(
	type: MessageTypeName,
	mode: MessageEncodingMode
): string | number {
	if (mode === 'numeric') {
		const id = (MessageTypeId as Partial<Record<MessageTypeName, number>>)[type]
		if (id === undefined) throw new Error(`Message type is not supported in numeric mode: ${type}`)
		return id
	}
	return type
}

/**
 * Decode a message type based on the encoding mode.
 */
export function decodeMessageType(
	encoded: string | number,
	mode: MessageEncodingMode
): MessageTypeName {
	if (mode === 'numeric' && typeof encoded === 'number') {
		const name = MessageTypeById[encoded]
		if (!name) throw new Error(`Unknown message type ID: ${encoded}`)
		return name
	}
	if (typeof encoded === 'string') {
		return encoded as MessageTypeName
	}
	throw new Error(`Invalid message type: ${encoded}`)
}

/**
 * Encode an expression type based on the encoding mode.
 */
export function encodeExpressionType(
	type: ExpressionTypeName,
	mode: MessageEncodingMode
): string | number {
	if (mode === 'numeric') {
		return ExpressionTypeId[type]
	}
	return type
}

/**
 * Decode an expression type based on the encoding mode.
 */
export function decodeExpressionType(
	encoded: string | number,
	mode: MessageEncodingMode
): ExpressionTypeName {
	if (mode === 'numeric' && typeof encoded === 'number') {
		const name = ExpressionTypeById[encoded]
		if (!name) throw new Error(`Unknown expression type ID: ${encoded}`)
		return name
	}
	if (typeof encoded === 'string') {
		return encoded as ExpressionTypeName
	}
	throw new Error(`Invalid expression type: ${encoded}`)
}

/**
 * Encode a special value type based on the encoding mode.
 */
export function encodeSpecialType(
	type: SpecialTypeName,
	mode: MessageEncodingMode
): string | number {
	if (mode === 'numeric') {
		return SpecialTypeId[type]
	}
	return type
}

/**
 * Decode a special value type based on the encoding mode.
 */
export function decodeSpecialType(
	encoded: string | number,
	mode: MessageEncodingMode
): SpecialTypeName {
	if (mode === 'numeric' && typeof encoded === 'number') {
		const name = SpecialTypeById[encoded]
		if (!name) throw new Error(`Unknown special type ID: ${encoded}`)
		return name
	}
	if (typeof encoded === 'string') {
		return encoded as SpecialTypeName
	}
	throw new Error(`Invalid special type: ${encoded}`)
}

/**
 * Check if a value is a message type identifier (string or number depending on mode).
 */
export function isMessageType(
	value: unknown,
	mode: MessageEncodingMode
): value is MessageTypeName | number {
	if (mode === 'numeric') {
		return typeof value === 'number' && value in MessageTypeById
	}
	return typeof value === 'string' && value in MessageTypeId
}

/**
 * Check if a value is an expression type identifier.
 */
export function isExpressionType(
	value: unknown,
	mode: MessageEncodingMode
): value is ExpressionTypeName | number {
	if (mode === 'numeric') {
		return typeof value === 'number' && value in ExpressionTypeById
	}
	return typeof value === 'string' && value in ExpressionTypeId
}

/**
 * Check if a value is a special type identifier.
 */
export function isSpecialType(
	value: unknown,
	mode: MessageEncodingMode
): value is SpecialTypeName | number {
	if (mode === 'numeric') {
		return typeof value === 'number' && value in SpecialTypeById
	}
	return typeof value === 'string' && value in SpecialTypeId
}

// ============================================================================
// MESSAGE WRAPPING (for 'object' mode)
// ============================================================================

/**
 * Wrap a message payload for 'object' mode encoding.
 * Converts ["push", payload] to {push: payload}
 */
export function wrapMessageForObjectMode(
	type: MessageTypeName,
	payload: unknown[]
): Record<string, unknown> {
	return { [type]: payload.length === 1 ? payload[0] : payload }
}

/**
 * Unwrap a message from 'object' mode encoding.
 * Converts {push: payload} to ["push", payload]
 */
export function unwrapMessageFromObjectMode(
	msg: Record<string, unknown>
): [MessageTypeName, unknown] {
	const keys = Object.keys(msg)
	if (keys.length !== 1) {
		throw new Error(`Invalid object-mode message: expected 1 key, got ${keys.length}`)
	}
	const type = keys[0] as MessageTypeName
	if (!(type in MessageTypeId)) {
		throw new Error(`Unknown message type: ${type}`)
	}
	return [type, msg[type]]
}

/**
 * Wrap an expression for 'object' mode encoding.
 */
export function wrapExpressionForObjectMode(
	type: ExpressionTypeName,
	payload: unknown[]
): Record<string, unknown> {
	return { [type]: payload }
}

/**
 * Unwrap an expression from 'object' mode encoding.
 */
export function unwrapExpressionFromObjectMode(
	expr: Record<string, unknown>
): [ExpressionTypeName, unknown[]] {
	const keys = Object.keys(expr)
	if (keys.length !== 1) {
		throw new Error(`Invalid object-mode expression: expected 1 key, got ${keys.length}`)
	}
	const type = keys[0] as ExpressionTypeName
	if (!(type in ExpressionTypeId)) {
		throw new Error(`Unknown expression type: ${type}`)
	}
	const payload = expr[type]
	return [type, Array.isArray(payload) ? payload : [payload]]
}
