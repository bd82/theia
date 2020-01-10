module.exports = {
    root: true,
    extends: [
        './configs/base.eslintrc.json',
        './configs/warnings.eslintrc.json',
        './configs/errors.eslintrc.json'
    ],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: [
            'compile.tsconfig.json',
            'dev-packages/*/compile.tsconfig.json',
            'packages/*/compile.tsconfig.json',
            'examples/*/compile.tsconfig.json'
        ]
    }
};
