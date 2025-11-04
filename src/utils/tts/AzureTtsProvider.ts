import axios from "axios"
import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions, TtsProviderError } from "./types"
import { ChildProcess } from "child_process"
import {
	type AzureTtsTier,
	type AzureTtsUsage,
	detectAzureVoiceType,
	calculateAzureTtsCost,
	updateAzureTtsUsage,
} from "../../shared/ttsCost"
import { ContextProxy } from "../../core/config/ContextProxy"

/**
 * Microsoft Azure Text-to-Speech Provider (REST API)
 * Uses HTTPS REST endpoints with API key authentication
 *
 * Endpoints:
 * - List voices: GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list
 * - Synthesize:  POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 *
 * Documentation: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech
 */
export class AzureTtsProvider implements TtsProvider {
	readonly type: TtsProviderType = "azure"
	private cachedVoices: TtsVoice[] = []
	private currentAudio: ChildProcess | undefined
	private apiKey: string | undefined
	private region: string | undefined

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
		this.cachedVoices = [] // Clear cached voices
	}

	async isConfigured(): Promise<boolean> {
		return !!(this.apiKey && this.region)
	}

	/**
	 * GET /cognitiveservices/voices/list
	 * Lists all available voices for the region
	 */
	private async listVoicesFromAPI(): Promise<any[]> {
		if (!this.apiKey || !this.region) {
			throw this.createError("MISSING_CREDENTIALS", "Azure Speech API key and region are required")
		}

		const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`

		console.log(`[AzureTTS] Fetching voices from REST API: ${url}`)

		try {
			const response = await axios.get(url, {
				headers: {
					"Ocp-Apim-Subscription-Key": this.apiKey,
				},
			})

			const voices = response.data ?? []
			console.log(`[AzureTTS] Retrieved ${voices.length} voices from API`)

			if (voices.length > 0) {
				console.log(`[AzureTTS] Sample voice structure:`, {
					shortName: voices[0].ShortName,
					locale: voices[0].Locale,
					displayName: voices[0].DisplayName,
					localName: voices[0].LocalName,
					gender: voices[0].Gender,
					allFields: Object.keys(voices[0]),
				})
			}

			return voices
		} catch (error: any) {
			const status = error?.response?.status
			const message = error?.response?.data?.error?.message || error?.message || "Failed to list voices"

			console.error(`[AzureTTS] listVoices REST error:`, { status, message })

			if (status === 401 || status === 403) {
				throw this.createError("INVALID_API_KEY", "Invalid Azure Speech API key or region")
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
			const apiVoices = await this.listVoicesFromAPI()

			this.cachedVoices = apiVoices.map((voice: any) => ({
				id: voice.ShortName,
				name: `${voice.LocalName || voice.DisplayName} (${voice.Locale})`,
				language: voice.Locale,
				gender: this.mapGender(voice.Gender),
				provider: "azure" as TtsProviderType,
			}))

			console.log(`[AzureTTS] Cached ${this.cachedVoices.length} voices`)
			return this.cachedVoices
		} catch (error: any) {
			if (error.provider === "azure") {
				throw error // Already a TtsProviderError
			}
			throw this.createError("VOICE_LIST_ERROR", error?.message || "Failed to retrieve voices from Azure Speech")
		}
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		if (!this.apiKey || !this.region) {
			throw this.createError("MISSING_CREDENTIALS", "Azure Speech API key and region are required")
		}

		// Stop any currently playing audio
		this.stop()

		try {
			// Ensure voices are loaded
			if (this.cachedVoices.length === 0) {
				await this.getVoices()
			}

			// Select voice
			const voiceName = options.voice || this.cachedVoices[0]?.id || "en-US-AriaNeural"
			const speed = options.speed || 1.0

			// Build SSML
			const rate = this.speedToRate(speed)
			const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
				<voice name="${voiceName}">
					<prosody rate="${rate}">${this.escapeXml(text)}</prosody>
				</voice>
			</speak>`

			const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`

			console.log(`[AzureTTS] Synthesizing speech with voice: ${voiceName}, speed: ${speed}`)

			const response = await axios.post(url, ssml, {
				headers: {
					"Ocp-Apim-Subscription-Key": this.apiKey,
					"Content-Type": "application/ssml+xml",
					"X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
				},
				responseType: "arraybuffer",
			})

			// Log all response headers to investigate pricing tier detection
			console.log(`[AzureTTS] Response status: ${response.status}`)
			console.log(`[AzureTTS] Response headers:`, JSON.stringify(response.headers, null, 2))

			// Convert array buffer to audio buffer
			const audioBuffer = Buffer.from(response.data)

			// Track API cost
			await this.trackCost(text, voiceName, options)

			// Play audio using system audio player
			options.onStart?.()
			await this.playAudio(audioBuffer)
			options.onStop?.()
		} catch (error: any) {
			if (error.provider === "azure") {
				throw error // Already a TtsProviderError
			}

			const status = error?.response?.status
			if (status === 401 || status === 403) {
				throw this.createError("INVALID_API_KEY", "Invalid Azure Speech API key or region")
			}

			throw this.createError("SYNTHESIS_ERROR", error?.message || "Failed to synthesize speech")
		}
	}

	stop(): void {
		if (this.currentAudio) {
			try {
				this.currentAudio.kill()
			} catch (error) {
				// Ignore errors when stopping
			}
			this.currentAudio = undefined
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
							`roo-tts-azure-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
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

						if (this.currentAudio) {
							this.currentAudio.on("close", (code: number) => {
								this.currentAudio = undefined
								// Cleanup temp file
								fs.unlink(tmpFile).catch(() => {})
								if (code === 0 || code === null) {
									resolve()
								} else {
									reject(
										this.createError("PLAYBACK_ERROR", `Audio playback failed with code ${code}`),
									)
								}
							})

							this.currentAudio.on("error", (error: Error) => {
								this.currentAudio = undefined
								fs.unlink(tmpFile).catch(() => {})
								reject(this.createError("PLAYBACK_ERROR", error.message))
							})
						}
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

				if (this.currentAudio && this.currentAudio.stdin) {
					// Write audio data to stdin
					this.currentAudio.stdin.write(audioContent)
					this.currentAudio.stdin.end()
				}

				if (this.currentAudio) {
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
				}
			} catch (error: any) {
				this.currentAudio = undefined
				reject(this.createError("PLAYBACK_ERROR", error?.message || "Failed to play audio"))
			}
		})
	}

	async validateConfiguration(): Promise<void> {
		if (!this.apiKey || !this.region) {
			throw this.createError("MISSING_CREDENTIALS", "Azure Speech API key and region are required")
		}

		try {
			// Try to get voices to validate the credentials
			await this.getVoices()
		} catch (error: any) {
			if (error.code === "MISSING_CREDENTIALS") {
				throw error
			}

			// Check for authentication errors
			if (
				error?.message?.includes("authentication") ||
				error?.message?.includes("Unauthorized") ||
				error?.message?.includes("401") ||
				error?.code === "INVALID_API_KEY"
			) {
				throw this.createError("INVALID_CREDENTIALS", "Invalid Azure Speech API key or region")
			}

			throw this.createError("VALIDATION_ERROR", error?.message || "Failed to validate Azure configuration")
		}
	}

	/**
	 * Track API cost for Azure TTS usage
	 */
	private async trackCost(text: string, voiceName: string, options: TtsSpeakOptions): Promise<void> {
		try {
			// Get the pricing tier from global state
			const tier = (ContextProxy.instance.getGlobalState("azureTtsTier") as AzureTtsTier | undefined) || "S0"

			// Detect voice type from voice name
			const voiceType = detectAzureVoiceType(voiceName)

			// Calculate character count
			const charactersUsed = text.length

			// Get current usage
			const currentUsage = ContextProxy.instance.getGlobalState("azureTtsUsage") as AzureTtsUsage | undefined

			// Calculate cost
			const costDetails = calculateAzureTtsCost(
				tier,
				voiceType,
				charactersUsed,
				currentUsage?.charactersUsed || 0,
			)

			// Update usage tracking
			const updatedUsage = updateAzureTtsUsage(currentUsage, tier, charactersUsed)

			// Save updated usage
			await ContextProxy.instance.updateGlobalState("azureTtsUsage", updatedUsage)

			console.log(`[AzureTTS] Cost tracking:`, {
				tier,
				voiceType,
				charactersUsed,
				totalUsageThisMonth: updatedUsage.charactersUsed,
				charactersCostFree: costDetails.charactersCostFree,
				charactersCostPaid: costDetails.charactersCostPaid,
				cost: costDetails.cost,
				costFormatted: `$${costDetails.cost.toFixed(4)}`,
			})

			// For F0 tier, warn if approaching the limit
			if (tier === "F0") {
				const limit = 500_000
				const percentUsed = (updatedUsage.charactersUsed / limit) * 100
				if (percentUsed >= 90) {
					console.warn(
						`[AzureTTS] WARNING: You have used ${percentUsed.toFixed(1)}% of your F0 free tier limit (${updatedUsage.charactersUsed.toLocaleString()}/${limit.toLocaleString()} characters)`,
					)
				}
			}

			// Invoke cost callback if provided (this is what records the cost to the task)
			if (options.onCostIncurred && costDetails.cost > 0) {
				options.onCostIncurred({
					provider: "azure",
					modelType: voiceType,
					charactersUsed,
					charactersCostFree: costDetails.charactersCostFree,
					charactersCostPaid: costDetails.charactersCostPaid,
					cost: costDetails.cost,
				})
			}
		} catch (error) {
			// Don't fail the TTS operation if cost tracking fails
			console.error(`[AzureTTS] Error tracking cost:`, error)
		}
	}

	/**
	 * Map Azure gender string to our gender type
	 */
	private mapGender(gender: string): "male" | "female" | "neutral" | undefined {
		const genderLower = gender?.toLowerCase()
		switch (genderLower) {
			case "female":
				return "female"
			case "male":
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
