import m from "mithril";
import Mustache from "mustache";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/addon/selection/active-line";
import "codemirror/theme/elegant.css";
import msgpack from "msgpack-lite";

// Expected environment variables.
declare var process: { env: { PRESTIGE_PROXY_URL: string } };

window.addEventListener("load", () => {
	const root = document.createElement("div");
	root.setAttribute("id", "app");
	document.body.insertAdjacentElement("afterbegin", root);
	m.mount(root, MainView);
	document.getElementById("loadingBox")?.remove();
});

Mustache.escape = function (text) {
	return text;
};

CodeMirror.defineMode("prestige", (config, parserConfig) => {
	return { startState, token };

	function startState() {
		return {
			inJavascript: false,
		};
	}

	function token(stream, state) {
		if (stream.sol() && stream.match("###")) {
			stream.eatSpace();
			state.inJavascript = stream.match("javascript");
			stream.skipToEnd();
			return "variable-2";
		}

		stream.skipToEnd();

		if (state.inJavascript) {
			return "string";
		}

		return null;
	}
});

class HttpSession {
	cookies: any[];
	_isLoading: boolean;
	proxy: null | string;
	result: any;
	handlers: Map<string, any>;
	data: any;

	constructor(proxy) {
		// These are persistent throughout a session.
		this.cookies = [];
		this._isLoading = false;
		this.proxy = proxy;

		// These should reset for each execute action.
		this.result = null;
		this.handlers = new Map();
		// This is is used as the Mustache template rendering context.
		this.data = {};

		this.checkProxy();
	}

	checkProxy() {
		if (this.proxy == null) {
			console.log("No proxy set.");
			return;
		}

		m.request({
			method: "GET",
			url: this.proxy,
			headers: {
				Accept: "application/json",
			},
		})
			.then((response: { ok: boolean, prestigeProxyVersion: number }) => {
				if (!response.ok || response.prestigeProxyVersion !== 1) {
					this.proxy = null;
				}
			})
			.finally(() => {
				if (this.proxy) {
					console.log("Proxy available at", this.proxy);
				} else {
					console.log("No proxy available. Functionality will be limited.");
				}
			});
	}

	get isLoading() {
		return this._isLoading;
	}

	set isLoading(value) {
		this._isLoading = value;
		m.redraw();
	}

	runTop(lines, cursorLine) {
		if (this.isLoading) {
			alert("There's a request currently pending. Please wait for it to finish.");
			return Promise.reject();
		}

		if (typeof lines === "string") {
			lines = lines.split("\n");
		}

		const startTime = Date.now();
		this.isLoading = true;
		let request: any = null;

		this.handlers.clear();
		this.data = {};

		return this
			._extractRequest(lines, cursorLine, this)
			.then(async (req) => {
				request = req;
				await this.emit("BeforeExecute", { request });
				return this._execute(request);
			})
			.then(res => {
				this.isLoading = false;
				this.result = res;
				updateCookies(this.cookies, this.result.cookies);
				this.result.ok = true;
			})
			.catch(error => {
				this.isLoading = false;
				this.result = { ok: false, error, request };
				return Promise.reject(error);
			})
			.finally(() => {
				this.result.timeTaken = Date.now() - startTime;
				m.redraw();
			});
	}

	run(lines, cursorLine) {
		console.log("run", lines, cursorLine);
		cursorLine = cursorLine || 0;
		if (typeof lines === "string") {
			lines = lines.split("\n");
		}

		let request: any = null;

		return this
			._extractRequest(lines, cursorLine, this)
			.then(req => {
				request = req;
				return this._execute(request);
			})
			.then(res => {
				console.log("Got run response for", request);
				this.result = res;
				updateCookies(this.cookies, this.result.cookies);
				this.result.ok = true;
			})
			.catch(error => {
				this.result = { ok: false, error, request };
				return Promise.reject(error);
			});
	}

