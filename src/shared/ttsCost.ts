/**
 * Google Cloud TTS Cost Tracking
 *
 * Pricing as of 2025 (per Google Cloud TTS documentation):
 * https://cloud.google.com/text-to-speech/pricing
 */

export type GoogleCloudTtsModelType =
	| "wavenet"      // WaveNet voices
	| "studio"       // Studio voices
	| "standard"     // Standard voices
	| "neural2"      // Neural2 voices
	| "polyglot"     // Polyglot voices
	| "chirp3Hd"     // Chirp 3: HD voices
	| "instantCustom" // Instant custom voice

export interface GoogleCloudTtsUsage {
	lastResetDate: string // YYYY-MM format
	usage: {
		wavenet: number
		studio: number
		standard: number
		neural2: number
		polyglot: number
		chirp3Hd: number
		instantCustom: number
	}
}

export interface TtsCostDetails {
	modelType: GoogleCloudTtsModelType
	charactersUsed: number
	charactersCostFree: number // Characters covered by free tier
	charactersCostPaid: number // Characters that incurred cost
	cost: number // Total cost in USD
}

// Pricing constants (USD per character)
const PRICING: Record<GoogleCloudTtsModelType, number> = {
	wavenet: 0.000004,       // $4 per 1M characters
	studio: 0.00016,         // $160 per 1M characters
	standard: 0.000004,      // $4 per 1M characters
	neural2: 0.000016,       // $16 per 1M characters
	polyglot: 0.000016,      // $16 per 1M characters
	chirp3Hd: 0.00003,       // $30 per 1M characters
	instantCustom: 0.00006,  // $60 per 1M characters
}

// Free tier limits (characters per month)
const FREE_TIER: Record<GoogleCloudTtsModelType, number> = {
	wavenet: 4_000_000,      // 4 million characters
	studio: 1_000_000,       // 1 million characters
	standard: 4_000_000,     // 4 million characters
	neural2: 1_000_000,      // 1 million characters
	polyglot: 1_000_000,     // 1 million characters
	chirp3Hd: 1_000_000,     // 1 million characters
	instantCustom: 0,        // No free tier
}

/**
 * Detect the model type from a Google Cloud TTS voice name.
 * Voice names follow patterns like: "en-US-Chirp3-HD-Achernar", "en-US-WaveNet-A", etc.
 */
export function detectModelTypeFromVoiceName(voiceName: string): GoogleCloudTtsModelType {
	const lowerVoice = voiceName.toLowerCase()

	// Check for each model type pattern
	if (lowerVoice.includes("chirp3-hd") || lowerVoice.includes("chirp3hd")) {
		return "chirp3Hd"
	}
	if (lowerVoice.includes("wavenet")) {
		return "wavenet"
	}
	if (lowerVoice.includes("studio")) {
		return "studio"
	}
	if (lowerVoice.includes("neural2")) {
		return "neural2"
	}
	if (lowerVoice.includes("polyglot")) {
		return "polyglot"
	}
	if (lowerVoice.includes("custom")) {
		return "instantCustom"
	}

	// Default to standard if no specific pattern matches
	return "standard"
}

/**
 * Initialize a new usage tracking object for the current month.
 */
export function initializeUsageTracking(): GoogleCloudTtsUsage {
	const now = new Date()
	const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

	return {
		lastResetDate: yearMonth,
		usage: {
			wavenet: 0,
			studio: 0,
			standard: 0,
			neural2: 0,
			polyglot: 0,
			chirp3Hd: 0,
			instantCustom: 0,
		},
	}
}

/**
 * Check if usage tracking needs to be reset (new month started).
 */
export function shouldResetUsage(usage: GoogleCloudTtsUsage | undefined): boolean {
	if (!usage) {
		return true
	}

	const now = new Date()
	const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

	return usage.lastResetDate !== currentYearMonth
}

/**
 * Calculate the cost for using a specific number of characters with a given model.
 * Takes into account the free tier and current usage.
 *
 * @param modelType - The type of TTS model being used
 * @param charactersUsed - Number of characters to synthesize
 * @param currentUsage - Current usage for this model type this month
 * @returns Cost details including free and paid character counts
 */
export function calculateTtsCost(
	modelType: GoogleCloudTtsModelType,
	charactersUsed: number,
	currentUsage: number
): TtsCostDetails {
	const freeTierLimit = FREE_TIER[modelType]
	const pricePerCharacter = PRICING[modelType]

	// Calculate how many characters are still covered by free tier
	const remainingFreeTier = Math.max(0, freeTierLimit - currentUsage)

	// Split characters between free and paid
	const charactersCostFree = Math.min(charactersUsed, remainingFreeTier)
	const charactersCostPaid = Math.max(0, charactersUsed - charactersCostFree)

	// Calculate cost (only for paid characters)
	const cost = charactersCostPaid * pricePerCharacter

	return {
		modelType,
		charactersUsed,
		charactersCostFree,
		charactersCostPaid,
		cost,
	}
}

/**
 * Update usage tracking after a TTS synthesis operation.
 *
 * @param usage - Current usage tracking object (or undefined to create new)
 * @param modelType - The model type that was used
 * @param charactersUsed - Number of characters synthesized
 * @returns Updated usage tracking object
 */
export function updateTtsUsage(
	usage: GoogleCloudTtsUsage | undefined,
	modelType: GoogleCloudTtsModelType,
	charactersUsed: number
): GoogleCloudTtsUsage {
	// Reset or initialize if needed
	let currentUsage: GoogleCloudTtsUsage = usage ?? initializeUsageTracking()
	if (shouldResetUsage(usage)) {
		currentUsage = initializeUsageTracking()
	}

	// Update the usage for this model type
	const updatedUsage: GoogleCloudTtsUsage = {
		lastResetDate: currentUsage.lastResetDate,
		usage: { ...currentUsage.usage },
	}
	updatedUsage.usage[modelType] += charactersUsed

	return updatedUsage
}
