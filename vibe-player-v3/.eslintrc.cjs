// vibe-player-v3/.eslintrc.cjs
module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:svelte/recommended',
    ],
    plugins: [
        '@typescript-eslint',
        'import', // Add the import plugin
    ],
    ignorePatterns: ['*.cjs'],
    parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2021,
        extraFileExtensions: ['.svelte'],
    },
    env: {
        browser: true,
        es2017: true,
        node: true,
    },
    rules: {
        // === ARCHITECTURAL GUARDRAILS ===
        // Enforces the Hexagonal Architecture boundaries. This is a critical rule.
        'import/no-restricted-paths': [
            'error',
            {
                zones: [
                    {
                        // The target is our core business logic...
                        target: './src/lib/services/**/*',
                        // ...which is forbidden from importing from the UI layer.
                        from: './src/lib/components/**/*',
                        message: 'Architectural violation: Core services must not import from UI components.',
                    },
                    {
                        target: './src/lib/services/**/*',
                        from: './src/routes/**/*',
                        message: 'Architectural violation: Core services must not import from routes.',
                    },
                    {
                        // The UI layer...
                        target: './src/lib/components/**/*',
                        // ...is forbidden from importing directly from technology adapters like workers.
                        from: './src/lib/workers/**/*',
                        message: 'Architectural violation: UI components should not import workers directly. Use a service.',
                    },
                ],
            },
        ],
    },
    overrides: [
        {
            files: ['*.svelte'],
            parser: 'svelte-eslint-parser',
            parserOptions: {
                parser: '@typescript-eslint/parser',
            },
        },
    ],
};