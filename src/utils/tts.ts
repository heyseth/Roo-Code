import { TtsProviderManager } from "./tts/TtsProviderManager"
import { TtsVoice, TtsProviderType, TtsCostDetails } from "./tts/types"

type PlayTtsOptions = {
	onStart?: () => void
	onStop?: () => void
	onCostIncurred?: (details: TtsCostDetails) => void
}

let isTtsEnabled = false
let ttsManager: TtsProviderManager | undefined = undefined

/**
 * Initialize the TTS provider manager with credentials
 */
export const initializeTtsManager = async (credentials?: {
	googleCloudApiKey?: string
	azureApiKey?: string
	azureRegion?: string
}): Promise<void> => {
	ttsManager = new TtsProviderManager(credentials)
}

/**
 * Get or create the TTS manager instance
 */
const getTtsManager = (): TtsProviderManager => {
	if (!ttsManager) {
		ttsManager = new TtsProviderManager()
	}
	return ttsManager
}

/**
 * Update credentials for a TTS provider
 */
export const updateTtsCredentials = async (
	providerType: TtsProviderType,
	credentials: {
		googleCloudApiKey?: string
		azureApiKey?: string
		azureRegion?: string
	},
): Promise<void> => {
	const manager = getTtsManager()
	await manager.updateCredentials(providerType, credentials)
}

/**
 * Set the active TTS provider
 */
export const setTtsProvider = async (providerType: TtsProviderType): Promise<void> => {
	const manager = getTtsManager()
	await manager.setActiveProvider(providerType)
}

/**
 * Get the current TTS provider type
 */
export const getTtsProvider = (): TtsProviderType => {
	const manager = getTtsManager()
	return manager.getActiveProviderType()
}

/**
 * Get available TTS voices
 */
export const getTtsVoices = async (): Promise<TtsVoice[]> => {
	const manager = getTtsManager()
	return manager.getVoices()
}

/**
 * Get voices for a specific provider
 */
export const getTtsVoicesForProvider = async (providerType: TtsProviderType): Promise<TtsVoice[]> => {
	const manager = getTtsManager()
	return manager.getVoicesForProvider(providerType)
}

/**
 * Set the current voice
 */
export const setTtsVoice = (voiceId: string): void => {
	const manager = getTtsManager()
	manager.setVoice(voiceId)
}

/**
 * Get the current voice
 */
export const getTtsVoice = (): string | undefined => {
	const manager = getTtsManager()
	return manager.getVoice()
}

/**
 * Validate a TTS provider configuration
 */
export const validateTtsProvider = async (providerType: TtsProviderType): Promise<void> => {
	const manager = getTtsManager()
	await manager.validateProvider(providerType)
}

/**
 * Check if a provider is configured
 */
export const isTtsProviderConfigured = async (providerType: TtsProviderType): Promise<boolean> => {
	const manager = getTtsManager()
	return manager.isProviderConfigured(providerType)
}

export const setTtsEnabled = (enabled: boolean) => (isTtsEnabled = enabled)

let speed = 1.0

export const setTtsSpeed = (newSpeed: number) => (speed = newSpeed)

export const playTts = async (message: string, options: PlayTtsOptions = {}) => {
	if (!isTtsEnabled) {
		return
	}

	try {
		const manager = getTtsManager()
		await manager.speak(message, {
			speed,
			...options,
		})
	} catch (error) {
		console.error("TTS playback error:", error)
	}
}

export const stopTts = () => {
	const manager = getTtsManager()
	manager.stop()
}
