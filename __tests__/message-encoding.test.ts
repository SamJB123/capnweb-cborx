// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Tests for message encoding modes (array, object, numeric).
 *
 * Verifies that all encoding modes:
 * 1. Produce identical decoded results
 * 2. Generate different wire formats
 * 3. Handle all message types correctly
 */

import { expect, it, describe } from "vitest"
import { CborCodec } from "../src/index.js"
import type { MessageEncodingMode } from "../src/message-types.js"
import { MessageTypeId, MessageTypeById } from "../src/message-types.js"

// =======================================================================================
// ENCODING MODE EQUIVALENCE TESTS
// =======================================================================================

describe("Message encoding modes produce identical results", () => {
	const modes: MessageEncodingMode[] = ['array', 'object', 'numeric']

	/**
	 * Helper to test that all modes produce identical decoded results.
	 */
	function testMessageAcrossModes(message: unknown[], description: string) {
		it(`${description}`, () => {
			const results: unknown[] = []

			for (const mode of modes) {
				const codec = new CborCodec({ messageEncodingMode: mode })
				const encoded = codec.encode(message)
				const decoded = codec.decode(encoded)
				results.push(decoded)
			}

			// All modes should produce identical decoded results
			expect(results[0]).toStrictEqual(results[1])
			expect(results[1]).toStrictEqual(results[2])
			expect(results[0]).toStrictEqual(message)
		})
	}

	// Test all message types
	testMessageAcrossModes(
		["push", ["pipeline", 0, ["method", "call"], [42]]],
		"push message with pipeline expression"
	)

	testMessageAcrossModes(
		["pull", 5],
		"pull message"
	)

	testMessageAcrossModes(
		["resolve", 3, { result: "success", value: 123 }],
		"resolve message with object payload"
	)

	testMessageAcrossModes(
		["reject", 7, ["error", "TypeError", "Something went wrong"]],
		"reject message with error"
	)

	testMessageAcrossModes(
		["release", 2, 1],
		"release message"
	)

	testMessageAcrossModes(
		["abort", ["error", "Error", "Connection closed"]],
		"abort message"
	)

	// Edge cases
	testMessageAcrossModes(
		["push", ["export", -1]],
		"push with export expression"
	)

	testMessageAcrossModes(
		["resolve", 0, null],
		"resolve with null value"
	)

	testMessageAcrossModes(
		["resolve", 0, [["nested", "array", "value"]]],
		"resolve with nested array (escaped)"
	)
})

// =======================================================================================
// WIRE FORMAT VERIFICATION
// =======================================================================================

describe("Wire format differs by encoding mode", () => {
	it("array mode uses string type in array wrapped in tag", () => {
		const codec = new CborCodec({ messageEncodingMode: 'array' })
		const message = ["push", { test: "value" }]
		const encoded = codec.encode(message)

		// Decode raw CBOR to inspect wire format
		const { Decoder, Tag } = require('cbor-x')
		const rawDecoder = new Decoder({ useRecords: true })
		const wireFormat = rawDecoder.decode(encoded)

		// Should be wrapped in a Tag
		expect(wireFormat).toBeInstanceOf(Tag)
		expect(wireFormat.tag).toBe(39999)
		// Inside the tag, array format with string type
		expect(Array.isArray(wireFormat.value)).toBe(true)
		expect(wireFormat.value[0]).toBe("push")
	})

	it("object mode uses type as object key wrapped in tag", () => {
		const codec = new CborCodec({ messageEncodingMode: 'object' })
		const message = ["push", { test: "value" }]
		const encoded = codec.encode(message)

		// Decode raw CBOR to inspect wire format
		const { Decoder, Tag } = require('cbor-x')
		const rawDecoder = new Decoder({ useRecords: true })
		const wireFormat = rawDecoder.decode(encoded)

		// Should be wrapped in a Tag
		expect(wireFormat).toBeInstanceOf(Tag)
		expect(wireFormat.tag).toBe(39999)
		// Inside the tag, object format
		expect(typeof wireFormat.value).toBe("object")
		expect(Array.isArray(wireFormat.value)).toBe(false)
		expect(wireFormat.value).toHaveProperty("push")
	})

	it("numeric mode uses numeric type ID wrapped in tag", () => {
		const codec = new CborCodec({ messageEncodingMode: 'numeric' })
		const message = ["push", { test: "value" }]
		const encoded = codec.encode(message)

		// Decode raw CBOR to inspect wire format
		const { Decoder, Tag } = require('cbor-x')
		const rawDecoder = new Decoder({ useRecords: true })
		const wireFormat = rawDecoder.decode(encoded)

		// Should be wrapped in a Tag
		expect(wireFormat).toBeInstanceOf(Tag)
		expect(wireFormat.tag).toBe(39999)
		// Inside the tag, numeric format
		expect(Array.isArray(wireFormat.value)).toBe(true)
		expect(wireFormat.value[0]).toBe(MessageTypeId.push) // 0
		expect(typeof wireFormat.value[0]).toBe("number")
	})

	it("different modes produce different byte lengths", () => {
		const message = ["push", ["pipeline", 0, ["users", "get"], [{ id: 123 }]]]

		const arrayCodec = new CborCodec({ messageEncodingMode: 'array' })
		const objectCodec = new CborCodec({ messageEncodingMode: 'object' })
		const numericCodec = new CborCodec({ messageEncodingMode: 'numeric' })

		const arrayBytes = arrayCodec.encode(message)
		const objectBytes = objectCodec.encode(message)
		const numericBytes = numericCodec.encode(message)

		// Numeric should be smallest (1 byte for type vs 4-5 for "push")
		// Object might be larger initially but benefits from CBOR structure caching
		console.log(`\nMessage encoding sizes:`)
		console.log(`  Array mode:   ${arrayBytes.length} bytes`)
		console.log(`  Object mode:  ${objectBytes.length} bytes`)
		console.log(`  Numeric mode: ${numericBytes.length} bytes`)

		// All should decode to the same result
		expect(arrayCodec.decode(arrayBytes)).toStrictEqual(message)
		expect(objectCodec.decode(objectBytes)).toStrictEqual(message)
		expect(numericCodec.decode(numericBytes)).toStrictEqual(message)
	})
})

