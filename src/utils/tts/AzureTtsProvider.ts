import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions, TtsProviderError } from "./types"

/**
 * Microsoft Azure Text-to-Speech Provider
 * Requires microsoft-cognitiveservices-speech-sdk package
 */
export class AzureTtsProvider implements TtsProvider {
	readonly type: TtsProviderType = "azure"
	private speechConfig: any = undefined
	private synthesizer: any = undefined
	private cachedVoices: TtsVoice[] = []
	private apiKey: string | undefined
	private region: string | undefined
	private isPlaying: boolean = false

	constructor(apiKey?: string, region?: string) {
		this.apiKey = apiKey
		this.region = region
	}

	/**
	 * Set or update the API key and region
	 */
	setCredentials(apiKey: string, region: string): void {
		this.apiKey = apiKey
		this.region = region
		this.speechConfig = undefined // Reset config to force re-initialization
		this.synthesizer = undefined
		this.cachedVoices = [] // Clear cached voices
	}

	async isConfigured(): Promise<boolean> {
		return !!(this.apiKey && this.region)
	}

	private async getSpeechConfig(): Promise<any> {
		if (!this.apiKey || !this.region) {
			throw this.createError("MISSING_CREDENTIALS", "Azure Speech API key and region are required")
		}

		if (this.speechConfig) {
			return this.speechConfig
		}

		try {
			const sdk = require("microsoft-cognitiveservices-speech-sdk")

			this.speechConfig = sdk.SpeechConfig.fromSubscription(this.apiKey, this.region)
			this.speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3

			return this.speechConfig
		} catch (error: any) {
			if (error.code === "MODULE_NOT_FOUND") {
				throw this.createError(
					"SDK_NOT_INSTALLED",
					"Azure Speech SDK is not installed. Please install microsoft-cognitiveservices-speech-sdk",
				)
			}
			throw this.createError("CONFIG_INIT_ERROR", error?.message || "Failed to initialize Azure Speech config")
		}
	}

