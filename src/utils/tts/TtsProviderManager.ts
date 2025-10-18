import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions } from "./types"
import { NativeTtsProvider } from "./NativeTtsProvider"
import { GoogleCloudTtsProvider } from "./GoogleCloudTtsProvider"
import { AzureTtsProvider } from "./AzureTtsProvider"

export interface TtsCredentials {
	googleCloudApiKey?: string
	azureApiKey?: string
	azureRegion?: string
}

/**
 * Manages multiple TTS providers and coordinates between them
 */
export class TtsProviderManager {
	private providers: Map<TtsProviderType, TtsProvider>
	private activeProviderType: TtsProviderType = "native"
	private currentVoice: string | undefined
	private queue: Array<{ text: string; options: TtsSpeakOptions }> = []
	private isProcessing: boolean = false

	constructor(credentials?: TtsCredentials) {
		this.providers = new Map()

		// Always initialize native provider (no credentials required)
		this.providers.set("native", new NativeTtsProvider())

		// Initialize cloud providers if credentials are provided
		if (credentials?.googleCloudApiKey) {
			this.providers.set("google-cloud", new GoogleCloudTtsProvider(credentials.googleCloudApiKey))
		}

		if (credentials?.azureApiKey && credentials?.azureRegion) {
			this.providers.set("azure", new AzureTtsProvider(credentials.azureApiKey, credentials.azureRegion))
		}
	}

	/**
	 * Update credentials for a specific provider
	 */
	async updateCredentials(providerType: TtsProviderType, credentials: TtsCredentials): Promise<void> {
		console.log(`[TTS] updateCredentials called for provider: ${providerType}`)
		console.log(`[TTS] Credentials provided:`, {
			hasGoogleCloudApiKey: !!credentials.googleCloudApiKey,
			hasAzureApiKey: !!credentials.azureApiKey,
			hasAzureRegion: !!credentials.azureRegion,
		})

		switch (providerType) {
			case "google-cloud": {
				if (credentials.googleCloudApiKey) {
					let provider = this.providers.get("google-cloud") as GoogleCloudTtsProvider | undefined
					if (!provider) {
						console.log(`[TTS] Creating new GoogleCloudTtsProvider instance`)
						provider = new GoogleCloudTtsProvider(credentials.googleCloudApiKey)
						this.providers.set("google-cloud", provider)
						console.log(`[TTS] GoogleCloudTtsProvider added to providers map`)
					} else {
						console.log(`[TTS] Updating existing GoogleCloudTtsProvider with new API key`)
						provider.setApiKey(credentials.googleCloudApiKey)
					}
				} else {
					console.warn(`[TTS] No Google Cloud API key provided in credentials`)
				}
				break
			}
			case "azure": {
				if (credentials.azureApiKey && credentials.azureRegion) {
					let provider = this.providers.get("azure") as AzureTtsProvider | undefined
					if (!provider) {
						provider = new AzureTtsProvider(credentials.azureApiKey, credentials.azureRegion)
						this.providers.set("azure", provider)
					} else {
						provider.setCredentials(credentials.azureApiKey, credentials.azureRegion)
					}
				}
				break
			}
			case "native":
				// Native provider doesn't need credentials
				break
		}
	}

	/**
	 * Remove credentials and provider for a specific type
	 */
	removeProvider(providerType: TtsProviderType): void {
		if (providerType !== "native") {
			// Always keep native provider
			this.providers.delete(providerType)

			// Switch to native if we're removing the active provider
			if (this.activeProviderType === providerType) {
				this.activeProviderType = "native"
			}
		}
	}

	/**
	 * Set the active provider
	 */
	async setActiveProvider(providerType: TtsProviderType): Promise<void> {
		console.log(`[TTS] setActiveProvider called with: ${providerType}`)
		console.log(`[TTS] Current active provider: ${this.activeProviderType}`)
		console.log(`[TTS] Available providers:`, Array.from(this.providers.keys()))

		const provider = this.providers.get(providerType)

		if (!provider) {
			console.error(`[TTS] Provider ${providerType} is not configured in providers map`)
			throw new Error(`Provider ${providerType} is not configured`)
		}

		console.log(`[TTS] Provider ${providerType} found, checking configuration...`)
		const isConfigured = await provider.isConfigured()
		console.log(`[TTS] Provider ${providerType} isConfigured: ${isConfigured}`)

		if (!isConfigured) {
			console.error(`[TTS] Provider ${providerType} is not properly configured`)
			throw new Error(`Provider ${providerType} is not properly configured`)
		}

		this.activeProviderType = providerType
		console.log(`[TTS] Successfully set active provider to: ${providerType}`)
	}