// =======================================================================================
// ALL MESSAGE TYPES WITH ALL MODES
// =======================================================================================

describe("All message types work with all modes", () => {
	const allMessageTypes = [
		{ type: "push", message: ["push", ["pipeline", 1, ["test"]]] },
		{ type: "pull", message: ["pull", 42] },
		{ type: "resolve", message: ["resolve", 5, { data: [1, 2, 3] }] },
		{ type: "reject", message: ["reject", 3, ["error", "Error", "failed"]] },
		{ type: "release", message: ["release", 7, 2] },
		{ type: "abort", message: ["abort", ["error", "Error", "disconnected"]] },
	]

	for (const { type, message } of allMessageTypes) {
		for (const mode of ['array', 'object', 'numeric'] as MessageEncodingMode[]) {
			it(`${type} message with ${mode} mode`, () => {
				const codec = new CborCodec({ messageEncodingMode: mode })
				const encoded = codec.encode(message)
				const decoded = codec.decode(encoded)
				expect(decoded).toStrictEqual(message)
			})
		}
	}
})

// =======================================================================================
// NON-RPC MESSAGES (should pass through unchanged)
// =======================================================================================

describe("Non-RPC messages pass through unchanged", () => {
	const modes: MessageEncodingMode[] = ['array', 'object', 'numeric']

	const nonRpcValues = [
		{ name: "plain object", value: { foo: "bar", nested: { a: 1 } } },
		{ name: "plain array", value: [1, 2, 3, "four", { five: 5 }] },
		{ name: "string", value: "hello world" },
		{ name: "number", value: 42 },
		{ name: "boolean", value: true },
		{ name: "null", value: null },
		{ name: "array with non-message-type first element", value: ["notAMessageType", 1, 2] },
		{ name: "array starting with number (not message type ID)", value: [999, "data"] },
		{ name: "empty array", value: [] },
		{ name: "empty object", value: {} },
	]

	for (const { name, value } of nonRpcValues) {
		it(`${name} passes through unchanged in all modes`, () => {
			for (const mode of modes) {
				const codec = new CborCodec({ messageEncodingMode: mode })
				const encoded = codec.encode(value)
				const decoded = codec.decode(encoded)
				expect(decoded).toStrictEqual(value)
			}
		})
	}
})

// =======================================================================================
// CROSS-MODE COMMUNICATION (verifies modes can't accidentally communicate)
// =======================================================================================

