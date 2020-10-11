import m from "mithril";
import type { Vnode, VnodeDOM } from "mithril";
import PageEnd from "./PageEnd";

export default { view };

function view(vnode: VnodeDOM<{ title: string, footer?: any }>): Vnode {
	return m(".modal.fixed.right-0.w-50.vh-75.flex.flex-column.bg-white", [
		m("header.pa2.bb.b--moon-gray", [
			m("h2.ma0", vnode.attrs.title || "Excuse the interruption"),
		]),
		m("section.pa2.overflow-y-auto", [
			vnode.children,
			m(PageEnd),
		]),
		vnode.attrs.footer && m("footer.pa2.flex.justify-between.bt.b--moon-gray", vnode.attrs.footer),
	]);
}
