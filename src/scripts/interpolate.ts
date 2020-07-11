export default function interpolate(content: string, context): string {
	// TODO: Escape any backticks inside `content` before rending it as a template string.

	const keys: string[] = [];
	const values: any[] = [];

	for (const [key, value] of Object.entries(context.data || {})) {
		keys.push(key);
		values.push(value);
	}

	const val = new Function(...keys, "return `" + content + "`;").apply(context, values);
	return val == null ? "" : val.toString();
}