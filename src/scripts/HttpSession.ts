import m from "mithril";
import Mustache from "mustache";
import msgpack from "msgpack-lite";
import CookieJar from "./CookieJar";

interface Cookie {
	domain: string,
	path: string,
	name: string,
	value: string,
	expires: string,
}

interface SuccessResult {
	ok: true,
	response: any,
	cookies: Cookie[],
	cookieChanges: {
		added: number,
		modified: number,
		removed: number,
		any: boolean,
	},
	request: any,
	timeTaken?: number,
}

interface FailureResult {
	ok: false,
	error: any,
	request: any,
	timeTaken?: number,
}

export default class HttpSession {
	cookieJar: CookieJar;
	_isLoading: boolean;
	proxy: null | string;
	result: SuccessResult | FailureResult | null;
	handlers: Map<string, Set<Function>>;
	data: any;

	constructor(proxy) {
		// These are persistent throughout a session.
		this.cookieJar = new CookieJar();
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

		fetch(this.proxy, { headers: { Accept: "application/json" } })
			.then(response => response.json())
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
				if (this.result != null) {
					this.result.ok = true;
					(this.result as SuccessResult).cookieChanges =
						this.cookieJar.update((this.result as SuccessResult).cookies);
				}
			})
			.catch(error => {
				this.isLoading = false;
				this.result = { ok: false, error, request };
				return Promise.reject(error);
			})
			.finally(() => {
				if (this.result != null) {
					this.result.timeTaken = Date.now() - startTime;
				}
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
				if (this.result != null) {
					this.result.ok = true;
					this.cookieJar.update((this.result as SuccessResult).cookies);
				}
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
		let pageContentStarted = false;

		for (let lNum = 0; lNum < cursorLine; ++lNum) {
			const line = lines[lNum];
			if (line === "### javascript") {
				isInScript = true;

			} else if (line.startsWith("###")) {
				isInScript = false;
				startLine = lNum + 1;
				pageContentStarted = false;
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

			} else if (!pageContentStarted && (line.startsWith("#") || line === "")) {
				startLine = lNum + 1;

			} else if (!pageContentStarted) {
				pageContentStarted = true;

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
		let headersStarted = false;
		const queryParams: string[] = [];

		while (lines[startLine] === "") {
			++startLine;
		}

		for (let lNum = startLine; lNum < lines.length; ++lNum) {
			const lineText: string = lines[lNum];
			if (lineText.startsWith("###")) {
				break;
			}

			if (isInBody) {
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
				if (!headersStarted && lineText.match(/^\s/)) {
					queryParams.push(lineText.replace(/^\s+/, ""));
				} else {
					headersStarted = true;
					headerLines.push(lineText);
				}

			}
		}

		if (queryParams.length > 0) {
			// TODO: Set query params.
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
				cookies: this.cookieJar.plain(),
				body,
			});

			const buffer = Buffer.from(await (await fetch(this.proxy, options)).arrayBuffer());
			const data = msgpack.decode(buffer);

			if (data.ok) {
				console.log("response data", data);
				return data;

			} else {
				console.error("response data", data);
				return Promise.reject(new Error(data.error.message));

			}

		}
	}

	on(name, fn) {
		(this.handlers.get(name) || this.handlers.set(name, new Set()).get(name))?.add(fn);
	}

	off(name, fn) {
		this.handlers.get(name)?.delete(fn);
	}

	emit(name, detail) {
		const event = new CustomEvent(name, { detail });
		const promises: Promise<any>[] = [];

		const functions = this.handlers.get(name);
		if (functions != null) {
			for (const fn of functions) {
				const value = fn(event);
				if (isPromise(value)) {
					promises.push(value);
				}
			}
		}

		return (promises.length === 0 ? Promise.resolve() : Promise.all(promises))
			.finally(m.redraw);
	}
}

function isPromise(object) {
	return object != null && typeof object.then === "function";
}