	async _extractRequest(lines, cursorLine, context) {
		let isInScript = false;
		const scriptLines: string[] = [];
		let startLine: number = 0;

		for (let lNum = 0; lNum < cursorLine; ++lNum) {
			const line = lines[lNum];
			if (line === "### javascript") {
				isInScript = true;

			} else if (line === "###") {
				isInScript = false;
				startLine = lNum + 1;
				const fn = new Function(scriptLines.join("\n"));
				scriptLines.splice(0, scriptLines.length);
				// The following may be used in the script, so ensure they exist, and are marked as used for the sanity
				// of IDE and TypeScript.
				if (!context.run || !context.on || !context.off) {
					console.error("Not all of the required context interface functions are available.")
				}
				const returnValue = fn.call(context);
				if (isPromise(returnValue)) {
					await returnValue;
				}

			} else if (isInScript) {
				scriptLines.push(line);

			}
		}

		if (isInScript) {
			alert("Script block started above, not ended above.");
			return null;
		}

		const bodyLines: string[] = []
		const details = {
			method: "GET",
			url: "",
			body: "",
			headers: new Headers(),
		};

		let isInBody = false;
		const headerLines: string[] = [];

		while (lines[startLine] === "") {
			++startLine;
		}

		for (let lNum = startLine; lNum < lines.length; ++lNum) {
			const lineText: string = lines[lNum];
			if (lineText.startsWith("###")) {
				break;
			}

			if (lNum === cursorLine) {
				headerLines.push(lineText);

			} else if (isInBody) {
				bodyLines.push(lineText);

			} else if (lineText === "") {
				isInBody = true;
				const renderedLines = Mustache.render(headerLines.join("\n"), context.data).split("\n");
				const [method, ...urlParts] = renderedLines[0].split(/\s+/);
				details.method = method.toUpperCase();
				details.url = urlParts.join(" ");
				for (const rLine of renderedLines.slice(1)) {
					const [name, ...valueParts] = rLine.split(/:\s*/);
					if (name === "") {
						throw new Error("Header name cannot be blank.");
					}
					details.headers.append(name, valueParts.join(" "));
				}

			} else if (!lineText.startsWith("#")) {
				headerLines.push(lineText);

			}
		}

		if (bodyLines.length > 0) {
			if (bodyLines[0].startsWith("=")) {
				// Replace that `=` with `return` and we assume what followed that `=` is a single JS expression.
				const code = "return " + bodyLines[0].substr(1) + "\n" + bodyLines.slice(1).join("\n");
				const body = new Function(code).call(context);
				if (typeof body === "string") {
					details.body = body;
				} else {
					details.body = JSON.stringify(body);
				}

			} else {
				details.body = bodyLines.join("\n");

			}

			details.body = details.body.trim();
		}

		return details;
	}

	async _execute(request) {
		console.info("Executing", request);
		if (request == null) {
			return null;
		}

		const { url, headers, body } = request;

		let method = request.method;
		if (method == null || method === "") {
			method = "GET";
		}

		if (url == null || url === "") {
			throw new Error("URL cannot be empty!");
		}

		const options: RequestInit = {
			cache: "no-store",
			credentials: "same-origin",
		};

		if (this.proxy == null) {
			options.method = method;
			options.headers = headers;

			if (typeof body === "string" && body.length > 0) {
				options.body = body;
			}

			const response = await fetch(url, options);
			return {
				ok: true,
				response: {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
					body: msgpack.decode(Buffer.from(await response.arrayBuffer())),
					history: null,
					cookies: null,
				},
			};

		} else  {
			options.method = "POST";
			options.headers = new Headers({"Content-Type": "application/json"});
			options.body = JSON.stringify({
				url,
				method,
				headers: Array.from(headers.entries()),
				cookies: this.cookies,
				body,
			});

			const buffer = Buffer.from(await (await fetch(this.proxy, options)).arrayBuffer());
			console.log(JSON.stringify(buffer));
			const data = msgpack.decode(buffer);
			if (data.ok) {
				console.log("response data", data);
			} else {
				console.error("response data", data);
			}
			return data;

		}
	}

	on(name, fn) {
		if (!this.handlers.has(name)) {
			this.handlers.set(name, new Set());
		}
		this.handlers.get(name).add(fn);
	}

	off(name, fn) {
		if (this.handlers.has(name)){
			this.handlers.get(name).delete(fn);
		}
	}

	emit(name, detail) {
		const event = new CustomEvent(name, { detail });
		const promises: Promise<any>[] = [];

		if (this.handlers.has(name)) {
			for (const fn of this.handlers.get(name)) {
				const value = fn(event);
				if (isPromise(value)) {
					promises.push(value);
				}
			}
		}

		return (promises.length === 0 ? Promise.resolve() : Promise.all(promises))
			.finally(() => m.redraw);
	}
}

