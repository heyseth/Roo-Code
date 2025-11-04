/**
 * TTS Cost Tracking for Google Cloud and Microsoft Azure
 *
 * Google Cloud Pricing (2025): https://cloud.google.com/text-to-speech/pricing
 * Azure Pricing (2025): https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
 */

export type GoogleCloudTtsModelType =
	| "wavenet" // WaveNet voices
	| "studio" // Studio voices
	| "standard" // Standard voices
	| "neural2" // Neural2 voices
	| "polyglot" // Polyglot voices
	| "chirp3Hd" // Chirp 3: HD voices
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
	wavenet: 0.000004, // $4 per 1M characters
	studio: 0.00016, // $160 per 1M characters
	standard: 0.000004, // $4 per 1M characters
	neural2: 0.000016, // $16 per 1M characters
	polyglot: 0.000016, // $16 per 1M characters
	chirp3Hd: 0.00003, // $30 per 1M characters
	instantCustom: 0.00006, // $60 per 1M characters
}

// Free tier limits (characters per month)
const FREE_TIER: Record<GoogleCloudTtsModelType, number> = {
	wavenet: 4_000_000, // 4 million characters
	studio: 1_000_000, // 1 million characters
	standard: 4_000_000, // 4 million characters
	neural2: 1_000_000, // 1 million characters
	polyglot: 1_000_000, // 1 million characters
	chirp3Hd: 1_000_000, // 1 million characters
	instantCustom: 0, // No free tier
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
	currentUsage: number,
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
	charactersUsed: number,
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

// ============================================================================
// Azure Text-to-Speech Cost Tracking
// ============================================================================

/**
 * Azure TTS pricing tiers
 */
export type AzureTtsTier = "F0" | "S0"

/**
 * Azure TTS voice types (all voices are neural in modern Azure TTS)
 */
export type AzureTtsVoiceType = "neural" | "neuralHd" | "custom"

export interface AzureTtsUsage {
	lastResetDate: string // YYYY-MM format
	tier: AzureTtsTier
	charactersUsed: number // Total characters used this month
}

export interface AzureTtsCostDetails {
	voiceType: AzureTtsVoiceType
	charactersUsed: number
	charactersCostFree: number // Characters covered by free tier (F0 only)
	charactersCostPaid: number // Characters that incurred cost
	cost: number // Total cost in USD
}

// Pricing constants for S0 tier (USD per character)
const AZURE_PRICING: Record<AzureTtsVoiceType, number> = {
	neural: 0.000015, // $15 per 1M characters
	neuralHd: 0.00003, // $30 per 1M characters (estimated, HD voices cost more)
	custom: 0.000024, // $24 per 1M characters
}

// Free tier limit for F0 (characters per month)
const AZURE_F0_FREE_LIMIT = 500_000 // 0.5 million characters

/**
 * Detect the voice type from an Azure TTS voice name.
 * Voice names follow patterns like: "en-US-AriaNeural", "en-US-JennyMultilingualV2Neural", etc.
 */
export function detectAzureVoiceType(voiceName: string): AzureTtsVoiceType {
	const lowerVoice = voiceName.toLowerCase()

	// Check for HD voices
	if (lowerVoice.includes("hd") || lowerVoice.includes("multilingual")) {
		return "neuralHd"
	}

	// Check for custom voices
	if (lowerVoice.includes("custom")) {
		return "custom"
	}

	// Default to standard neural
	return "neural"
}

/**
 * Initialize a new Azure usage tracking object for the current month.
 */
export function initializeAzureUsageTracking(tier: AzureTtsTier): AzureTtsUsage {
	const now = new Date()
	const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

	return {
		lastResetDate: yearMonth,
		tier,
		charactersUsed: 0,
	}
}

/**
 * Check if Azure usage tracking needs to be reset (new month started).
 */
export function shouldResetAzureUsage(usage: AzureTtsUsage | undefined): boolean {
	if (!usage) {
		return true
	}

	const now = new Date()
	const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`

	return usage.lastResetDate !== currentYearMonth
}

/**
 * Calculate the cost for Azure TTS usage.
 *
 * F0 Tier: First 0.5M characters free, then usage stops (no billing)
 * S0 Tier: All characters billed from the start (no free tier)
 *
 * @param tier - The Azure pricing tier (F0 or S0)
 * @param voiceType - The type of voice being used
 * @param charactersUsed - Number of characters to synthesize
 * @param currentUsage - Current usage for this month
 * @returns Cost details including free and paid character counts
 */
export function calculateAzureTtsCost(
	tier: AzureTtsTier,
	voiceType: AzureTtsVoiceType,
	charactersUsed: number,
	currentUsage: number,
): AzureTtsCostDetails {
	const pricePerCharacter = AZURE_PRICING[voiceType]

	if (tier === "F0") {
		// F0 tier: 0.5M characters free, then usage stops
		const remainingFreeTier = Math.max(0, AZURE_F0_FREE_LIMIT - currentUsage)
		const charactersCostFree = Math.min(charactersUsed, remainingFreeTier)

		return {
			voiceType,
			charactersUsed,
			charactersCostFree,
			charactersCostPaid: 0, // F0 never incurs costs
			cost: 0,
		}
	} else {
		// S0 tier: All characters are billed
		return {
			voiceType,
			charactersUsed,
			charactersCostFree: 0,
			charactersCostPaid: charactersUsed,
			cost: charactersUsed * pricePerCharacter,
		}
	}
}

/**
 * Update Azure usage tracking after a TTS synthesis operation.
 *
 * @param usage - Current usage tracking object (or undefined to create new)
 * @param tier - The Azure pricing tier
 * @param charactersUsed - Number of characters synthesized
 * @returns Updated usage tracking object
 */
export function updateAzureTtsUsage(
	usage: AzureTtsUsage | undefined,
	tier: AzureTtsTier,
	charactersUsed: number,
): AzureTtsUsage {
	// Reset or initialize if needed
	let currentUsage: AzureTtsUsage = usage ?? initializeAzureUsageTracking(tier)
	if (shouldResetAzureUsage(usage)) {
		currentUsage = initializeAzureUsageTracking(tier)
	}

	// Update tier if it changed
	if (currentUsage.tier !== tier) {
		currentUsage = initializeAzureUsageTracking(tier)
	}

	// Update the usage
	const updatedUsage: AzureTtsUsage = {
		...currentUsage,
		charactersUsed: currentUsage.charactersUsed + charactersUsed,
	}

	return updatedUsage
}