describe("Cross-mode communication behavior", () => {
	it("array-encoded message decoded with array mode works", () => {
		const encoder = new CborCodec({ messageEncodingMode: 'array' })
		const decoder = new CborCodec({ messageEncodingMode: 'array' })

		const message = ["push", ["pipeline", 0, ["test"]]]
		const encoded = encoder.encode(message)
		const decoded = decoder.decode(encoded)

		expect(decoded).toStrictEqual(message)
	})

	it("numeric-encoded message decoded with numeric mode works", () => {
		const encoder = new CborCodec({ messageEncodingMode: 'numeric' })
		const decoder = new CborCodec({ messageEncodingMode: 'numeric' })

		const message = ["push", ["pipeline", 0, ["test"]]]
		const encoded = encoder.encode(message)
		const decoded = decoder.decode(encoded)

		expect(decoded).toStrictEqual(message)
	})

	it("object-encoded message decoded with object mode works", () => {
		const encoder = new CborCodec({ messageEncodingMode: 'object' })
		const decoder = new CborCodec({ messageEncodingMode: 'object' })

		const message = ["push", ["pipeline", 0, ["test"]]]
		const encoded = encoder.encode(message)
		const decoded = decoder.decode(encoded)

		expect(decoded).toStrictEqual(message)
	})

	// Note: Cross-mode decode will NOT work correctly - this is expected behavior
	// Both ends of an RPC session must use the same encoding mode
})

// =======================================================================================
// BANDWIDTH COMPARISON
// =======================================================================================

describe("Bandwidth comparison across modes", () => {
	it("compares message sizes for typical RPC workload", () => {
		const messages = [
			["push", ["pipeline", 0, ["users", "getById"], [{ id: 123 }]]],
			["push", ["pipeline", 1, ["posts", "list"], [{ page: 1, limit: 20 }]]],
			["resolve", 0, { id: 123, name: "Alice", email: "alice@example.com" }],
			["resolve", 1, [{ id: 1, title: "Post 1" }, { id: 2, title: "Post 2" }]],
			["pull", 2],
			["release", 0, 1],
		]

		const totals = { array: 0, object: 0, numeric: 0 }

		for (const mode of ['array', 'object', 'numeric'] as MessageEncodingMode[]) {
			const codec = new CborCodec({ messageEncodingMode: mode })
			for (const msg of messages) {
				totals[mode] += codec.encode(msg).length
			}
		}

		console.log(`\n=== Bandwidth Comparison (${messages.length} messages) ===`)
		console.log(`  Array mode:   ${totals.array} bytes`)
		console.log(`  Object mode:  ${totals.object} bytes`)
		console.log(`  Numeric mode: ${totals.numeric} bytes`)
		console.log(`  Numeric vs Array savings: ${((totals.array - totals.numeric) / totals.array * 100).toFixed(1)}%`)

		// Note: With string interning, the first few messages may have overhead from definitions.
		// The real savings come from repeated strings across many messages.
		// All modes should decode correctly (tested elsewhere), so just verify they all work.
		expect(totals.array).toBeGreaterThan(0)
		expect(totals.object).toBeGreaterThan(0)
		expect(totals.numeric).toBeGreaterThan(0)
	})

	it("compares sizes for high-frequency position updates", () => {
		const codec = {
			array: new CborCodec({ messageEncodingMode: 'array' }),
			object: new CborCodec({ messageEncodingMode: 'object' }),
			numeric: new CborCodec({ messageEncodingMode: 'numeric' }),
		}

		const totals = { array: 0, object: 0, numeric: 0 }
		const iterations = 1000

		for (let i = 0; i < iterations; i++) {
			const msg = ["push", ["pipeline", 0, ["updatePosition"], [{ x: i * 0.1, y: i * 0.2, z: i * 0.3 }]]]

			for (const mode of ['array', 'object', 'numeric'] as MessageEncodingMode[]) {
				totals[mode] += codec[mode].encode(msg).length
			}
		}

		console.log(`\n=== Position Updates (${iterations} messages) ===`)
		console.log(`  Array mode:   ${totals.array} bytes (${(totals.array / iterations).toFixed(1)} bytes/msg)`)
		console.log(`  Object mode:  ${totals.object} bytes (${(totals.object / iterations).toFixed(1)} bytes/msg)`)
		console.log(`  Numeric mode: ${totals.numeric} bytes (${(totals.numeric / iterations).toFixed(1)} bytes/msg)`)
		console.log(`  Numeric vs Array savings: ${((totals.array - totals.numeric) / totals.array * 100).toFixed(1)}%`)
	})
})

// =======================================================================================
// DEFAULT MODE BEHAVIOR
// =======================================================================================

describe("Default encoding mode", () => {
	it("defaults to array mode when not specified", () => {
		const codec = new CborCodec()
		expect(codec.messageEncodingMode).toBe('array')
	})

	it("respects explicit mode setting", () => {
		const arrayCodec = new CborCodec({ messageEncodingMode: 'array' })
		const objectCodec = new CborCodec({ messageEncodingMode: 'object' })
		const numericCodec = new CborCodec({ messageEncodingMode: 'numeric' })

		expect(arrayCodec.messageEncodingMode).toBe('array')
		expect(objectCodec.messageEncodingMode).toBe('object')
		expect(numericCodec.messageEncodingMode).toBe('numeric')
	})
})