function MainView() {
	let isOptionsVisible = false;
	let isCookiesVisible = false;

	return { view };

	function view() {
		return [
			m("main", [
				m("header", [
					m("div", [
						m("h1", "Prestige"),
						m("span", { style: { "margin-left": "1em" } }, m("em", "Just an HTTP client by Shrikant.")),
					]),
					m("div", [
						// m("a", { href: "#", onclick: onCookiesToggle, class: isCookiesVisible ? "active" : "" }, "Cookies"),
						m(LinkButton, { href: "https://github.com/sharat87/prestige" }, "GitHub"),
						m(LinkButton, { onclick: onOptionsToggle, isActive: isOptionsVisible }, "Options"),
					]),
				]),
				m(Workspace),
				isOptionsVisible && m(OptionsModal, { doSave: onOptionsSave, doClose: onOptionsToggle }),
				isCookiesVisible && m(CookiesModal, { doClose: onCookiesToggle }),
			]),
		];
	}

	function onCookiesToggle(event) {
		if (event) {
			event.preventDefault();
		}
		isCookiesVisible = !isCookiesVisible;
		m.redraw();
	}

	function onOptionsToggle() {
		isOptionsVisible = !isOptionsVisible;
		m.redraw();
	}

	function onOptionsSave() {
		console.warn("WIP Save & apply options");
		m.redraw();
	}
}

function Workspace() {
	const client = new HttpSession(process.env.PRESTIGE_PROXY_URL);

	return { view };

	function view() {
		return m("div.er-pair", [
			m(EditorPane, { onExecute, cookies: client.cookies }),
			m(ResultPane, { client }),
		]);
	}

	function onExecute(codeMirror) {
		const lines = codeMirror.getValue().split("\n");
		const cursorLine = codeMirror.getCursor().line;
		client.runTop(lines, cursorLine)
			.finally(m.redraw);
	}
}

function Toolbar() {
	return { view };

	function view(vnode) {
		return m("div.toolbar", [
			m(".bar", [
				m("div.left", vnode.attrs.left),
				m("div.right", vnode.attrs.right),
			]),
			// TODO: Can we use `vnode.children` instead of `vnode.attrs.peripherals`?
			m(".peripherals", vnode.attrs.peripherals),
		]);
	}
}

function EditorPane(initialVnode) {
	let { onExecute } = initialVnode.attrs;
	let isCookiesPopupVisible = false;

	return { view };

	function onEditorChanges(value) {
		localStorage.setItem("content1", value);
	}

	function view(vnode) {
		onExecute = vnode.attrs.onExecute;
		return m(
			"div.editor-pane",
			[
				m(CodeMirrorEditor, {
					content: localStorage.getItem("content1") ||
						"GET http://httpbin.org/get?name=haha\n\n###\n\nPOST http://httpbin.org/post\nContent-Type: application/x-www-form-urlencoded\n\nusername=sherlock&password=elementary\n",
					onUpdate: onEditorChanges,
					onExecute: onExecuteCb,
				}),
				m(Toolbar, {
					right: [
						m(
							LinkButton,
							{ onclick: toggleCookiesPopup, isActive: isCookiesPopupVisible },
							[
								"Cookies",
								vnode.attrs.cookies && vnode.attrs.cookies.length > 0 && ` (${vnode.attrs.cookies.length})`,
							],
						),
					],
					peripherals: [
						isCookiesPopupVisible && m(CookiesModal, { onClose: toggleCookiesPopup, cookies: vnode.attrs.cookies }),
					],
				}),
			]
		);
	}

	function onExecuteCb(codeMirror) {
		if (codeMirror.somethingSelected()) {
			alert("Running a selection is not supported yet.");
		}

		onExecute(codeMirror);
	}

	function toggleCookiesPopup() {
		isCookiesPopupVisible = !isCookiesPopupVisible;
		m.redraw();
	}
}