	/**
	 * Get the active provider
	 */
	getActiveProvider(): TtsProvider {
		console.log(`[TTS] getActiveProvider called, activeProviderType: ${this.activeProviderType}`)
		const provider = this.providers.get(this.activeProviderType)
		if (!provider) {
			// Fallback to native if active provider is not available
			console.warn(
				`[TTS] Active provider ${this.activeProviderType} not found in providers map, falling back to native`,
			)
			console.log(`[TTS] Available providers:`, Array.from(this.providers.keys()))
			this.activeProviderType = "native"
			return this.providers.get("native")!
		}
		console.log(`[TTS] Returning provider: ${provider.type}`)
		return provider
	}

	/**
	 * Get the active provider type
	 */
	getActiveProviderType(): TtsProviderType {
		return this.activeProviderType
	}

	/**
	 * Get all available providers
	 */
	getAvailableProviders(): TtsProviderType[] {
		return Array.from(this.providers.keys())
	}

	/**
	 * Check if a provider is configured
	 */
	async isProviderConfigured(providerType: TtsProviderType): Promise<boolean> {
		const provider = this.providers.get(providerType)
		if (!provider) {
			return false
		}
		return provider.isConfigured()
	}

	/**
	 * Get voices from the active provider
	 */
	async getVoices(): Promise<TtsVoice[]> {
		const provider = this.getActiveProvider()
		return provider.getVoices()
	}

	/**
	 * Get voices from a specific provider
	 */
	async getVoicesForProvider(providerType: TtsProviderType): Promise<TtsVoice[]> {
		const provider = this.providers.get(providerType)
		if (!provider) {
			throw new Error(`Provider ${providerType} is not configured`)
		}

		const isConfigured = await provider.isConfigured()
		if (!isConfigured) {
			throw new Error(`Provider ${providerType} is not properly configured`)
		}

		return provider.getVoices()
	}

	/**
	 * Set the current voice
	 */
	setVoice(voiceId: string): void {
		this.currentVoice = voiceId
	}

	/**
	 * Get the current voice
	 */
	getVoice(): string | undefined {
		return this.currentVoice
	}

	/**
	 * Add text to the speech queue
	 */
	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		// Add voice if not specified in options
		if (!options.voice && this.currentVoice) {
			options.voice = this.currentVoice
		}

		this.queue.push({ text, options })
		await this.processQueue()
	}

	/**
	 * Stop current speech and clear queue
	 */
	stop(): void {
		// Stop current provider
		const provider = this.getActiveProvider()
		provider.stop()

		// Clear the queue
		this.queue = []
		this.isProcessing = false
	}

	/**
	 * Validate a provider's configuration
	 */
	async validateProvider(providerType: TtsProviderType): Promise<void> {
		const provider = this.providers.get(providerType)
		if (!provider) {
			throw new Error(`Provider ${providerType} is not configured`)
		}
		await provider.validateConfiguration()
	}

	/**
	 * Process the speech queue
	 */
	private async processQueue(): Promise<void> {
		if (this.isProcessing || this.queue.length === 0) {
			return
		}

		this.isProcessing = true
		console.log(`[TTS] Processing queue with ${this.queue.length} items`)

		try {
			while (this.queue.length > 0) {
				const item = this.queue.shift()
				if (!item) break

				console.log(
					`[TTS] Processing queue item, text length: ${item.text.length}, voice: ${item.options.voice || "default"}`,
				)
				const provider = this.getActiveProvider()
				console.log(`[TTS] Using provider: ${provider.type}`)

				try {
					await provider.speak(item.text, item.options)
					console.log(`[TTS] Successfully spoke using ${provider.type}`)
				} catch (error: any) {
					console.error(`[TTS] Playback error with ${provider.type}:`, error)
					console.error(`[TTS] Error details:`, {
						code: error.code,
						message: error.message,
						provider: error.provider,
					})

					// If the active provider fails and it's not native, try falling back to native
					if (this.activeProviderType !== "native") {
						console.warn(`[TTS] Falling back to native TTS provider due to ${provider.type} failure`)
						const nativeProvider = this.providers.get("native")
						if (nativeProvider) {
							try {
								await nativeProvider.speak(item.text, item.options)
								console.log(`[TTS] Successfully spoke using native fallback`)
							} catch (fallbackError) {
								console.error("[TTS] Native TTS fallback also failed:", fallbackError)
							}
						} else {
							console.error("[TTS] Native provider not available for fallback")
						}
					}
				}
			}
		} finally {
			this.isProcessing = false
			console.log(`[TTS] Queue processing complete`)
		}
	}
}
