import m, { Vnode, VnodeDOM } from "mithril"
import Modal from "./Modal"
import Button from "./Button"
import Table from "./Table"
import CookieJar from "./CookieJar"
import type Workspace from "./Workspace"

export default { view }

function view(vnode: VnodeDOM<{ cookieJar: CookieJar | null, workspace: Workspace, onClose: any }>): m.Children {
	const cookieJar = vnode.attrs.cookieJar
	const rows: Vnode[] = []
	let i = 0

	for (const [domain, byPath] of cookieJar == null ? [] : Object.entries(cookieJar.store)) {
		for (const [path, byName] of Object.entries(byPath as any)) {
			for (const [name, morsel] of Object.entries(byName as any)) {
				rows.push(m("tr", [
					m("td", ++i),
					m("td", domain),
					m("td", path),
					m("td", name),
					m("td", (morsel as any).value),
					m("td", (morsel as any).expires),
					m("td", [
						m(
							Button,
							{
								class: "compact danger-light",
								// TODO: Cookie jar is not saved after deletion here.
								onclick: () => vnode.attrs.workspace.deleteCookie(domain, path, name)
								,
							},
							"Del",
						),
					]),
				]))
			}
		}
	}

	return m(
		Modal,
		{
			title: "Cookies",
			footer: [
				cookieJar != null && cookieJar.size > 0 ? m(
					Button,
					{ class: "danger-light", onclick: () => cookieJar.clear() },
					"Clear all cookies",
				) : m("div"),
				m(Button, { style: "primary", onclick: vnode.attrs.onClose }, "Close"),
			],
		},
		[
			rows.length === 0 ? "No cookies in your jar!" : m(
				Table,
				{
					thead: m("tr", [
						m("th", "#"),
						m("th", "Domain"),
						m("th", "Path"),
						m("th", "Name"),
						m("th", "Value"),
						m("th", "Expires"),
						m("th", "Actions"),
					]),
					/* TODO: UI in table footer to manually add a new cookie.
					tfoot: m("tr", [
						m("td", "+"),
						m("td", m("input")),
						m("td", m("input")),
						m("td", m("input")),
						m("td", m("input")),
						m("td", m("input")),
						m("td", m(
							Button,
							{ class: "bg-washed-green dark-green hover-bg-dark-green hover-washed-green" },
							"Add",
						)),
					]), */
				},
				rows,
			),
			m("p.info", "These cookies will be used for requests" +
				" executed by proxy only. For requests that are executed without a proxy, please refer to the browser" +
				" console. This is a browser-level security restriction."),
		],
	)
}
