import { HTMLAttributes, useCallback, useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { Slider, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui"
import { VSCodeButtonLink } from "../common/VSCodeButtonLink"
import { vscode } from "@/utils/vscode"
import { inputEventTransform } from "./transforms"

type TtsProviderType = "native" | "google-cloud" | "azure"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	ttsProvider?: TtsProviderType
	ttsVoice?: string
	azureRegion?: string
	soundEnabled?: boolean
	soundVolume?: number
	setCachedStateField: SetCachedStateField<
		"ttsEnabled" | "ttsSpeed" | "ttsProvider" | "ttsVoice" | "azureRegion" | "soundEnabled" | "soundVolume"
	>
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	ttsProvider = "native",
	ttsVoice,
	azureRegion,
	soundEnabled,
	soundVolume,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	const [availableVoices, setAvailableVoices] = useState<
		Array<{ id: string; name: string; language: string; gender?: string; provider: string }>
	>([])
	const [loadingVoices, setLoadingVoices] = useState(false)
	const [googleCloudApiKey, setGoogleCloudApiKey] = useState("")
	const [azureApiKey, setAzureApiKey] = useState("")

	// Load voices when provider changes or when provider is configured
	useEffect(() => {
		if (!ttsEnabled) return

		// Only load voices for cloud providers if we have credentials
		if (ttsProvider === "google-cloud" && !googleCloudApiKey) return
		if (ttsProvider === "azure" && (!azureApiKey || !azureRegion)) return

		const loadVoices = async () => {
			setLoadingVoices(true)
			try {
				// Request voices from the backend
				vscode.postMessage({
					type: "getTtsVoices",
					ttsProvider: ttsProvider,
				})
			} catch (error) {
				console.error("Failed to load voices:", error)
				setLoadingVoices(false)
			}
		}

		loadVoices()
	}, [ttsEnabled, ttsProvider, googleCloudApiKey, azureApiKey, azureRegion])

	// Listen for voice list responses from the backend
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "ttsVoices") {
				console.log("Received TTS voices:", message.voices?.length || 0, "voices")
				setAvailableVoices(message.voices || [])
				setLoadingVoices(false)
			} else if (message.type === "ttsVoicesError") {
				console.error("Failed to load voices:", message.error)
				setAvailableVoices([])
				setLoadingVoices(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleInputChange = useCallback(
		<E,>(field: keyof NotificationSettingsProps, transform: (event: E) => any = inputEventTransform) =>
			(event: E | Event) => {
				setCachedStateField(field as any, transform(event as E))
			},
		[setCachedStateField],
	)

	const handleProviderChange = useCallback(
		(provider: TtsProviderType) => {
			setCachedStateField("ttsProvider", provider)
			// Reset voice selection when provider changes
			setCachedStateField("ttsVoice", "")
			setAvailableVoices([])
		},
		[setCachedStateField],
	)

	const handleGoogleCloudApiKeyUpdate = useCallback(
		(apiKey: string) => {
			setGoogleCloudApiKey(apiKey)
			console.log("Sending Google Cloud API key to backend, length:", apiKey?.length || 0)
			vscode.postMessage({
				type: "googleCloudTtsApiKey",
				text: apiKey,
			})
			// Trigger voice loading after a delay to allow backend to update
			if (apiKey && ttsProvider === "google-cloud") {
				console.log("Scheduling voice fetch for Google Cloud TTS")
				setTimeout(() => {
					console.log("Requesting voices from Google Cloud TTS")
					setLoadingVoices(true)
					vscode.postMessage({
						type: "getTtsVoices",
						ttsProvider: "google-cloud",
					})
				}, 1000) // Increased delay to 1 second
			}
		},
		[ttsProvider],
	)

	const handleAzureApiKeyUpdate = useCallback(
		(apiKey: string) => {
			setAzureApiKey(apiKey)
			vscode.postMessage({
				type: "azureTtsApiKey",
				text: apiKey,
			})
			// Trigger voice loading after a short delay to allow backend to update
			if (apiKey && azureRegion && ttsProvider === "azure") {
				setTimeout(() => {
					setLoadingVoices(true)
					vscode.postMessage({
						type: "getTtsVoices",
						ttsProvider: "azure",
					})
				}, 500)
			}
		},
		[ttsProvider, azureRegion],
	)

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>{t("settings:sections.notifications")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={ttsEnabled}
						onChange={(e: any) => setCachedStateField("ttsEnabled", e.target.checked)}
						data-testid="tts-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.tts.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.tts.description")}
					</div>
				</div>

				{ttsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						{/* TTS Provider Selection */}
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.providerLabel")}
							</label>
							<Select value={ttsProvider} onValueChange={handleProviderChange}>
								<SelectTrigger className="w-full" data-testid="tts-provider-select">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="native">
										{t("settings:notifications.tts.providers.native")}
									</SelectItem>
									<SelectItem value="google-cloud">
										{t("settings:notifications.tts.providers.google-cloud")}
									</SelectItem>
									<SelectItem value="azure">
										{t("settings:notifications.tts.providers.azure")}
									</SelectItem>
								</SelectContent>
							</Select>
							<div className="text-sm text-vscode-descriptionForeground mt-1">
								{t("settings:notifications.tts.providerDescription")}
							</div>
						</div>

						{/* Google Cloud API Key */}
						{ttsProvider === "google-cloud" && (
							<div>
								<VSCodeTextField
									value={googleCloudApiKey}
									type="password"
									onInput={(e: any) => {
										const value = e.target.value
										handleGoogleCloudApiKeyUpdate(value)
									}}
									placeholder={t("settings:notifications.tts.googleCloud.apiKeyPlaceholder")}
									className="w-full"
									data-testid="google-cloud-api-key">
									<label className="block font-medium mb-1">
										{t("settings:notifications.tts.googleCloud.apiKeyLabel")}
									</label>
								</VSCodeTextField>
								<div className="text-sm text-vscode-descriptionForeground mt-1">
									{t("settings:providers.apiKeyStorageNotice")}
								</div>
								{!googleCloudApiKey && (
									<VSCodeButtonLink
										href="https://console.cloud.google.com/apis/credentials"
										appearance="secondary"
										className="mt-2">
										{t("settings:notifications.tts.googleCloud.getApiKey")}
									</VSCodeButtonLink>
								)}
							</div>
						)}

						{/* Azure API Key and Region */}
						{ttsProvider === "azure" && (
							<>
								<div>
									<VSCodeTextField
										value={azureApiKey}
										type="password"
										onInput={(e: any) => {
											const value = e.target.value
											handleAzureApiKeyUpdate(value)
										}}
										placeholder={t("settings:notifications.tts.azure.apiKeyPlaceholder")}
										className="w-full"
										data-testid="azure-api-key">
										<label className="block font-medium mb-1">
											{t("settings:notifications.tts.azure.apiKeyLabel")}
										</label>
									</VSCodeTextField>
									<div className="text-sm text-vscode-descriptionForeground mt-1">
										{t("settings:providers.apiKeyStorageNotice")}
									</div>
									{!azureApiKey && (
										<VSCodeButtonLink
											href="https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices"
											appearance="secondary"
											className="mt-2">
											{t("settings:notifications.tts.azure.getApiKey")}
										</VSCodeButtonLink>
									)}
								</div>
								<div>
									<VSCodeTextField
										value={azureRegion || ""}
										onInput={(e: any) => {
											const value = e.target.value
											setCachedStateField("azureRegion", value)
											// Trigger voice loading if we have both API key and region
											if (azureApiKey && value && ttsProvider === "azure") {
												setTimeout(() => {
													setLoadingVoices(true)
													vscode.postMessage({
														type: "getTtsVoices",
														ttsProvider: "azure",
													})
												}, 500)
											}
										}}
										placeholder={t("settings:notifications.tts.azure.regionPlaceholder")}
										className="w-full"
										data-testid="azure-region">
										<label className="block font-medium mb-1">
											{t("settings:notifications.tts.azure.regionLabel")}
										</label>
									</VSCodeTextField>
								</div>
							</>
						)}

						{/* Voice Selection */}
						{(ttsProvider === "google-cloud" || ttsProvider === "azure") && (
							<div>
								<label className="block font-medium mb-1">
									{t("settings:notifications.tts.voiceLabel")}
								</label>
								<Select
									value={ttsVoice || ""}
									onValueChange={(value) => setCachedStateField("ttsVoice", value)}
									disabled={loadingVoices || availableVoices.length === 0}>
									<SelectTrigger className="w-full" data-testid="tts-voice-select">
										<SelectValue
											placeholder={
												loadingVoices
													? t("settings:notifications.tts.loadingVoices")
													: availableVoices.length === 0
														? t("settings:notifications.tts.noVoicesAvailable")
														: t("settings:notifications.tts.voicePlaceholder")
											}
										/>
									</SelectTrigger>
									<SelectContent>
										{availableVoices.map((voice) => (
											<SelectItem key={voice.id} value={voice.id}>
												{voice.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<div className="text-sm text-vscode-descriptionForeground mt-1">
									{t("settings:notifications.tts.voiceDescription")}
								</div>
							</div>
						)}

						{/* Speed Control */}
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.speedLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.1}
									max={2.0}
									step={0.01}
									value={[ttsSpeed ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("ttsSpeed", value)}
									data-testid="tts-speed-slider"
								/>
								<span className="w-10">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}

				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</div>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
