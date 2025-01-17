import type { Vnode, VnodeDOM } from "mithril"
import m from "mithril"
import OptionsModal, { editorFontOption, editorFontSizeOption } from "./Options"
import Workspace from "./Workspace"
import * as AuthService from "./AuthService"
import { DocumentBrowser } from "./DocumentBrowser"
import Modal from "./Modal"
import Button from "./Button"
import * as Icons from "./Icons"
import CookiesModal from "./CookiesModal"
import LoginFormModal from "./LoginFormModal"
import FileBucketModal from "./FileBucketModal"
import ColorPaletteModal from "./ColorPaletteModal"
import { NavLink } from "./NavLink"
import ResultPane from "./ResultPane"
import { isDev } from "./Env"
import Toaster from "./Toaster"
import ExternalLink from "./ExternalLink"
import ExportPane from "./ExportPane"

window.addEventListener("load", main)

function main() {
	const root = document.createElement("main")
	root.setAttribute("id", "app")
	root.classList.add("h-100")
	document.body.insertAdjacentElement("afterbegin", root)
	document.getElementById("loadingBox")?.remove()

	m.route(root, "/doc/browser/master", {
		"/doc/:path...": {
			render: (vnode: Vnode) => m(Layout, m(WorkspaceView, vnode.attrs)),
		},
		// TODO: "/:404...": errorPageComponent,
	})

	AuthService.check()
}

const Layout: m.Component = {
	view(vnode: m.VnodeDOM): m.Children {
		return [
			vnode.children,
			m(".toasts.pa4.fixed.right-0.top-0", Toaster.map(toast => m(
				".f5.pa3.mb2.br2.shadow-2",
				{
					class: {
						success: "bg-washed-green dark-green",
						danger: "bg-washed-red dark-red",
					}[toast.type],
					key: toast.id,
					onbeforeremove({ dom }: m.VnodeDOM): Promise<Event> {
						dom.classList.add("close")
						return new Promise(resolve => {
							dom.addEventListener("animationend", resolve)
						})
					},
				},
				[
					m("button.bn.br-pill.fr.pointer", {
						type: "button",
						class: {
							success: "bg-light-green dark-green",
							danger: "bg-light-red dark-red",
						}[toast.type],
						onclick(event: Event) {
							(event.target as HTMLButtonElement).style.display = "none"
							Toaster.remove(toast.id)
						},
					}, m.trust("&times;")),
					toast.id + ": " + toast.message,
				],
			))),
		]
	},
}

