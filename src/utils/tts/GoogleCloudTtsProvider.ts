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

			// Valid voice names must match the pattern: en-US-Chirp3-HD-Achernar
			// Invalid voices are just the name without the locale prefix: Achernar
			const validVoicePattern = /^[a-z]{2}-[A-Z]{2}-.+/

			// Filter and map into our TtsVoice format
			const validVoices = apiVoices.filter((voice: any) => {
				const isValid = validVoicePattern.test(voice.name)
				if (!isValid) {
					console.log(`[GoogleCloudTTS] Filtering out invalid voice: ${voice.name}`)
				}
				return isValid
			})

			console.log(
				`[GoogleCloudTTS] Filtered ${apiVoices.length} voices to ${validVoices.length} valid voices (removed ${apiVoices.length - validVoices.length} invalid)`,
			)

			this.cachedVoices = validVoices.map((voice: any) => {
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

	/**
	 * Split text into chunks that respect Google Cloud TTS limits
	 * Max 5000 chars per request, but sentences should be ~400 chars max
	 */
	private splitTextIntoChunks(text: string, maxChunkLength: number = 400): string[] {
		const chunks: string[] = []

		// Split on sentence boundaries
		const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]

		let currentChunk = ""

		for (const sentence of sentences) {
			const trimmedSentence = sentence.trim()

			// If a single sentence is too long, split it further on commas or other punctuation
			if (trimmedSentence.length > maxChunkLength) {
				// First, save any accumulated chunk
				if (currentChunk) {
					chunks.push(currentChunk.trim())
					currentChunk = ""
				}

				// Split long sentence on commas, semicolons, or dashes
				const subparts = trimmedSentence.split(/([,;—])\s+/)
				let subChunk = ""

				for (const part of subparts) {
					if (subChunk.length + part.length <= maxChunkLength) {
						subChunk += part
					} else {
						if (subChunk) {
							chunks.push(subChunk.trim())
						}
						subChunk = part
					}
				}

				if (subChunk) {
					chunks.push(subChunk.trim())
				}
			} else if (currentChunk.length + trimmedSentence.length + 1 > maxChunkLength) {
				// Current chunk plus this sentence would be too long
				chunks.push(currentChunk.trim())
				currentChunk = trimmedSentence
			} else {
				// Add to current chunk
				currentChunk += (currentChunk ? " " : "") + trimmedSentence
			}
		}

		// Don't forget the last chunk
		if (currentChunk) {
			chunks.push(currentChunk.trim())
		}

		return chunks.filter((chunk) => chunk.length > 0)
	}

	/**
	 * Synthesize a single chunk with exponential backoff retry logic
	 */
	private async synthesizeChunkWithRetry(
		chunk: string,
		chunkIndex: number,
		totalChunks: number,
		languageCode: string,
		voiceName: string,
		speed: number,
		maxRetries: number = 5,
	): Promise<Buffer> {
		const request: any = {
			input: { text: chunk },
			voice: {
				languageCode,
				name: voiceName,
			},
			audioConfig: {
				audioEncoding: "MP3" as const,
				speakingRate: speed,
			},
		}

		const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.apiKey!)}`

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				console.log(
					`[GoogleCloudTTS] Synthesizing chunk ${chunkIndex + 1}/${totalChunks}${attempt > 0 ? ` (retry ${attempt}/${maxRetries})` : ""}, length: ${chunk.length}`,
				)

				const response = await axios.post(url, request)

				const audioContentB64: string | undefined = response.data?.audioContent
				if (!audioContentB64) {
					throw this.createError("SYNTHESIS_ERROR", "No audioContent returned from Google TTS")
				}

				const audioBuffer = Buffer.from(audioContentB64, "base64")
				console.log(
					`[GoogleCloudTTS] Chunk ${chunkIndex + 1}/${totalChunks} synthesis completed, size: ${audioBuffer.length} bytes`,
				)

				return audioBuffer
			} catch (error: any) {
				const status = error?.response?.status
				const message = error?.response?.data?.error?.message || error?.message

				// Don't retry on auth errors
				if (status === 401 || status === 403) {
					console.error(`[GoogleCloudTTS] Auth error on chunk ${chunkIndex + 1}, not retrying`)
					throw this.createError(
						"INVALID_API_KEY",
						"Invalid Google Cloud API key or insufficient permissions",
					)
				}

				// Check if we should retry (rate limit, server errors, network issues)
				const shouldRetry =
					attempt < maxRetries &&
					(status === 429 || // Rate limit
						status === 500 || // Internal server error
						status === 502 || // Bad gateway
						status === 503 || // Service unavailable
						status === 504 || // Gateway timeout
						error.code === "ECONNRESET" ||
						error.code === "ETIMEDOUT" ||
						error.code === "ENOTFOUND")

				if (shouldRetry) {
					// Exponential backoff: 1s, 2s, 4s, 8s, 16s
					const delayMs = Math.min(1000 * Math.pow(2, attempt), 16000)
					console.warn(
						`[GoogleCloudTTS] Chunk ${chunkIndex + 1} failed (${status || error.code}): ${message}. Retrying in ${delayMs}ms...`,
					)
					await new Promise((resolve) => setTimeout(resolve, delayMs))
					continue
				}

				// Final failure
				console.error(`[GoogleCloudTTS] Chunk ${chunkIndex + 1} synthesis failed after ${attempt} retries:`, {
					status,
					message,
					code: error.code,
				})
				throw this.createError("SYNTHESIS_ERROR", message || "Failed to synthesize speech")
			}
		}

		// Should never reach here, but TypeScript requires it
		throw this.createError("SYNTHESIS_ERROR", "Max retries exceeded")
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		console.log(
			`[GoogleCloudTTS] speak called, text length: ${text.length}, voice: ${options.voice || "default"}, speed: ${options.speed || 1.0}`,
		)

		if (!this.apiKey) {
			console.error(`[GoogleCloudTTS] No API key configured`)
			throw this.createError("MISSING_API_KEY", "Google Cloud API key is not configured")
		}

		// Split long text into manageable chunks
		const chunks = this.splitTextIntoChunks(text)
		console.log(`[GoogleCloudTTS] Split text into ${chunks.length} chunks`)

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
			let voiceName: string | undefined = requested

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

			// Ensure we have a valid voice name
			if (!voiceName) {
				throw this.createError("VOICE_LIST_ERROR", "No valid voice available for synthesis")
			}

			// Synthesize all chunks in parallel
			console.log(`[GoogleCloudTTS] Starting parallel synthesis of ${chunks.length} chunks...`)
			const synthesisStartTime = Date.now()

			const audioBuffers = await Promise.all(
				chunks.map((chunk, index) =>
					this.synthesizeChunkWithRetry(
						chunk,
						index,
						chunks.length,
						languageCode,
						voiceName,
						options.speed || 1.0,
					),
				),
			)

			const synthesisEndTime = Date.now()
			console.log(
				`[GoogleCloudTTS] Parallel synthesis completed in ${synthesisEndTime - synthesisStartTime}ms, concatenating ${audioBuffers.length} audio chunks...`,
			)

			// Concatenate all MP3 chunks into a single buffer to eliminate inter-chunk delays
			// MP3 files can be concatenated by simply joining their binary data
			const concatenatedAudio = Buffer.concat(audioBuffers)
			console.log(
				`[GoogleCloudTTS] Concatenated ${audioBuffers.length} chunks into single audio buffer (${concatenatedAudio.length} bytes), starting playback...`,
			)

			// Play the concatenated audio as a single stream
			await this.playAudio(concatenatedAudio)

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
		console.log(`[GoogleCloudTTS] stop() called, currentAudio exists: ${!!this.currentAudio}`)
		// Stop current audio playback if any
		if (this.currentAudio) {
			try {
				console.log(`[GoogleCloudTTS] Killing audio playback process...`)
				this.currentAudio.kill()
				console.log(`[GoogleCloudTTS] Audio playback process killed successfully`)
			} catch (error: any) {
				console.error(`[GoogleCloudTTS] Error killing audio playback:`, error)
				// Ignore errors when stopping
			}
			this.currentAudio = undefined
		} else {
			console.log(`[GoogleCloudTTS] No active audio playback to stop`)
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

			// Windows: Use PowerShell's MediaPlayer with a trackable process
			if (platform === "win32") {
				;(async () => {
					try {
						const path = require("path")
						const fs = require("fs/promises")
						const { spawn } = require("child_process")

						const tmpFile = path.join(
							os.tmpdir(),
							`roo-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
						)
						await fs.writeFile(tmpFile, audioContent)

						// Use PowerShell MediaPlayer directly so we can track and kill the process
						const psScript = `
							Add-Type -AssemblyName presentationCore;
							$player = New-Object system.windows.media.mediaplayer;
							$player.open('${tmpFile.replace(/\\/g, "\\\\")}');
							$player.Play();
							Start-Sleep 1;
							Start-Sleep -s $player.NaturalDuration.TimeSpan.TotalSeconds;
							Exit;
						`
							.replace(/\t/g, "")
							.replace(/\n\s+/g, " ")

						this.currentAudio = spawn("powershell", ["-NoProfile", "-Command", psScript])

						this.currentAudio.on("close", (code: number) => {
							this.currentAudio = undefined
							// Cleanup temp file
							fs.unlink(tmpFile).catch(() => {})
							if (code === 0 || code === null) {
								resolve()
							} else {
								reject(this.createError("PLAYBACK_ERROR", `Audio playback failed with code ${code}`))
							}
						})

						this.currentAudio.on("error", (error: Error) => {
							this.currentAudio = undefined
							fs.unlink(tmpFile).catch(() => {})
							reject(this.createError("PLAYBACK_ERROR", error.message))
						})
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
