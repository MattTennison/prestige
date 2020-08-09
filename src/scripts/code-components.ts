import m, { VnodeDOM } from "mithril";
import CodeMirror from "codemirror";
import "codemirror/addon/selection/active-line";
import "codemirror/addon/edit/matchbrackets";
import "codemirror/addon/edit/closebrackets";
import "codemirror/addon/dialog/dialog";
import "codemirror/addon/dialog/dialog.css";
import "codemirror/addon/search/searchcursor";
import "codemirror/addon/search/search";
import "codemirror/addon/fold/foldcode";
import "codemirror/addon/fold/brace-fold";
import "codemirror/addon/fold/foldgutter";
import "codemirror/addon/fold/foldgutter.css";
import "codemirror/addon/comment/comment";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/htmlmixed/htmlmixed";
import "codemirror/lib/codemirror.css";
import { NothingMessage } from "./NothingMessage";
import Workspace from "./Workspace";

export function Editor(): m.Component<{ workspace: Workspace }> {
	return { view, oncreate };

	function oncreate(vnode: VnodeDOM<{ workspace: Workspace }>): void {
		if (!(vnode.dom instanceof HTMLElement)) {
			throw new Error("CodeMirror for Editor cannot be initialized unless `vnode.dom` is an HTMLElement.");
		}

		vnode.attrs.workspace.initCodeMirror(vnode.dom);
	}

	function view(vnode: VnodeDOM<{ workspace: Workspace }>) {
		vnode.attrs.workspace.doFlashes();
		vnode.attrs.workspace.codeMirror?.refresh();
		return m(".body");
	}
}

export function CodeBlock(): m.Component<{ spec, text }> {
	let codeMirror: null | CodeMirror.Editor = null;
	return { view, oncreate };

	function oncreate(vnode: m.VnodeDOM<{ spec, text }>) {
		if (vnode.dom.classList.contains("code-block")) {
			if (!(vnode.dom instanceof HTMLElement)) {
				throw new Error("CodeMirror for CodeBlock cannot be initialized unless `vnode.dom` is an HTMLElement.");
			}

			codeMirror = CodeMirror(vnode.dom, {
				mode: vnode.attrs.spec,
				readOnly: true,
				lineNumbers: true,
				foldGutter: true,
				gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
				value: asString(vnode.attrs.text, vnode.attrs.spec),
			});
		}
	}

	function view(vnode) {
		const haveText = asString(vnode.attrs.text, vnode.attrs.spec) !== "";
		if (codeMirror != null) {
			codeMirror.setValue(asString(vnode.attrs.text, vnode.attrs.spec));
		}

		return haveText
			? m(".code-block", { style: { display: haveText ? "" : "none" } })
			: m(NothingMessage);
	}

	function asString(text: any, spec: string): string {
		if (text != null && typeof text !== "string") {
			text = JSON.stringify(text);
		}

		return text == null ? "" : prettify(text, spec);
	}
}

interface PrestigeState {
	context: null | string;
	bodyJustStarted: boolean;
	jsState: any;
	bodyState: any;
}

CodeMirror.defineMode("prestige", (config/*, modeOptions*/): CodeMirror.Mode<PrestigeState> => {
	const jsMode = CodeMirror.getMode(config, "javascript");
	const jsonMode = CodeMirror.getMode(config, { name: "javascript", json: true });

	return {
		name: "prestige",
		lineComment: "#",
		token,
		startState,
		blankLine,
		copyState,
	};

	function startState(): PrestigeState {
		return {
			context: null,
			bodyJustStarted: false,
			jsState: null,
			bodyState: null,
		};
	}

	function copyState(state: PrestigeState) {
		return {
			context: state.context,
			bodyJustStarted: state.bodyJustStarted,
			jsState: state.jsState === null ? null : (CodeMirror as any).copyState(jsMode, state.jsState),
			bodyState: state.bodyState === null ? null : (CodeMirror as any).copyState(jsMode, state.bodyState),
		};
	}

	function token(stream, state): string | null {
		const { bodyJustStarted } = state;
		state.bodyJustStarted = false;

		if (stream.match("###")) {
			if (state.jsState !== null) {
				state.jsState = null;
			}
			if (state.bodyState !== null) {
				state.bodyState = null;
			}

			stream.eatSpace();
			state.context = stream.match("javascript") ? "javascript" : null;
			if (state.context === "javascript") {
				state.jsState = CodeMirror.startState(jsMode);/**/
			}

			stream.skipToEnd();
			return "tag header";
		}

		if (stream.eat("#")) {
			stream.skipToEnd();
			return "comment";
		}

		if (state.context === "javascript") {
			if (state.jsState === null) {
				console.log("incorrect state", stream.current());
			}
			return jsMode.token ? jsMode.token(stream, state.jsState) : "error";
		}

		if (state.context === null) {
			state.context = "request-preamble";
			stream.skipToEnd();
			return null;
		}

		if (state.context === "request-body") {
			if (bodyJustStarted) {
				if (stream.peek() === "{") {
					state.bodyState = CodeMirror.startState(jsonMode);
				} else if (stream.peek() === "=") {
					state.bodyState = CodeMirror.startState(jsMode);
					stream.eat("=");
				}
			}
			if (state.bodyState) {
				return jsonMode.token ? jsonMode.token(stream, state.bodyState) : "error";
			} else {
				stream.skipToEnd();
				return "string";
			}
		}

		stream.skipToEnd();
		return null;
	}

	function blankLine(state) {
		if (state.context === "request-preamble") {
			state.context = "request-body";
			state.bodyJustStarted = true;
		}
	}
});

function prettify(text: string, spec: null | string) {
	const language = spec == null ? null : spec.split("/", 2)[1];

	if (language === "json") {
		return prettifyJson(text);
	}

	return text;
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
