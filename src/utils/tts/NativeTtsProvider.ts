import { TtsProvider, TtsProviderType, TtsVoice, TtsSpeakOptions, TtsProviderError } from "./types"

interface Say {
	speak: (text: string, voice?: string, speed?: number, callback?: (err?: string) => void) => void
	stop: () => void
	getInstalledVoices?: (callback: (err: Error | null, voices?: string[]) => void) => void
}

/**
 * Native TTS Provider using the OS's built-in text-to-speech engine
 * This is a wrapper around the "say" npm package
 */
export class NativeTtsProvider implements TtsProvider {
	readonly type: TtsProviderType = "native"
	private sayInstance: Say | undefined = undefined
	private cachedVoices: TtsVoice[] = []
	private currentOnStop: (() => void) | undefined = undefined

	async isConfigured(): Promise<boolean> {
		// Native TTS is always available (no API keys required)
		return true
	}

	async getVoices(): Promise<TtsVoice[]> {
		// Return cached voices if available
		if (this.cachedVoices.length > 0) {
			return this.cachedVoices
		}

		try {
			const say: Say = require("say")

			// Try to get installed voices if the method exists
			if (say.getInstalledVoices) {
				return new Promise((resolve) => {
					say.getInstalledVoices!((err, voices) => {
						if (err || !voices) {
							// Fallback to generic voice if we can't get installed voices
							this.cachedVoices = [
								{
									id: "default",
									name: "System Default",
									language: "en-US",
									provider: "native",
								},
							]
						} else {
							// Convert voice names to TtsVoice objects
							this.cachedVoices = voices.map((voiceName) => ({
								id: voiceName,
								name: voiceName,
								language: this.guessLanguageFromVoiceName(voiceName),
								provider: "native" as TtsProviderType,
							}))
						}
						resolve(this.cachedVoices)
					})
				})
			} else {
				// Fallback if getInstalledVoices is not available
				this.cachedVoices = [
					{
						id: "default",
						name: "System Default",
						language: "en-US",
						provider: "native",
					},
				]
				return this.cachedVoices
			}
		} catch (error) {
			// Return a default voice even if there's an error
			this.cachedVoices = [
				{
					id: "default",
					name: "System Default",
					language: "en-US",
					provider: "native",
				},
			]
			return this.cachedVoices
		}
	}

	async speak(text: string, options: TtsSpeakOptions = {}): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				const say: Say = require("say")
				this.sayInstance = say

				// Validate voice - only use it if it looks like a native voice name
				// Native voices are typically simple names like "Alex", "Samantha", etc.
				// Cloud provider voices have patterns like "en-GB-Chirp3-HD-Umbriel"
				let voice = options.voice && options.voice !== "default" ? options.voice : undefined
				
				// If voice contains hyphens or looks like a cloud provider voice, ignore it and use default
				if (voice && (voice.includes('-') || voice.includes('Chirp') || voice.includes('Neural') || voice.includes('Wavenet'))) {
					console.log(`[NativeTTS] Ignoring cloud provider voice "${voice}", using system default`)
					voice = undefined
				}

				const speed = options.speed ?? 1.0

				// Store onStop callback to be called when stop() is invoked
				this.currentOnStop = options.onStop

				// Call onStart immediately to show the button
				options.onStart?.()

				const startTime = Date.now()
				console.log(`[NativeTTS] Starting speech, text length: ${text.length}, voice: ${voice || 'default'}`)

				say.speak(text, voice, speed, (err) => {
					const duration = Date.now() - startTime
					console.log(`[NativeTTS] Callback fired after ${duration}ms, err: ${err}`)

					if (err) {
						// On error, call onStop and reject
						console.log(`[NativeTTS] Error occurred, calling onStop`)
						if (this.currentOnStop) {
							this.currentOnStop()
							this.currentOnStop = undefined
						}
						const error: TtsProviderError = {
							code: "NATIVE_TTS_ERROR",
							message: err,
							provider: "native",
						}
						reject(error)
					} else {
						// On success, call onStop and resolve
						console.log(`[NativeTTS] Speech completed successfully, calling onStop`)
						if (this.currentOnStop) {
							this.currentOnStop()
							this.currentOnStop = undefined
						}
						resolve()
					}

					this.sayInstance = undefined
				})

				console.log(`[NativeTTS] say.speak() called, waiting for callback...`)
			} catch (error: any) {
				console.log(`[NativeTTS] Exception in speak():`, error)
				if (this.currentOnStop) {
					this.currentOnStop()
					this.currentOnStop = undefined
				}
				this.sayInstance = undefined

				const providerError: TtsProviderError = {
					code: "NATIVE_TTS_INIT_ERROR",
					message: error?.message || "Failed to initialize native TTS",
					provider: "native",
				}
				reject(providerError)
			}
		})
	}

	stop(): void {
		if (this.sayInstance) {
			this.sayInstance.stop()
			this.sayInstance = undefined
		}
		// Call onStop when manually stopped
		if (this.currentOnStop) {
			this.currentOnStop()
			this.currentOnStop = undefined
		}
	}

	async validateConfiguration(): Promise<void> {
		// Native TTS doesn't require configuration
		return Promise.resolve()
	}

	/**
	 * Attempt to guess the language from the voice name
	 * This is a simple heuristic since voice names often contain language/locale info
	 */
	private guessLanguageFromVoiceName(voiceName: string): string {
		const name = voiceName.toLowerCase()

		// Common patterns in voice names
		if (name.includes("en-us") || name.includes("english")) return "en-US"
		if (name.includes("en-gb") || name.includes("british")) return "en-GB"
		if (name.includes("en-au") || name.includes("australian")) return "en-AU"
		if (name.includes("es-") || name.includes("spanish")) return "es-ES"
		if (name.includes("fr-") || name.includes("french")) return "fr-FR"
		if (name.includes("de-") || name.includes("german")) return "de-DE"
		if (name.includes("it-") || name.includes("italian")) return "it-IT"
		if (name.includes("ja-") || name.includes("japanese")) return "ja-JP"
		if (name.includes("zh-") || name.includes("chinese")) return "zh-CN"
		if (name.includes("ko-") || name.includes("korean")) return "ko-KR"
		if (name.includes("pt-") || name.includes("portuguese")) return "pt-PT"
		if (name.includes("ru-") || name.includes("russian")) return "ru-RU"

		// Default to English if we can't determine
		return "en-US"
	}
}
