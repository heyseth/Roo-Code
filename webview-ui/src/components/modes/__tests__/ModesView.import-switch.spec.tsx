import { render, screen, waitFor } from "@/utils/test-utils"
import ModesView from "../ModesView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vitest.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vitest.fn(),
	},
}))

const baseState = {
	customModePrompts: {},
	listApiConfigMeta: [],
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: vitest.fn(),
	mode: "code",
	customModes: [],
	customSupportPrompts: [],
	currentApiConfigName: "",
	customInstructions: "",
	setCustomInstructions: vitest.fn(),
}

describe("ModesView - auto switch after import", () => {
	beforeEach(() => {
		vitest.clearAllMocks()
	})

	it("switches to imported mode when import succeeds and slug is provided", async () => {
		const importedMode = {
			slug: "imported-mode",
			name: "Imported Mode",
			roleDefinition: "Role",
			groups: ["read"] as const,
			source: "global" as const,
		}

		render(
			<ExtensionStateContext.Provider value={{ ...baseState, customModes: [importedMode] } as any}>
				<ModesView onDone={vitest.fn()} />
			</ExtensionStateContext.Provider>,
		)

		const trigger = screen.getByTestId("mode-select-trigger")
		expect(trigger).toHaveTextContent("Code")

		// Simulate extension sending successful import result with slug
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "importModeResult", success: true, slug: "imported-mode" },
			}),
		)

		// Backend switch message sent
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "mode", text: "imported-mode" })
		})

		// UI reflects new mode selection
		await waitFor(() => {
			expect(trigger).toHaveTextContent("Imported Mode")
		})
	})

	it("does not switch when import fails or slug missing", async () => {
		render(
			<ExtensionStateContext.Provider value={{ ...baseState } as any}>
				<ModesView onDone={vitest.fn()} />
			</ExtensionStateContext.Provider>,
		)

		const trigger = screen.getByTestId("mode-select-trigger")
		expect(trigger).toHaveTextContent("Code")

		// Import failure
		window.dispatchEvent(
			new MessageEvent("message", { data: { type: "importModeResult", success: false, error: "x" } }),
		)

		await waitFor(() => {
			expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "mode", text: expect.any(String) })
		})
		expect(trigger).toHaveTextContent("Code")

		// Success but no slug provided
		window.dispatchEvent(new MessageEvent("message", { data: { type: "importModeResult", success: true } }))

		await waitFor(() => {
			expect(vscode.postMessage).not.toHaveBeenCalledWith({ type: "mode", text: expect.any(String) })
		})
		expect(trigger).toHaveTextContent("Code")
	})
})