function CodeMirrorEditor() {
	let content = "";
	let onUpdate: null | Function = null;

	// noinspection JSUnusedGlobalSymbols
	return { view, oncreate };

	function oncreate(vnode) {
		content = vnode.attrs.content || "";
		const editor = CodeMirror(vnode.dom, {
			theme: "elegant",
			mode: "prestige",
			lineNumbers: true,
			autofocus: true,
			styleActiveLine: true,
			value: content,
		});
		editor.setOption("extraKeys", {
			"Ctrl-Enter": vnode.attrs.onExecute,
			"Cmd-Enter": vnode.attrs.onExecute,
		});
		editor.on("changes", onChanges);
		onUpdate = vnode.attrs.onUpdate;
	}

	function onChanges(codeMirror) {
		content = codeMirror.getValue();
		if (onUpdate) {
			onUpdate(content);
		}
	}

	function view() {
		return m(".body");
	}
}

function ResultPane() {
	return { view };

	function view(vnode) {
		const { result, isLoading } = vnode.attrs.client;

		if (isLoading) {
			return m("div.result-pane.loading", m("p", m.trust("Loading&hellip;")));
		}

		if (result == null) {
			return null;
		}

		if (!result.ok) {
			return m("div.result-pane.error", [
				m("div.body", [
					m("h2", "Error executing request"),
					m("p", result.error.message),
					result.error.stack && m("pre", result.error.stack),
					result.request && [
						m("h2", "Request details"),
						mkTable([
							m("tr", [
								m("th", "Method"),
								m("td", result.request.method || m("em", "Empty (which is okay, will just use GET).")),
							]),
							m("tr", [
								m("th", "URL"),
								m("td", result.request.url || m("em", "Empty.")),
							]),
							Object.entries(result.request).map(([name, value]) => {
								return name !== "method" && name !== "url" && m("tr", [
									m("th", name.replace(/\b\w/g, stringUpperCase)),
									m("td", typeof value === "string" ? value : JSON.stringify(value, null, 2)),
								])
							}),
						]),
					],
					m(PageEnd),
				]),
				m("div.toolbar"),
			]);
		}

		const { response, history } = result;

		if (vnode.state.responseMirror) {
			vnode.state.responseMirror.setValue(response.body);
		}

		if (vnode.state.requestMirror) {
			vnode.state.requestMirror.setValue(response.request.body || "");
		}

		return m("div.result-pane", [
			m("div.body", [
				history.length > 0 && m(
					"p.redirection-message",
					`Request redirected ${history.length === 1 ? "once" : history.length + "times"}.` +
					" Scroll down for more details."
				),
				m("p", { style: { padding: "0 6px" } }, m.trust("Request finished in <b>" + result.timeTaken + "ms</b>.")),
				renderResponse(response),
				history ? history.map(renderResponse).reverse() : null,
				m(PageEnd),
			]),
			m(Toolbar, {
				left: [
					m(
						LinkButton,
						{ onclick: () => alert("click WIP") },
						"Result related tools: WIP"
					),
				],
			}),
		]);
	}

	function renderHeaders(headers) {
		if (headers == null) {
			return null;
		}

		const rows: any[] = [];

		for (const [name, value] of headers) {
			rows.push(m("tr", [
				m("td", name.replace(/\b\w/g, stringUpperCase)),
				m("td", value),
			]));
		}

		return rows.length > 0 ? m("div.table-box", m("table", m("tbody", rows))) : null;
	}

	function renderResponse(response) {
		const responseContentType = getContentTypeFromHeaders(response && response.headers);
		const requestContentType = getContentTypeFromHeaders(response && response.request.headers);

		console.log("response.body", response.body);

		return response && m("div.response", [
			m(
				"h2",
				{ class: "status s" + response.status.toString()[0] + "xx" },
				`${response.status} ${response.statusText}`
			),
			m("pre.url", response.request.method + " " + response.url),
			m("h2", "Response"),
			m("h3", "Body"),
			m(CodeBlock, { content: response.body, language: responseContentType ? responseContentType.split("/")[1] : null }),
			m("h3", "Headers"),
			(renderHeaders(response.headers)) || m("p", "Nothing here."),
			m("h2", "Request"),
			m("h3", "Body"),
			m(CodeBlock, { content: response.request.body, language: requestContentType ? requestContentType.split("/")[1] : null }),
			m("h3", "Headers"),
			(renderHeaders(response.request.headers)) || m("p", "Nothing here."),
		]);
	}
}

