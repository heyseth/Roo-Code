import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions, TtsProviderError } from "./types"

/**
 * Google Cloud Text-to-Speech Provider
 * Requires @google-cloud/text-to-speech package
 */
export class GoogleCloudTtsProvider implements TtsProvider {
	readonly type: TtsProviderType = "google-cloud"
	private client: any = undefined
	private cachedVoices: TtsVoice[] = []
	private currentAudio: any = undefined
	private apiKey: string | undefined

	constructor(apiKey?: string) {
		this.apiKey = apiKey
	}

	/**
	 * Set or update the API key
	 */
	setApiKey(apiKey: string): void {
		this.apiKey = apiKey
		this.client = undefined // Reset client to force re-initialization
		this.cachedVoices = [] // Clear cached voices
	}

	async isConfigured(): Promise<boolean> {
		return !!this.apiKey
	}

	private async getClient(): Promise<any> {
		if (!this.apiKey) {
			throw this.createError("MISSING_API_KEY", "Google Cloud API key is not configured")
		}

		if (this.client) {
			return this.client
		}

		try {
			const { TextToSpeechClient } = require("@google-cloud/text-to-speech")

			// Initialize client with API key
			this.client = new TextToSpeechClient({
				apiKey: this.apiKey,
			})

			return this.client
		} catch (error: any) {
			if (error.code === "MODULE_NOT_FOUND") {
				throw this.createError(
					"SDK_NOT_INSTALLED",
					"Google Cloud Text-to-Speech SDK is not installed. Please install @google-cloud/text-to-speech",
				)
			}
			throw this.createError(
				"CLIENT_INIT_ERROR",
				error?.message || "Failed to initialize Google Cloud TTS client",
			)
		}
	}

	async getVoices(): Promise<TtsVoice[]> {
		// Return cached voices if available
		if (this.cachedVoices.length > 0) {
			return this.cachedVoices
		}

		try {
			const client = await this.getClient()
			const [response] = await client.listVoices({})

			this.cachedVoices = response.voices.map((voice: any) => ({
				id: `${voice.name}`,
				name: `${voice.name} (${voice.languageCodes[0]})`,
				language: voice.languageCodes[0],
				gender: this.mapGender(voice.ssmlGender),
				provider: "google-cloud" as TtsProviderType,
			}))

			return this.cachedVoices
		} catch (error: any) {
			throw this.createError("VOICE_LIST_ERROR", error?.message || "Failed to retrieve voices from Google Cloud")
		}
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		try {
			const client = await this.getClient()

			options.onStart?.()

			// Prepare the synthesis request
			const request = {
				input: { text },
				voice: {
					languageCode: this.extractLanguageCode(options.voice) || "en-US",
					name: options.voice || undefined,
				},
				audioConfig: {
					audioEncoding: "MP3" as const,
					speakingRate: options.speed || 1.0,
				},
			}

			// Perform the text-to-speech request
			const [response] = await client.synthesizeSpeech(request)

			// Play the audio
			await this.playAudio(response.audioContent)

			options.onStop?.()
		} catch (error: any) {
			options.onStop?.()

			if (error.provider === "google-cloud") {
				throw error // Already a TtsProviderError
			}

			throw this.createError("SYNTHESIS_ERROR", error?.message || "Failed to synthesize speech")
		}
	}

	stop(): void {
		// Stop current audio playback if any
		if (this.currentAudio) {
			try {
				this.currentAudio.kill()
			} catch (error) {
				// Ignore errors when stopping
			}
			this.currentAudio = undefined
		}
	}

	async validateConfiguration(): Promise<void> {
		if (!this.apiKey) {
			throw this.createError("MISSING_API_KEY", "Google Cloud API key is required")
		}

		try {
			// Try to get the client and list voices to validate the API key
			await this.getVoices()
		} catch (error: any) {
			if (error.code === "MISSING_API_KEY" || error.code === "SDK_NOT_INSTALLED") {
				throw error
			}

			// Check for authentication errors
			if (error?.message?.includes("authentication") || error?.message?.includes("API key")) {
				throw this.createError("INVALID_API_KEY", "Invalid Google Cloud API key")
			}

			throw this.createError(
				"VALIDATION_ERROR",
				error?.message || "Failed to validate Google Cloud configuration",
			)
		}
	}

	/**
	 * Play audio using a system audio player
	 */
	private async playAudio(audioContent: Buffer): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const { spawn } = require("child_process")
				const os = require("os")
				const platform = os.platform()

				// Determine the audio player based on platform
				let player: string
				let args: string[]

				if (platform === "darwin") {
					// macOS
					player = "afplay"
					args = ["-"]
				} else if (platform === "win32") {
					// Windows - use PowerShell to play audio
					player = "powershell"
					args = [
						"-c",
						"$player = New-Object System.Media.SoundPlayer; $player.Stream = [System.Console]::OpenStandardInput(); $player.PlaySync()",
					]
				} else {
					// Linux
					player = "mpg123"
					args = ["-q", "-"]
				}

				this.currentAudio = spawn(player, args)

				// Write audio data to stdin
				this.currentAudio.stdin.write(audioContent)
				this.currentAudio.stdin.end()

				this.currentAudio.on("close", (code: number) => {
					this.currentAudio = undefined
					if (code === 0) {
						resolve()
					} else {
						reject(this.createError("PLAYBACK_ERROR", `Audio playback failed with code ${code}`))
					}
				})

				this.currentAudio.on("error", (error: Error) => {
					this.currentAudio = undefined
					reject(this.createError("PLAYBACK_ERROR", error.message))
				})
			} catch (error: any) {
				this.currentAudio = undefined
				reject(this.createError("PLAYBACK_ERROR", error?.message || "Failed to play audio"))
			}
		})
	}

	/**
	 * Map Google Cloud gender enum to our gender type
	 */
	private mapGender(ssmlGender: string): "male" | "female" | "neutral" | undefined {
		switch (ssmlGender) {
			case "MALE":
				return "male"
			case "FEMALE":
				return "female"
			case "NEUTRAL":
				return "neutral"
			default:
				return undefined
		}
	}

	/**
	 * Extract language code from voice ID
	 * Voice IDs are typically in format: "en-US-Standard-A"
	 */
	private extractLanguageCode(voiceId?: string): string | undefined {
		if (!voiceId) return undefined

		// Extract language code from voice name (e.g., "en-US-Standard-A" -> "en-US")
		const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})/)
		return match ? match[1] : undefined
	}

	/**
	 * Create a standardized error object
	 */
	private createError(code: string, message: string): TtsProviderError {
		return {
			code,
			message,
			provider: "google-cloud",
		}
	}
}