function WorkspaceView(): m.Component {
	const workspace = new Workspace()
	let redrawCount = 0

	const enum VisiblePopup {
		AboutPane,
		ColorPalette,
		Cookies,
		DocumentBrowserPopup,
		FileBucketPopup,
		LoginForm,
		None,
		Options,
	}

	let popup: VisiblePopup = VisiblePopup.None

	return {
		view,
		oncreate,
		onremove,
		oninit: loadSheet,
		onupdate: loadSheet,
	}

	function loadSheet(vnode: VnodeDOM<{ path: string }>) {
		if (workspace.currentSheetQualifiedPath() !== vnode.attrs.path) {
			workspace.currentSheetQualifiedPath(vnode.attrs.path)
			popup = VisiblePopup.None
		}
	}

	function oncreate() {
		document.addEventListener("keydown", onKeyDown)
	}

	function onremove() {
		document.removeEventListener("keydown", onKeyDown)
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			if (workspace.exportingRequest != null) {
				workspace.exportingRequest = null
				m.redraw()
			}
			if (popup !== VisiblePopup.None) {
				popup = VisiblePopup.None
				m.redraw()
			}
			workspace.codeMirror?.focus()
		}
	}

	function view() {
		const authState = AuthService.getAuthState()
		return [
			m("header", [
				m(".flex.items-end", [
					m("h1.f3.mh2.mv0", "Prestige"),
					m(".f6.i.ml3", [
						"Just an HTTP client by ",
						m("a", { href: "https://sharats.me", target: "_blank" }, "Shrikant"),
						".",
					]),
				]),
				m(".flex.items-stretch", [
					!workspace.isChangesSaved && m(".i.pv1.ph2.db.flex.items-center.silver", "Unsaved"),
					isDev() && m(
						"code.flex.items-center.ph1",
						{ style: { lineHeight: 1.15, color: "var(--red-3)", background: "var(--red-9)" } },
						["R", ++redrawCount],
					),
					isDev() && m(
						NavLink,
						{ onclick: onColorPaletteToggle, isActive: popup === VisiblePopup.ColorPalette },
						"Palette",
					),
					m(
						NavLink,
						{ onclick: onDocumentBrowserToggle, isActive: popup === VisiblePopup.DocumentBrowserPopup },
						["📃 Sheet: ", workspace.currentSheetQualifiedPath()],
					),
					m(
						NavLink,
						{ onclick: onCookiesToggle, isActive: popup === VisiblePopup.Cookies },
						`🍪 Cookies (${ workspace.cookieJar?.size ?? 0 })`,
					),
					m(
						NavLink,
						{ onclick: onFileBucketToggle, isActive: popup === VisiblePopup.FileBucketPopup },
						`🗃 FileBucket (${workspace.fileBucket.size})`,
					),
					m(
						NavLink,
						{ onclick: onOptionsToggle, isActive: popup === VisiblePopup.Options },
						"⚙️ Options",
					),
					m(
						NavLink,
						{ onclick: onAboutPaneToggle, isActive: popup === VisiblePopup.AboutPane },
						"🎒 About",
					),
					isDev() && [
						authState === AuthService.AuthState.PENDING && m.trust("&middot; &middot; &middot;"),
						authState === AuthService.AuthState.ANONYMOUS && m(
							NavLink,
							{ onclick: onLoginFormToggle, isActive: popup === VisiblePopup.LoginForm },
							"🕵️‍♀️ LogIn/SignUp",
						),
						authState === AuthService.AuthState.LOGGED_IN && m(
							NavLink,
							{ onclick: AuthService.logout },
							[AuthService.email(), ": Log out"],
						),
					],
					m(NavLink, { href: "/docs/" }, ["Docs", m(Icons.ExternalLink)]),
					m(NavLink, { href: "https://github.com/sharat87/prestige" }, ["GitHub", m(Icons.ExternalLink)]),
				]),
			]),
			m(".er-pair.flex.items-stretch.justify-stretch", [
				m(EditorPane, { workspace }),
				m(ResultPane, { workspace }),
				m("style", "body { --monospace-font: '" + editorFontOption() + "'; }"),
				m("style", "body { --monospace-font-size: " + editorFontSizeOption() + "px; }"),
			]),
			popup === VisiblePopup.AboutPane && m(
				Modal,
				{
					title: "About",
					footer: [
						m("div"),
						m(
							"div",
							m(Button, { style: "primary", type: "button", onclick: onAboutPaneToggle }, "Close"),
						),
					],
				},
				m(
					"div.f3.ph4",
					[
						m("h3", "Hello there! 👋"),
						m(
							"p",
							"My name is Shrikant. I built Prestige because I needed an app like this when working" +
								" with APIs and playing with external APIs.",
						),
						m(
							"p",
							[
								"Check out my blog at ",
								m("a", { href: "https://sharats.me", target: "_blank" }, "sharats.me"),
								". You can also find me on ",
								m(ExternalLink, { href: "https://github.com/sharat87" }, "GitHub"),
								" or ",
								m(ExternalLink, { href: "https://twitter.com/sharat87" }, "Twitter"),
								" or ",
								m(ExternalLink, { href: "https://www.linkedin.com/in/sharat87" }, "LinkedIn"),
								", althought I'm not quite active on those platforms.",
							],
						),
						m(
							"p",
							[
								"If you like Prestige, please consider ",
								m(
									ExternalLink,
									{ href: "https://github.com/sharat87/prestige" },
									"starring the project on GitHub",
								),
								". It'll help improve the project's visibility and works as indication that this " +
									"project is indeed a useful tool. Thank you! 🙏",
							],
						),
						m(
							"p",
							[
								"If you found a bug or have a feature request, please ",
								m(
									ExternalLink,
									{ href: "https://github.com/sharat87/prestige/issues" },
									"open an issue",
								),
								" on the GitHub project page.",
							],
						),
					],
				),
			),
			popup === VisiblePopup.DocumentBrowserPopup && m(
				Modal,
				{
					title: "Documents",
					footer: [
						m("div"),
						m(
							"div",
							m(Button, { style: "primary", type: "button", onclick: onDocumentBrowserToggle }, "Close"),
						),
					],
				},
				m(DocumentBrowser),
			),
			popup === VisiblePopup.Options && m(OptionsModal, {
				doClose: onOptionsToggle,
			}),
			popup === VisiblePopup.Cookies && m(CookiesModal, {
				cookieJar: workspace.cookieJar,
				workspace,
				onClose: onCookiesToggle,
			}),
			popup === VisiblePopup.LoginForm && m(LoginFormModal, {
				onClose: onLoginFormToggle,
			} as any),
			popup === VisiblePopup.FileBucketPopup && m(FileBucketModal, {
				fileBucket: workspace.fileBucket,
				onClose: onFileBucketToggle,
			}),
			popup === VisiblePopup.ColorPalette && m(ColorPaletteModal, {
				onClose: onColorPaletteToggle,
			}),
			workspace.exportingRequest != null && [
				m(
					".modal2-mask",
					{
						onclick() {
							workspace.exportingRequest = null
						},
					},
				),
				m(".modal2", [
					m(ExportPane, { request: workspace.exportingRequest, cookieJar: workspace.cookieJar }),
					m(
						"button.absolute.top-1.right-1.danger-light.ph2.pv0.br-100.f3",
						{
							onclick() {
								workspace.exportingRequest = null
							},
						},
						m.trust("&times;"),
					),
				]),
			],
		]
	}

	function onAboutPaneToggle() {
		popup = popup === VisiblePopup.AboutPane ? VisiblePopup.None : VisiblePopup.AboutPane
	}

	function onDocumentBrowserToggle() {
		popup = popup === VisiblePopup.DocumentBrowserPopup ? VisiblePopup.None : VisiblePopup.DocumentBrowserPopup
	}

	function onCookiesToggle() {
		popup = popup === VisiblePopup.Cookies ? VisiblePopup.None : VisiblePopup.Cookies
	}

	function onFileBucketToggle() {
		popup = popup === VisiblePopup.FileBucketPopup ? VisiblePopup.None : VisiblePopup.FileBucketPopup
	}

	function onLoginFormToggle() {
		popup = popup === VisiblePopup.LoginForm ? VisiblePopup.None : VisiblePopup.LoginForm
	}

	function onOptionsToggle() {
		popup = popup === VisiblePopup.Options ? VisiblePopup.None : VisiblePopup.Options
	}

	function onColorPaletteToggle() {
		popup = popup === VisiblePopup.ColorPalette ? VisiblePopup.None : VisiblePopup.ColorPalette
	}
}

function EditorPane(): m.Component<{ class?: string, workspace: Workspace }> {
	return { view, oncreate }

	function oncreate(vnode: VnodeDOM<{ class?: string, workspace: Workspace }>): void {
		if (!(vnode.dom.firstElementChild instanceof HTMLElement)) {
			throw new Error(
				"CodeMirror for Editor cannot be initialized unless `vnode.dom.firstElementChild` is an HTMLElement.",
			)
		}

		vnode.attrs.workspace.initCodeMirror(vnode.dom.firstElementChild)
	}

	function view(vnode: VnodeDOM<{ class?: string, workspace: Workspace }>): m.Vnode {
		const { workspace } = vnode.attrs
		workspace.doFlashes()
		workspace.codeMirror?.refresh()
		return m(".editor-pane", [
			m(".body"),
		])
	}
}