	async getVoices(): Promise<TtsVoice[]> {
		// Return cached voices if available
		if (this.cachedVoices.length > 0) {
			return this.cachedVoices
		}

		try {
			const sdk = require("microsoft-cognitiveservices-speech-sdk")
			const speechConfig = await this.getSpeechConfig()

			// Create a synthesizer to list voices
			const synthesizer = new sdk.SpeechSynthesizer(speechConfig)

			return new Promise((resolve, reject) => {
				synthesizer.getVoicesAsync(
					(result: any) => {
						if (result.reason === sdk.ResultReason.VoicesListRetrieved) {
							this.cachedVoices = result.voices.map((voice: any) => ({
								id: voice.shortName,
								name: `${voice.localName} (${voice.locale})`,
								language: voice.locale,
								gender: this.mapGender(voice.gender),
								provider: "azure" as TtsProviderType,
							}))
							synthesizer.close()
							resolve(this.cachedVoices)
						} else {
							synthesizer.close()
							reject(this.createError("VOICE_LIST_ERROR", "Failed to retrieve voices from Azure Speech"))
						}
					},
					(error: any) => {
						synthesizer.close()
						reject(
							this.createError(
								"VOICE_LIST_ERROR",
								error?.message || "Failed to retrieve voices from Azure Speech",
							),
						)
					},
				)
			})
		} catch (error: any) {
			if (error.provider === "azure") {
				throw error // Already a TtsProviderError
			}
			throw this.createError("VOICE_LIST_ERROR", error?.message || "Failed to retrieve voices from Azure Speech")
		}
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		if (this.isPlaying) {
			throw this.createError("ALREADY_PLAYING", "Azure TTS is already playing audio")
		}

		try {
			const sdk = require("microsoft-cognitiveservices-speech-sdk")
			const speechConfig = await this.getSpeechConfig()

			// Set voice if specified
			if (options.voice) {
				speechConfig.speechSynthesisVoiceName = options.voice
			}

			// Create audio config for speaker output
			const audioConfig = sdk.AudioConfig.fromDefaultSpeakerOutput()
			this.synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig)

			this.isPlaying = true
			options.onStart?.()

			// Build SSML if speed is specified
			let ssml: string
			if (options.speed && options.speed !== 1.0) {
				const rate = this.speedToRate(options.speed)
				const voiceName = options.voice || "en-US-AriaNeural"
				ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
					<voice name="${voiceName}">
						<prosody rate="${rate}">${this.escapeXml(text)}</prosody>
					</voice>
				</speak>`
			} else {
				ssml = text
			}

			return new Promise((resolve, reject) => {
				// Use SSML if we have it, otherwise use plain text
				const speakMethod =
					options.speed && options.speed !== 1.0
						? this.synthesizer.speakSsmlAsync.bind(this.synthesizer)
						: this.synthesizer.speakTextAsync.bind(this.synthesizer)

				speakMethod(
					ssml,
					(result: any) => {
						this.isPlaying = false
						options.onStop?.()

						if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
							this.synthesizer.close()
							this.synthesizer = undefined
							resolve()
						} else {
							const errorDetails = result.errorDetails || "Unknown error"
							this.synthesizer.close()
							this.synthesizer = undefined
							reject(this.createError("SYNTHESIS_ERROR", errorDetails))
						}
					},
					(error: any) => {
						this.isPlaying = false
						options.onStop?.()

						if (this.synthesizer) {
							this.synthesizer.close()
							this.synthesizer = undefined
						}
						reject(
							this.createError(
								"SYNTHESIS_ERROR",
								error?.message || "Failed to synthesize speech with Azure",
							),
						)
					},
				)
			})
		} catch (error: any) {
			this.isPlaying = false
			options.onStop?.()

			if (error.provider === "azure") {
				throw error // Already a TtsProviderError
			}

			throw this.createError("SYNTHESIS_ERROR", error?.message || "Failed to synthesize speech")
		}
	}

	stop(): void {
		if (this.synthesizer) {
			try {
				this.synthesizer.close()
			} catch (error) {
				// Ignore errors when stopping
			}
			this.synthesizer = undefined
		}
		this.isPlaying = false
	}

	async validateConfiguration(): Promise<void> {
		if (!this.apiKey || !this.region) {
			throw this.createError("MISSING_CREDENTIALS", "Azure Speech API key and region are required")
		}

		try {
			// Try to get voices to validate the credentials
			await this.getVoices()
		} catch (error: any) {
			if (error.code === "MISSING_CREDENTIALS" || error.code === "SDK_NOT_INSTALLED") {
				throw error
			}

			// Check for authentication errors
			if (
				error?.message?.includes("authentication") ||
				error?.message?.includes("Unauthorized") ||
				error?.message?.includes("401")
			) {
				throw this.createError("INVALID_CREDENTIALS", "Invalid Azure Speech API key or region")
			}

			throw this.createError("VALIDATION_ERROR", error?.message || "Failed to validate Azure configuration")
		}
	}

	/**
	 * Map Azure gender enum to our gender type
	 */
	private mapGender(gender: number): "male" | "female" | "neutral" | undefined {
		// Azure uses: 1 = Female, 2 = Male
		switch (gender) {
			case 1:
				return "female"
			case 2:
				return "male"
			default:
				return "neutral"
		}
	}

	/**
	 * Convert speed multiplier to Azure prosody rate
	 * Speed 1.0 = 0%, 0.5 = -50%, 2.0 = +100%
	 */
	private speedToRate(speed: number): string {
		const percent = Math.round((speed - 1.0) * 100)
		return percent >= 0 ? `+${percent}%` : `${percent}%`
	}

	/**
	 * Escape XML special characters for SSML
	 */
	private escapeXml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;")
	}

	/**
	 * Create a standardized error object
	 */
	private createError(code: string, message: string): TtsProviderError {
		return {
			code,
			message,
			provider: "azure",
		}
	}
}
