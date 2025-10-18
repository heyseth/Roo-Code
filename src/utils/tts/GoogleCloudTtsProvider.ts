import axios from "axios"
import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions, TtsProviderError } from "./types"

/**
 * Google Cloud Text-to-Speech Provider (REST API via API Key)
 * Uses HTTPS REST endpoints instead of the Node SDK to support simple API-key auth.
 *
 * Endpoints:
 * - List voices: GET https://texttospeech.googleapis.com/v1/voices?key=API_KEY
 * - Synthesize:  POST https://texttospeech.googleapis.com/v1/text:synthesize?key=API_KEY
 */
export class GoogleCloudTtsProvider implements TtsProvider {
	readonly type: TtsProviderType = "google-cloud"
	private cachedVoices: TtsVoice[] = []
	private currentAudio: any = undefined
	private apiKey: string | undefined
	// Retained for compatibility (if Google later exposes model metadata)
	private voiceModelMap: Map<string, string> = new Map() // Maps voice name to model (optional)

	constructor(apiKey?: string) {
		this.apiKey = apiKey
	}

	/**
	 * Set or update the API key
	 */
	setApiKey(apiKey: string): void {
		console.log(`[GoogleCloudTTS] setApiKey called, API key length: ${apiKey?.length || 0}`)
		this.apiKey = apiKey
		this.cachedVoices = [] // Clear cached voices
		this.voiceModelMap.clear() // Clear voice-to-model mappings
		console.log(`[GoogleCloudTTS] Cached voices and model mappings cleared`)
	}

	async isConfigured(): Promise<boolean> {
		const configured = !!this.apiKey
		console.log(`[GoogleCloudTTS] isConfigured called, result: ${configured}, API key present: ${!!this.apiKey}`)
		return configured
	}

	/**
	 * GET /v1/voices
	 */
	private async listVoicesRest(): Promise<any[]> {
		if (!this.apiKey) {
			console.error(`[GoogleCloudTTS] No API key configured`)
			throw this.createError("MISSING_API_KEY", "Google Cloud API key is not configured")
		}
		const url = `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(this.apiKey)}`
		console.log(`[GoogleCloudTTS] Fetching voices from REST API: ${url.replace(/key=.+$/, "key=***")}`)
		try {
			const response = await axios.get(url)
			const voices = response.data?.voices ?? []
			console.log(`[GoogleCloudTTS] Retrieved ${voices.length} voices from API`)
			if (voices.length > 0) {
				console.log(`[GoogleCloudTTS] Sample voice structure:`, {
					name: voices[0].name,
					languageCodes: voices[0].languageCodes,
					ssmlGender: voices[0].ssmlGender,
					naturalSampleRateHertz: voices[0].naturalSampleRateHertz,
					allFields: Object.keys(voices[0]),
				})
			}
			return voices
		} catch (error: any) {
			// Normalize common auth errors
			const status = error?.response?.status
			const message = error?.response?.data?.error?.message || error?.message || "Failed to list voices"
			console.error(`[GoogleCloudTTS] listVoices REST error:`, { status, message })
			if (status === 401 || status === 403) {
				throw this.createError("INVALID_API_KEY", "Invalid Google Cloud API key or insufficient permissions")
			}
			throw this.createError("VOICE_LIST_ERROR", message)
		}
	}

