// eslint.config.js — flat ESLint config for tori-agent monorepo

/** @type {string[]} */
const NODE_BUILTINS = [
  "assert", "buffer", "child_process", "cluster", "crypto", "dns", "events",
  "fs", "fs/promises", "http", "https", "module", "net", "os", "path",
  "perf_hooks", "querystring", "readline", "stream", "string_decoder",
  "timers", "timers/promises", "tty", "url", "util", "vm", "worker_threads", "zlib",
];

const preferNodeProtocol = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Require the `node:` protocol prefix on Node.js built-in imports" },
    messages: {
      missingNodeProtocol: 'Use the `node:` protocol prefix for built-in imports: change "{{specifier}}" to "node:{{specifier}}".',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const specifier = node.source.value;
        if (typeof specifier === "string" && NODE_BUILTINS.includes(specifier)) {
          context.report({
            node: node.source,
            messageId: "missingNodeProtocol",
            data: { specifier },
            fix(fixer) {
              const raw = node.source.raw ?? `"${specifier}"`;
              const quote = raw[0];
              return fixer.replaceText(node.source, `${quote}node:${specifier}${quote}`);
            },
          });
        }
      },
    };
  },
};

export default [
  {
    files: ["packages/*/src/**/*.{js,ts}"],
    plugins: {
      local: {
        rules: { "prefer-node-protocol": preferNodeProtocol },
      },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "local/prefer-node-protocol": "error",
    },
  },
];
