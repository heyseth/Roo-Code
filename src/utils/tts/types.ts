/**
 * TTS Provider Types and Interfaces
 */

export type TtsProviderType = "native" | "google-cloud" | "azure"

export interface TtsVoice {
	id: string
	name: string
	language: string
	gender?: "male" | "female" | "neutral"
	provider: TtsProviderType
}

export interface TtsSpeakOptions {
	voice?: string
	speed?: number
	onStart?: () => void
	onStop?: () => void
}

export interface TtsProviderError {
	code: string
	message: string
	provider: TtsProviderType
}

/**
 * Base interface that all TTS providers must implement
 */
export interface TtsProvider {
	/**
	 * The type of this provider
	 */
	readonly type: TtsProviderType

	/**
	 * Whether this provider is currently configured and ready to use
	 */
	isConfigured(): Promise<boolean>

	/**
	 * Get available voices from this provider
	 */
	getVoices(): Promise<TtsVoice[]>

	/**
	 * Speak the given text using this provider
	 * @param text The text to speak
	 * @param options Speaking options (voice, speed, callbacks)
	 */
	speak(text: string, options?: TtsSpeakOptions): Promise<void>

	/**
	 * Stop current speech
	 */
	stop(): void

	/**
	 * Validate the provider configuration
	 * @throws TtsProviderError if configuration is invalid
	 */
	validateConfiguration(): Promise<void>
}