	async getVoices(): Promise<TtsVoice[]> {
		// Return cached voices if available
		if (this.cachedVoices.length > 0) {
			return this.cachedVoices
		}

		try {
			const apiVoices = await this.listVoicesRest()

			// Map into our TtsVoice format
			this.cachedVoices = apiVoices.map((voice: any) => {
				// Note: Google REST voices do not include a 'model' property in typical responses.
				// Keep placeholder to preserve compatibility if Google adds it in future.
				const model: string | undefined = voice.model

				// Store optional model mapping for compatibility
				if (model) {
					this.voiceModelMap.set(voice.name, model)
					console.log(`[GoogleCloudTTS] Voice ${voice.name} requires model: ${model}`)
				}

				return {
					id: `${voice.name}`,
					name: `${voice.name} (${voice.languageCodes?.[0] || "en-US"})`,
					language: voice.languageCodes?.[0] || "en-US",
					gender: this.mapGender(voice.ssmlGender),
					provider: "google-cloud" as TtsProviderType,
					model,
				}
			})

			console.log(`[GoogleCloudTTS] Stored ${this.voiceModelMap.size} voice-to-model mappings`)
			return this.cachedVoices
		} catch (error: any) {
			if (error.provider === "google-cloud") throw error
			throw this.createError("VOICE_LIST_ERROR", error?.message || "Failed to retrieve voices from Google Cloud")
		}
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		console.log(
			`[GoogleCloudTTS] speak called, text length: ${text.length}, voice: ${options.voice || "default"}, speed: ${options.speed || 1.0}`,
		)

		if (!this.apiKey) {
			console.error(`[GoogleCloudTTS] No API key configured`)
			throw this.createError("MISSING_API_KEY", "Google Cloud API key is not configured")
		}

		try {
			options.onStart?.()

			const languageCode = this.extractLanguageCode(options.voice) || "en-US"
			console.log(`[GoogleCloudTTS] Extracted language code: ${languageCode}`)

			// Ensure voices are loaded and select a valid voice ID for v1 REST API
			if (this.cachedVoices.length === 0) {
				try {
					await this.getVoices()
				} catch {}
			}

			// Prefer the requested voice if it's present and looks valid; otherwise substitute a known-good one
			const validPattern = /^[a-z]{2}-[A-Z]{2}-/
			const requested = options.voice
			let voiceName = requested

			if (!voiceName || !validPattern.test(voiceName) || !this.cachedVoices.find((v) => v.id === voiceName)) {
				const targetLang = this.extractLanguageCode(requested) || "en-US"
				const candidate = this.cachedVoices.find((v) => v.language === targetLang) || this.cachedVoices[0]
				if (candidate) {
					console.warn(
						`[GoogleCloudTTS] Substituting invalid or unavailable voice "${requested}" with "${candidate.id}"`,
					)
					voiceName = candidate.id
				}
			}

			// Build request
			const request: any = {
				input: { text },
				voice: {
					languageCode,
					name: voiceName,
				},
				audioConfig: {
					audioEncoding: "MP3" as const,
					speakingRate: options.speed || 1.0,
				},
			}

			console.log(`[GoogleCloudTTS] Synthesis request:`, {
				textLength: text.length,
				voiceName: request.voice.name,
				languageCode: request.voice.languageCode,
				model: request.voice.model,
				speakingRate: request.audioConfig.speakingRate,
			})

			const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.apiKey)}`
			console.log(`[GoogleCloudTTS] Calling synthesizeSpeech REST...`)
			const response = await axios.post(url, request)

			const audioContentB64: string | undefined = response.data?.audioContent
			if (!audioContentB64) {
				throw this.createError("SYNTHESIS_ERROR", "No audioContent returned from Google TTS")
			}

			const audioBuffer = Buffer.from(audioContentB64, "base64")
			console.log(
				`[GoogleCloudTTS] synthesizeSpeech completed, audio content size: ${audioBuffer?.length || 0} bytes`,
			)

			// Play the audio
			console.log(`[GoogleCloudTTS] Playing audio...`)
			await this.playAudio(audioBuffer)
			console.log(`[GoogleCloudTTS] Audio playback completed`)

			options.onStop?.()
		} catch (error: any) {
			console.error(`[GoogleCloudTTS] speak error:`, error)
			console.error(`[GoogleCloudTTS] Error details:`, {
				code: error.code,
				message: error.message,
				provider: error.provider || "google-cloud",
				stack: error.stack,
			})

			options.onStop?.()

			if (error.provider === "google-cloud") {
				throw error // Already a TtsProviderError
			}

			// Translate axios errors to provider errors
			const status = error?.response?.status
			const message = error?.response?.data?.error?.message || error?.message
			if (status === 401 || status === 403) {
				throw this.createError("INVALID_API_KEY", "Invalid Google Cloud API key or insufficient permissions")
			}
			throw this.createError("SYNTHESIS_ERROR", message || "Failed to synthesize speech")
		}
	}

	stop(): void {
		// Stop current audio playback if any
		if (this.currentAudio) {
			try {
				this.currentAudio.kill()
			} catch {
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
			// Try to list voices to validate the API key
			await this.listVoicesRest()
		} catch (error: any) {
			if (error.code === "MISSING_API_KEY" || error.code === "INVALID_API_KEY") {
				throw error
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
			const os = require("os")
			const platform = os.platform()

			// Windows: System.Media.SoundPlayer doesn't support MP3 over stdin.
			// Write to a temp .mp3 and play using the "sound-play" package instead.
			if (platform === "win32") {
				;(async () => {
					try {
						const path = require("path")
						const fs = require("fs/promises")
						const soundPlay = require("sound-play")

						const tmpFile = path.join(
							os.tmpdir(),
							`roo-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
						)
						await fs.writeFile(tmpFile, audioContent)

						await soundPlay.play(tmpFile).catch((err: any) => {
							throw err
						})

						// Cleanup but don't block resolve on cleanup errors
						fs.unlink(tmpFile).catch(() => {})
						resolve()
					} catch (err: any) {
						reject(this.createError("PLAYBACK_ERROR", err?.message || "Failed to play audio on Windows"))
					}
				})()
				return
			}

			// macOS/Linux: stream to afplay/mpg123 via stdin
			try {
				const { spawn } = require("child_process")

				let player: string
				let args: string[]

				if (platform === "darwin") {
					player = "afplay"
					args = ["-"]
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
	 * Voice IDs are typically in format: "en-US-Standard-A" or "en-US-Neural2-A"
	 */
	private extractLanguageCode(voiceId?: string): string | undefined {
		if (!voiceId) return undefined

		// Extract language code from voice name (e.g., "en-US-Standard-A" -> "en-US")
		const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})/)
		return match ? match[1] : undefined
	}

	/**
	 * Heuristic to choose a model when Google requires one but doesn't provide it in listVoices
	 * - Premium models are typically needed for Neural/WaveNet/Studio-like voices
	 * - Default to standard if no hint is present
	 */
	private inferDefaultModel(voiceId?: string): string {
		const v = voiceId?.toLowerCase() || ""
		// Common premium indicators in Google voices
		if (
			v.includes("wavenet") ||
			v.includes("neural") ||
			v.includes("studio") ||
			v.includes("polyglot") ||
			v.includes("premium")
		) {
			return "models/tts:premium"
		}
		return "models/tts:standard"
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
