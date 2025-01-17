import m from "mithril"
import Button from "../scripts/Button"

// Currently serving as a PoC for testing Mithril components.

function render(component: m.ComponentTypes, attrs: Record<string, unknown> = {}, children: m.Children = ""): Element {
	const root = document.createElement("div")
	m.mount(root, { view: () => m(component, attrs, children) })
	return root
}

test("button default", async () => {
	const root = render(Button)
	const buttonEl = root.querySelector("button")
	expect(buttonEl).toBeDefined()
	expect(buttonEl?.className).toBe("")
	expect(buttonEl?.type).toBe("button")
})

test("button primary", async () => {
	const root = render(Button, { style: "primary" })
	const buttonEl = root.querySelector("button")
	expect(buttonEl).toBeDefined()
	expect(buttonEl?.className.trim()).toBe("primary")
	expect(buttonEl?.type).toBe("button")
})

test("custom classes are set", async () => {
	const root = render(Button, { class: "any custom class" })
	const buttonEl = root.querySelector("button")
	expect(buttonEl).toBeDefined()
	expect(buttonEl?.className.trim()).toBe("any custom class")
	expect(buttonEl?.type).toBe("button")
})

test("inc redraw", async () => {
	function Inc(): m.Component {
		let n = 1

		return { view }

		function view() {
			return m("div", [
				m("span", n),
				m(
					"button", {
						onclick() {
							++n
						},
					},
					"Inc",
				),
			])
		}
	}

	const root = render(Inc)

	const spanEl = root.querySelector("span")
	expect(spanEl).toBeDefined()
	expect(spanEl?.innerHTML).toBe("1")

	const buttonEl = root.querySelector("button")
	expect(buttonEl).toBeDefined()

	buttonEl?.click()
	m.redraw.sync()
	expect(spanEl?.innerHTML).toBe("2")
})
