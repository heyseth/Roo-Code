import { describe, it, expect } from "vitest"
import {
	detectModelTypeFromVoiceName,
	calculateTtsCost,
	updateTtsUsage,
	shouldResetUsage,
	initializeUsageTracking,
	type GoogleCloudTtsUsage,
} from "../ttsCost"

describe("ttsCost", () => {
	describe("detectModelTypeFromVoiceName", () => {
		it("should detect Chirp3-HD voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-Chirp3-HD-Achernar")).toBe("chirp3Hd")
			expect(detectModelTypeFromVoiceName("en-US-chirp3-hd-test")).toBe("chirp3Hd")
		})

		it("should detect WaveNet voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-WaveNet-A")).toBe("wavenet")
			expect(detectModelTypeFromVoiceName("en-US-Wavenet-B")).toBe("wavenet")
		})

		it("should detect Studio voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-Studio-M")).toBe("studio")
			expect(detectModelTypeFromVoiceName("fr-FR-Studio-A")).toBe("studio")
		})

		it("should detect Neural2 voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-Neural2-A")).toBe("neural2")
			expect(detectModelTypeFromVoiceName("ja-JP-Neural2-B")).toBe("neural2")
		})

		it("should detect Polyglot voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-Polyglot-1")).toBe("polyglot")
		})

		it("should detect custom voices", () => {
			expect(detectModelTypeFromVoiceName("en-US-Custom-Voice-A")).toBe("instantCustom")
		})

		it("should default to standard for unknown voice patterns", () => {
			expect(detectModelTypeFromVoiceName("en-US-Standard-A")).toBe("standard")
			expect(detectModelTypeFromVoiceName("en-US-Unknown-Voice")).toBe("standard")
		})
	})

	describe("calculateTtsCost", () => {
		it("should calculate cost with all characters in free tier", () => {
			const result = calculateTtsCost("wavenet", 1_000_000, 0)

			expect(result.charactersUsed).toBe(1_000_000)
			expect(result.charactersCostFree).toBe(1_000_000)
			expect(result.charactersCostPaid).toBe(0)
			expect(result.cost).toBe(0)
		})

		it("should calculate cost with all characters exceeding free tier", () => {
			const result = calculateTtsCost("wavenet", 1_000_000, 4_000_000)

			expect(result.charactersUsed).toBe(1_000_000)
			expect(result.charactersCostFree).toBe(0)
			expect(result.charactersCostPaid).toBe(1_000_000)
			expect(result.cost).toBe(4) // $4 per million characters
		})

		it("should calculate cost spanning free tier boundary", () => {
			const result = calculateTtsCost("wavenet", 2_000_000, 3_000_000)

			expect(result.charactersUsed).toBe(2_000_000)
			expect(result.charactersCostFree).toBe(1_000_000) // 1M remaining in free tier
			expect(result.charactersCostPaid).toBe(1_000_000) // 1M paid
			expect(result.cost).toBe(4) // $4 for 1M paid characters
		})

		it("should calculate cost for Studio voices (higher pricing)", () => {
			const result = calculateTtsCost("studio", 1_000_000, 1_000_000)

			expect(result.charactersCostPaid).toBe(1_000_000)
			expect(result.cost).toBe(160) // $160 per million characters
		})

		it("should calculate cost for Neural2 voices", () => {
			const result = calculateTtsCost("neural2", 500_000, 1_000_000)

			expect(result.charactersCostPaid).toBe(500_000)
			expect(result.cost).toBe(8) // $16 per million characters
		})

		it("should calculate cost for Chirp3-HD voices", () => {
			const result = calculateTtsCost("chirp3Hd", 1_000_000, 1_000_000)

			expect(result.charactersCostPaid).toBe(1_000_000)
			expect(result.cost).toBe(30) // $30 per million characters
		})

		it("should calculate cost for instant custom voices (no free tier)", () => {
			const result = calculateTtsCost("instantCustom", 500_000, 0)

			expect(result.charactersCostFree).toBe(0)
			expect(result.charactersCostPaid).toBe(500_000)
			expect(result.cost).toBe(30) // $60 per million characters
		})

		it("should handle zero characters", () => {
			const result = calculateTtsCost("wavenet", 0, 1_000_000)

			expect(result.cost).toBe(0)
		})
	})

	describe("initializeUsageTracking", () => {
		it("should initialize with current month and zero usage", () => {
			const usage = initializeUsageTracking()
			const now = new Date()
			const expectedYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

			expect(usage.lastResetDate).toBe(expectedYearMonth)
			expect(usage.usage.wavenet).toBe(0)
			expect(usage.usage.studio).toBe(0)
			expect(usage.usage.standard).toBe(0)
			expect(usage.usage.neural2).toBe(0)
			expect(usage.usage.polyglot).toBe(0)
			expect(usage.usage.chirp3Hd).toBe(0)
			expect(usage.usage.instantCustom).toBe(0)
		})
	})

	describe("shouldResetUsage", () => {
		it("should return true if usage is undefined", () => {
			expect(shouldResetUsage(undefined)).toBe(true)
		})

		it("should return false if usage is from current month", () => {
			const now = new Date()
			const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

			const usage: GoogleCloudTtsUsage = {
				lastResetDate: currentYearMonth,
				usage: {
					wavenet: 1000,
					studio: 500,
					standard: 2000,
					neural2: 800,
					polyglot: 0,
					chirp3Hd: 0,
					instantCustom: 0,
				},
			}

			expect(shouldResetUsage(usage)).toBe(false)
		})

		it("should return true if usage is from a previous month", () => {
			const usage: GoogleCloudTtsUsage = {
				lastResetDate: "2024-01",
				usage: {
					wavenet: 1000,
					studio: 500,
					standard: 2000,
					neural2: 800,
					polyglot: 0,
					chirp3Hd: 0,
					instantCustom: 0,
				},
			}

			expect(shouldResetUsage(usage)).toBe(true)
		})
	})

	describe("updateTtsUsage", () => {
		it("should initialize usage if undefined", () => {
			const updatedUsage = updateTtsUsage(undefined, "wavenet", 1_000_000)

			expect(updatedUsage.usage.wavenet).toBe(1_000_000)
			expect(updatedUsage.usage.studio).toBe(0)
		})

		it("should reset usage if month has changed", () => {
			const oldUsage: GoogleCloudTtsUsage = {
				lastResetDate: "2024-01",
				usage: {
					wavenet: 5_000_000,
					studio: 2_000_000,
					standard: 3_000_000,
					neural2: 1_500_000,
					polyglot: 500_000,
					chirp3Hd: 100_000,
					instantCustom: 50_000,
				},
			}

			const updatedUsage = updateTtsUsage(oldUsage, "wavenet", 500_000)

			// Should reset all other usage to 0 and only have new wavenet usage
			expect(updatedUsage.usage.wavenet).toBe(500_000)
			expect(updatedUsage.usage.studio).toBe(0)
			expect(updatedUsage.usage.standard).toBe(0)
		})

		it("should accumulate usage within the same month", () => {
			const now = new Date()
			const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

			const existingUsage: GoogleCloudTtsUsage = {
				lastResetDate: currentYearMonth,
				usage: {
					wavenet: 1_000_000,
					studio: 0,
					standard: 0,
					neural2: 0,
					polyglot: 0,
					chirp3Hd: 0,
					instantCustom: 0,
				},
			}

			const updatedUsage = updateTtsUsage(existingUsage, "wavenet", 500_000)

			expect(updatedUsage.usage.wavenet).toBe(1_500_000)
		})

		it("should update different model types independently", () => {
			const now = new Date()
			const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

			let usage: GoogleCloudTtsUsage = {
				lastResetDate: currentYearMonth,
				usage: {
					wavenet: 1_000_000,
					studio: 0,
					standard: 0,
					neural2: 0,
					polyglot: 0,
					chirp3Hd: 0,
					instantCustom: 0,
				},
			}

			usage = updateTtsUsage(usage, "studio", 500_000)
			usage = updateTtsUsage(usage, "neural2", 200_000)

			expect(usage.usage.wavenet).toBe(1_000_000)
			expect(usage.usage.studio).toBe(500_000)
			expect(usage.usage.neural2).toBe(200_000)
		})
	})
})