function CodeBlock() {
	return { view };

	function view(vnode) {
		let { content, language } = vnode.attrs;

		if (content == null || content === "") {
			return m("p", m("em", "Nothing"));
		}

		if (typeof content !== "string") {
			content = JSON.stringify(content);
		}

		let i = 0;
		const prettyContent = prettify(content, language);

		return m("pre", [
			m(".line-numbers", prettyContent.split(/\r?\n/).map(() => m("div", ++i))),
			m(
				"code", language && Prism.languages[language]
					? m.trust(Prism.highlight(prettyContent, Prism.languages[language], language))
					: prettyContent
			),
		]);
	}
}

function PageEnd() {
	return { view };

	function view() {
		return m("p", { style: { margin: "2em 0 3em", "text-align": "center", "font-size": "2em" } }, "❦");
	}
}

function OptionsModal() {
	return { view };

	function view(vnode) {
		return [
			// m("div.mask"),
			m("div.modal", [
				m("header", m("h2", "Options")),
				m("section.form", [
					m("span", "Dark Mode"),
					m("div", [
						m("label", { title: "Sync to system's dark mode setting" }, [
							m("input", { type: "radio", name: "darkMode", value: "auto" }),
							m("span", "Auto"),
						]),
						m("label", [
							m("input", { type: "radio", name: "darkMode", value: "light" }),
							m("span", "Light"),
						]),
						m("label", [
							m("input", { type: "radio", name: "darkMode", value: "dark" }),
							m("span", "Dark"),
						]),
					]),
				]),
				m("footer", [
					m("button.primary", { type: "button", onclick: vnode.attrs.doSave }, "Save"),
					m("button", { type: "button", onclick: vnode.attrs.doClose }, "Cancel"),
				]),
			]),
		];
	}
}

function CookiesModal() {
	return { view };

	function view(vnode) {
		return [
			// m("div.mask"),
			m("div.popup.right", [
				m("header", m("h2", "Cookies")),
				m("section", [
					m("pre", "this.cookies = " + JSON.stringify(vnode.attrs.cookies, null, 2)),
					m(PageEnd),
				]),
				m("footer", [
					// m("button.primary", { type: "button", onclick: vnode.attrs.doSave }, "Save"),
					m("button", { type: "button", onclick: vnode.attrs.onClose }, "Close"),
				]),
			]),
		];
	}
}

function mkTable(rows) {
	return m("div.table-box", m("table", m("tbody", rows)));
}

function LinkButton() {
	return { view };

	function view(vnode) {
		return m(
			"a",
			{
				class: "button" + (vnode.attrs.isActive ? " active" : ""),
				href: vnode.attrs.href || "#",
				target: "_blank",  // TODO: Set this to _blank *only* for external links.
				onclick(event) {
					if (event.target.getAttribute("href") === "#" || event.target.getAttribute("href") === "") {
						event.preventDefault();
					}
					if (vnode.attrs.onclick) {
						vnode.attrs.onclick(event);
					}
				},
			},
			vnode.children
		);
	}
}

function prettify(content, language) {
	if (language === "json") {
		return prettifyJson(content);
	}
	return content;
}

function prettifyJson(json) {
	try {
		return JSON.stringify(JSON.parse(json), null, 2);
	} catch (error) {
		// TODO: The fact that this JSON is invalid should be communicated to the user.
		console.error("Error parsing/prettifying JSON.");
		return json;
	}
}

function highlight(content, language, isRaw) {
	if (language && Prism.languages[language]) {
		let html = Prism.highlight(prettify(content, language), Prism.languages[language], language);
		return isRaw ? html : m.trust(html);
	}

	return content;
}

function updateCookies(cookies, newCookies) {
	for (const newOne of newCookies) {
		let isFound = false;
		for (const oldOne of cookies) {
			if (oldOne.domain === newOne.domain && oldOne.path === newOne.path && oldOne.name === newOne.name) {
				oldOne.value = newOne.value;
				isFound = true;
			}
		}
		if (!isFound) {
			cookies.push(newOne);
		}
	}
}

function getContentTypeFromHeaders(headers) {
	if (headers == null) {
		return null;
	}

	if (headers instanceof Headers) {
		headers = Array.from(headers.entries());
	}

	for (const [name, value] of headers) {
		if (name.toLowerCase() === "content-type") {
			return value.split(";", 1)[0];
		}
	}

	return null;
}

function stringUpperCase(s) {
	return s.toUpperCase();
}

function isPromise(object) {
	return object != null && typeof object.then === "function";
}