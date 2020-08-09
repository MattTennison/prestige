import CookieJar from "../scripts/CookieJar";

test("starts with empty jar", () => {
	const jar = new CookieJar();
	expect(jar.size).toBe(0);
});

test("add single domain cookies", () => {
	const jar = new CookieJar();

	const counts = jar.update({
		host1: {
			"/": {
				name11: { value: "value11", expires: "" },
				name12: { value: "value12", expires: "" },
			},
		},
	});

	expect(jar.size).toBe(2);
	expect(counts).toStrictEqual({ added: 2, modified: 0, removed: 0, any: true });
});

test("add two domain cookies", () => {
	const jar = new CookieJar();

	const counts = jar.update({
		host1: {
			"/": {
				name11: { value: "value11", expires: "" },
				name12: { value: "value12", expires: "" },
			},
		},
		host2: {
			"/": {
				name21: { value: "value21", expires: "" },
				name22: { value: "value22", expires: "" },
			},
		},
	});

	expect(jar.size).toBe(4);
	expect(counts).toStrictEqual({ added: 4, modified: 0, removed: 0, any: true });
});

test("add one domain, update one domain cookies, using objects API", () => {
	const jar = new CookieJar();

	let counts = jar.update({
		host1: {
			"/": {
				name11: { value: "value11", expires: "" },
				name12: { value: "value12", expires: "" },
				name13: { value: "value13", expires: "" },
			},
		},
	});

	expect(counts).toStrictEqual({ added: 3, modified: 0, removed: 0, any: true });

	counts = jar.update({
		host1: {
			"/": {
				name11: { value: "value11_new", expires: "" },
				name12: { value: "value12", expires: "expires_new" },
				name14: { value: "value14", expires: "" },
			},
		},
	});

	expect(counts).toStrictEqual({ added: 1, modified: 2, removed: 0, any: true });

	expect(jar.size).toBe(4);

	expect(jar.get("host1", "/", "name11")).toStrictEqual({ value: "value11_new", expires: "" });
	expect(jar.get("host1", "/", "name12")).toStrictEqual({ value: "value12", expires: "expires_new" });
	expect(jar.get("host1", "/", "name13")).toStrictEqual({ value: "value13", expires: "" });
	expect(jar.get("host1", "/", "name14")).toStrictEqual({ value: "value14", expires: "" });
});
